BEGIN;
CREATE FUNCTION private.check_closing_schedules(target_company uuid,target_period uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.fiscal_periods%ROWTYPE;r record;prior numeric;current_amount numeric;expected numeric;
BEGIN
 SELECT * INTO STRICT p FROM public.fiscal_periods WHERE company_id=target_company AND id=target_period;
 FOR r IN SELECT id,round((cost-residual)/useful_life_months) AS amount,cost-residual AS maximum FROM public.fixed_assets WHERE company_id=target_company AND available_on<=p.end_date
   UNION ALL SELECT id,monthly_expense,cost FROM public.prepayments WHERE company_id=target_company AND coverage_start<=p.end_date AND coverage_end>=p.end_date LOOP
   SELECT coalesce(sum((payload->'lines'->0->>'debit')::numeric-(payload->'lines'->0->>'credit')::numeric) FILTER(WHERE recognition_on<p.start_date),0),
     coalesce(sum((payload->'lines'->0->>'debit')::numeric-(payload->'lines'->0->>'credit')::numeric) FILTER(WHERE recognition_on>=p.start_date),0)
    INTO prior,current_amount FROM public.journal_entries WHERE company_id=target_company AND state='Posted' AND recognition_on<=p.end_date AND payload->'calculation'->>'referenceId'=r.id::text;
   expected:=least(r.amount,greatest(r.maximum-prior,0));
   IF current_amount<>expected THEN RAISE EXCEPTION 'CLOSE_INCOMPLETE'; END IF;
 END LOOP;
END;$$;
CREATE FUNCTION private.guard_period_close() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.status='closed' AND OLD.status<>'closed' THEN
  -- The DB repeats schedule checks even if a client bypasses service preflight.
  -- Only populated accounting periods require these controls; legacy ERP-only
  -- test periods retain their historical close behavior.
  IF EXISTS(SELECT 1 FROM public.journal_entries WHERE company_id=NEW.company_id AND period_id=NEW.id) THEN
    PERFORM private.check_closing_schedules(NEW.company_id,NEW.id);
  END IF;
 END IF;RETURN NEW;
END;$$;
CREATE TRIGGER period_accounting_close BEFORE UPDATE ON public.fiscal_periods FOR EACH ROW EXECUTE FUNCTION private.guard_period_close();
CREATE FUNCTION public.record_agent_result(target_company uuid,client_name text,run uuid,client_result jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE task public.agent_tasks%ROWTYPE;new_run uuid;
BEGIN
 IF NOT private.has_company_scope(target_company,'accounting:write') OR NOT private.has_company_scope(target_company,'erp:read') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF coalesce(client_result->>'role','') NOT IN ('supervisor','sales','purchase','treasury','closing','audit') OR coalesce(client_result->>'status','') NOT IN ('completed','blocked','failed')
   OR octet_length(client_result::text)>65536 OR coalesce(length(client_result->>'taskId'),0) NOT BETWEEN 1 AND 128 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 IF coalesce((client_result->>'journalPosted')::boolean,false) AND (jsonb_array_length(client_result->'transactionIds')=0 OR EXISTS(
   SELECT 1 FROM jsonb_array_elements_text(client_result->'transactionIds') t WHERE NOT EXISTS(
     SELECT 1 FROM public.journal_entries j WHERE j.company_id=target_company AND j.transaction_id=t::uuid AND j.state='Posted')))
   THEN RAISE EXCEPTION 'POSTING_CLAIM_INVALID'; END IF;
 IF run IS NULL THEN
  INSERT INTO public.agent_runs(company_id,client,created_by) VALUES(target_company,client_name,auth.uid()) RETURNING id INTO new_run;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.agent_runs WHERE company_id=target_company AND id=run AND created_by=auth.uid()) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  new_run:=run;
 END IF;
 INSERT INTO public.agent_tasks(company_id,run_id,task_key,role,result) VALUES(target_company,new_run,client_result->>'taskId',client_result->>'role',client_result)
   ON CONFLICT DO NOTHING RETURNING * INTO task;
 IF NOT FOUND THEN SELECT * INTO task FROM public.agent_tasks WHERE company_id=target_company AND run_id=new_run AND task_key=client_result->>'taskId';
   IF task.result<>client_result THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
 END IF;
 RETURN jsonb_build_object('runId',new_run,'taskId',task.id,'recorded',true);
END;$$;
REVOKE ALL ON FUNCTION public.record_agent_result(uuid,text,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_agent_result(uuid,text,uuid,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION private.check_closing_schedules(uuid,uuid),private.guard_period_close() FROM PUBLIC,anon,authenticated;
-- Supabase Storage is absent in the native PostgreSQL test harness.
DO $$BEGIN
 IF to_regclass('storage.objects') IS NOT NULL THEN
  INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
    VALUES('ledgerflow-evidence','ledgerflow-evidence',false,10485760,ARRAY['application/pdf','image/png','image/jpeg','application/json']) ON CONFLICT(id) DO NOTHING;
  EXECUTE $policy$CREATE POLICY ledgerflow_evidence_read ON storage.objects FOR SELECT TO authenticated
    USING(bucket_id='ledgerflow-evidence' AND CASE WHEN name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' THEN private.has_company_scope(split_part(name,'/',1)::uuid,'erp:read') ELSE false END)$policy$;
  EXECUTE $policy$CREATE POLICY ledgerflow_evidence_write ON storage.objects FOR INSERT TO authenticated
    WITH CHECK(bucket_id='ledgerflow-evidence' AND CASE WHEN name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' THEN private.has_company_scope(split_part(name,'/',1)::uuid,'erp:write') ELSE false END)$policy$;
 END IF;
END;$$;
CREATE TRIGGER immutable_reconciliation BEFORE UPDATE OR DELETE ON public.reconciliation_matches FOR EACH ROW EXECUTE FUNCTION private.reject_erp_mutation();
CREATE FUNCTION public.match_bank_journal(target_company uuid,bank_id uuid,entry_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b public.bank_transactions%ROWTYPE;j public.journal_entries%ROWTYPE;m public.reconciliation_matches%ROWTYPE;cash numeric;
BEGIN
 IF NOT private.has_company_scope(target_company,'accounting:write') OR NOT private.has_company_scope(target_company,'erp:read') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT * INTO b FROM public.bank_transactions WHERE company_id=target_company AND id=bank_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 SELECT * INTO j FROM public.journal_entries WHERE company_id=target_company AND id=entry_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 SELECT coalesce(sum(l.debit-l.credit),0) INTO cash FROM public.journal_lines l JOIN public.accounts a ON a.company_id=l.company_id AND a.id=l.account_id WHERE l.journal_id=j.id AND a.code='1010';
 IF j.state<>'Posted' OR j.entry_type<>'source' OR j.transaction_id<>b.transaction_id OR j.recognition_on<>b.booked_on
   OR cash<>(CASE WHEN b.direction='in' THEN b.amount ELSE -b.amount END)
   OR EXISTS(SELECT 1 FROM public.journal_entries WHERE reversal_of=j.id AND state='Posted') THEN RAISE EXCEPTION 'RECONCILIATION_MISMATCH'; END IF;
 INSERT INTO public.reconciliation_matches(company_id,bank_transaction_id,journal_id,amount) VALUES(target_company,b.id,j.id,b.amount)
   ON CONFLICT DO NOTHING RETURNING * INTO m;
 IF NOT FOUND THEN SELECT * INTO m FROM public.reconciliation_matches WHERE company_id=target_company AND bank_transaction_id=b.id AND journal_id=j.id; END IF;
 INSERT INTO public.audit_logs(company_id,trace_id,actor_user_id,entity_type,entity_id,action,origin)
   VALUES(target_company,gen_random_uuid(),auth.uid(),'reconciliation_matches',m.id,'reconciliation_match','synthetic_erp');
 RETURN jsonb_build_object('id',m.id,'bankTransactionId',b.id,'journalId',j.id,'amount',m.amount::text,'matched',true);
END;$$;
REVOKE ALL ON FUNCTION public.match_bank_journal(uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.match_bank_journal(uuid,uuid,uuid) TO authenticated;
CREATE TABLE public.evidence_objects(
 company_id uuid NOT NULL,document_id uuid NOT NULL,path text NOT NULL,sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 byte_length int NOT NULL CHECK(byte_length BETWEEN 1 AND 10485760),created_by uuid NOT NULL REFERENCES auth.users(id),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(company_id,document_id),UNIQUE(path),FOREIGN KEY(company_id,document_id) REFERENCES public.source_documents(company_id,id)
);
ALTER TABLE public.evidence_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_objects FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.evidence_objects FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.evidence_objects TO authenticated;
CREATE POLICY company_read ON public.evidence_objects FOR SELECT TO authenticated USING(private.has_company_scope(company_id,'erp:read'));
CREATE TRIGGER immutable_evidence_archive BEFORE UPDATE OR DELETE ON public.evidence_objects FOR EACH ROW EXECUTE FUNCTION private.reject_erp_mutation();
CREATE FUNCTION public.record_evidence_object(target_company uuid,document uuid,digest text,byte_count int) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public.source_documents%ROWTYPE;object_path text;
BEGIN
 IF NOT private.has_company_scope(target_company,'erp:write') OR NOT private.has_company_scope(target_company,'erp:read') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT * INTO d FROM public.source_documents WHERE company_id=target_company AND id=document;
 IF NOT FOUND OR d.sha256<>digest THEN RAISE EXCEPTION 'EVIDENCE_MISMATCH'; END IF;
 object_path:=target_company::text||'/'||document::text||'/'||digest||'.json';
 INSERT INTO public.evidence_objects(company_id,document_id,path,sha256,byte_length,created_by) VALUES(target_company,document,object_path,digest,byte_count,auth.uid()) ON CONFLICT DO NOTHING;
 INSERT INTO public.audit_logs(company_id,trace_id,actor_user_id,entity_type,entity_id,action,origin)
   VALUES(target_company,gen_random_uuid(),auth.uid(),'source_documents',document,'evidence_archive','synthetic_erp');
 RETURN jsonb_build_object('documentId',document,'path',object_path,'sha256',digest,'archived',true);
END;$$;
REVOKE ALL ON FUNCTION public.record_evidence_object(uuid,uuid,text,int) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_evidence_object(uuid,uuid,text,int) TO authenticated;
COMMIT;
