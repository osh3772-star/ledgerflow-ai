-- Deterministic journals, human approval and atomic posting. No agent can approve.
BEGIN;
ALTER TABLE public.principal_scopes DROP CONSTRAINT principal_scopes_scope_check;
ALTER TABLE public.principal_scopes ADD CONSTRAINT principal_scopes_scope_check
  CHECK(scope IN ('erp:read','erp:write','accounting:write','accounting:approve','accounting:close'));
ALTER TABLE public.audit_logs DROP CONSTRAINT audit_logs_action_check;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_action_check
  CHECK(action IN ('erp_insert','erp_read','journal_save','journal_validate','journal_request','journal_approved','journal_rejected','journal_post','journal_discard','reconciliation_match','evidence_archive','period_close'));

CREATE TABLE public.journal_entries(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),
  transaction_id uuid NOT NULL,period_id uuid NOT NULL,recognition_on date NOT NULL,
  entry_type text NOT NULL CHECK(entry_type IN ('source','adjustment','reversal')),
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=65536),
  content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),version int NOT NULL DEFAULT 1 CHECK(version>0),
  state text NOT NULL DEFAULT 'Draft' CHECK(state IN ('Draft','Validated','Approval','Posted')),
  idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 128),
  created_by uuid NOT NULL REFERENCES auth.users(id),posted_at timestamptz,discarded_at timestamptz,discard_reason text,
  reversal_of uuid,created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,id),UNIQUE(company_id,idempotency_key),
  FOREIGN KEY(company_id,transaction_id) REFERENCES public.business_transactions(company_id,id),
  FOREIGN KEY(company_id,period_id) REFERENCES public.fiscal_periods(company_id,id),
  FOREIGN KEY(company_id,reversal_of) REFERENCES public.journal_entries(company_id,id),
  CHECK((state='Posted')=(posted_at IS NOT NULL)),CHECK((entry_type='reversal')=(reversal_of IS NOT NULL)),
  CHECK(discarded_at IS NULL OR (state<>'Posted' AND length(discard_reason) BETWEEN 1 AND 500))
);
CREATE UNIQUE INDEX one_active_reversal ON public.journal_entries(company_id,reversal_of) WHERE reversal_of IS NOT NULL AND discarded_at IS NULL;
CREATE UNIQUE INDEX one_posted_source ON public.journal_entries(company_id,transaction_id) WHERE entry_type='source' AND state='Posted';
CREATE INDEX journals_period ON public.journal_entries(company_id,recognition_on,state,id);
CREATE TABLE public.journal_lines(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,journal_id uuid NOT NULL,line_no int NOT NULL CHECK(line_no BETWEEN 1 AND 100),
  account_id uuid NOT NULL,debit private.erp_won NOT NULL,credit private.erp_won NOT NULL,
  CHECK((debit>0 AND credit=0) OR (credit>0 AND debit=0)),UNIQUE(company_id,journal_id,line_no),
  FOREIGN KEY(company_id,journal_id) REFERENCES public.journal_entries(company_id,id),
  FOREIGN KEY(company_id,account_id) REFERENCES public.accounts(company_id,id)
);
CREATE INDEX journal_account_lookup ON public.journal_lines(company_id,account_id,journal_id);
CREATE TABLE public.approval_requests(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,journal_id uuid NOT NULL,version int NOT NULL,
  content_hash text NOT NULL,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  requested_by uuid NOT NULL REFERENCES auth.users(id),decided_by uuid REFERENCES auth.users(id),decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(company_id,journal_id,version),
  FOREIGN KEY(company_id,journal_id) REFERENCES public.journal_entries(company_id,id),
  CHECK((status='pending')=(decided_by IS NULL AND decided_at IS NULL))
);
CREATE TABLE public.agent_runs(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),
  client text NOT NULL CHECK(client IN ('codex','claude_code')),created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(company_id,id)
);
CREATE TABLE public.agent_tasks(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,run_id uuid NOT NULL,task_key text NOT NULL,
  role text NOT NULL CHECK(role IN ('supervisor','sales','purchase','treasury','closing','audit')),
  result jsonb NOT NULL CHECK(octet_length(result::text)<=65536),created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,run_id,task_key),FOREIGN KEY(company_id,run_id) REFERENCES public.agent_runs(company_id,id)
);
CREATE TABLE public.mcp_tool_calls(
  trace_id uuid PRIMARY KEY,company_id uuid NOT NULL REFERENCES public.companies(id),tool_name text NOT NULL,
  outcome text NOT NULL CHECK(outcome IN ('success','error')),duration_ms int NOT NULL CHECK(duration_ms>=0),
  error_code text,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.external_api_cache(
  cache_key text PRIMARY KEY,provider text NOT NULL CHECK(provider IN ('nts','dart','law','ecos')),
  origin text NOT NULL CHECK(origin IN ('mock','public_api_live')),response jsonb NOT NULL,source_url text NOT NULL,
  fetched_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
  CHECK(expires_at>fetched_at),CHECK(octet_length(response::text)<=1048576)
);
CREATE TABLE public.reconciliation_matches(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,bank_transaction_id uuid NOT NULL,journal_id uuid NOT NULL,
  amount private.erp_won NOT NULL CHECK(amount>0),created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,bank_transaction_id,journal_id),
  FOREIGN KEY(company_id,bank_transaction_id) REFERENCES public.bank_transactions(company_id,id),
  FOREIGN KEY(company_id,journal_id) REFERENCES public.journal_entries(company_id,id)
);

CREATE FUNCTION private.accounting_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_TABLE_NAME='journal_entries' THEN
    IF OLD.state='Posted' THEN RAISE EXCEPTION 'POSTED_IMMUTABLE'; END IF;
  ELSE
    IF TG_TABLE_NAME='journal_lines' AND EXISTS(SELECT 1 FROM public.journal_entries WHERE id=coalesce(NEW.journal_id,OLD.journal_id) AND state='Posted')
      THEN RAISE EXCEPTION 'POSTED_IMMUTABLE'; END IF;
  END IF;
  RETURN coalesce(NEW,OLD);
END;$$;
CREATE TRIGGER immutable_posted BEFORE UPDATE OR DELETE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION private.accounting_immutable();
CREATE TRIGGER immutable_posted_lines BEFORE INSERT OR UPDATE OR DELETE ON public.journal_lines FOR EACH ROW EXECUTE FUNCTION private.accounting_immutable();
CREATE TRIGGER immutable_approvals BEFORE UPDATE OR DELETE ON public.approval_requests FOR EACH ROW WHEN(OLD.status<>'pending') EXECUTE FUNCTION private.reject_erp_mutation();
CREATE TRIGGER immutable_agent_results BEFORE UPDATE OR DELETE ON public.agent_tasks FOR EACH ROW EXECUTE FUNCTION private.reject_erp_mutation();
CREATE TRIGGER immutable_mcp_logs BEFORE UPDATE OR DELETE ON public.mcp_tool_calls FOR EACH ROW EXECUTE FUNCTION private.reject_erp_mutation();

CREATE FUNCTION private.journal_result(j public.journal_entries) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',j.id,'companyId',j.company_id,'payload',j.payload,'hash',j.content_hash,'version',j.version,
   'state',j.state,'idempotencyKey',j.idempotency_key,'postedAt',j.posted_at,'discardedAt',j.discarded_at,'discardReason',j.discard_reason);
$$;
CREATE FUNCTION private.check_journal(target_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.journal_entries%ROWTYPE;p public.fiscal_periods%ROWTYPE;l jsonb;dr numeric:=0;cr numeric:=0;n int:=0;a public.accounts%ROWTYPE;
BEGIN
 SELECT * INTO STRICT j FROM public.journal_entries WHERE id=target_id;
 SELECT * INTO STRICT p FROM public.fiscal_periods WHERE id=j.period_id AND company_id=j.company_id FOR UPDATE;
 IF p.status<>'open' THEN RAISE EXCEPTION 'PERIOD_CLOSED'; END IF;
 IF j.recognition_on NOT BETWEEN p.start_date AND p.end_date THEN RAISE EXCEPTION 'PERIOD_MISMATCH'; END IF;
 IF j.content_hash<>encode(sha256(convert_to(j.payload::text,'UTF8')),'hex') THEN RAISE EXCEPTION 'HASH_MISMATCH'; END IF;
 IF j.transaction_id::text IS DISTINCT FROM j.payload->>'transactionId' OR j.period_id::text IS DISTINCT FROM j.payload->>'periodId'
   OR j.recognition_on::text IS DISTINCT FROM j.payload->>'recognitionOn' OR j.entry_type IS DISTINCT FROM j.payload->>'entryType'
   OR j.reversal_of::text IS DISTINCT FROM j.payload->>'reversalOf' THEN RAISE EXCEPTION 'HASH_MISMATCH'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(j.payload->'sourceDocumentIds') v
   WHERE NOT EXISTS(SELECT 1 FROM public.transaction_documents d WHERE d.company_id=j.company_id AND d.transaction_id=j.transaction_id AND d.document_id=v::uuid))
   OR jsonb_array_length(j.payload->'sourceDocumentIds')<1 THEN RAISE EXCEPTION 'EVIDENCE_MISMATCH'; END IF;
 IF j.payload->'evidenceHashes' IS NULL OR jsonb_array_length(j.payload->'evidenceHashes')<>jsonb_array_length(j.payload->'sourceDocumentIds')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(j.payload->'evidenceHashes') v WHERE NOT EXISTS(
     SELECT 1 FROM public.source_documents d JOIN public.transaction_documents r ON r.company_id=d.company_id AND r.document_id=d.id
       WHERE d.company_id=j.company_id AND r.transaction_id=j.transaction_id AND d.id=(v->>'documentId')::uuid AND d.sha256=v->>'sha256'))
   THEN RAISE EXCEPTION 'EVIDENCE_MISMATCH'; END IF;
 FOR l IN SELECT * FROM jsonb_array_elements(j.payload->'lines') LOOP
   n:=n+1;
   IF coalesce(l->>'debit','') !~ '^(0|[1-9][0-9]{0,17})$' OR coalesce(l->>'credit','') !~ '^(0|[1-9][0-9]{0,17})$'
      OR NOT (((l->>'debit')::numeric>0 AND (l->>'credit')::numeric=0) OR ((l->>'credit')::numeric>0 AND (l->>'debit')::numeric=0)) THEN RAISE EXCEPTION 'LINE_INVALID'; END IF;
   SELECT * INTO a FROM public.accounts WHERE company_id=j.company_id AND code=l->>'accountCode'
     AND active AND valid_from<=j.recognition_on AND (valid_to IS NULL OR valid_to>=j.recognition_on);
   IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_INVALID'; END IF;
   dr:=dr+(l->>'debit')::numeric;cr:=cr+(l->>'credit')::numeric;
 END LOOP;
 IF n NOT BETWEEN 2 AND 100 OR dr<=0 OR dr<>cr THEN RAISE EXCEPTION 'UNBALANCED'; END IF;
 IF EXISTS(SELECT 1 FROM public.journal_lines WHERE journal_id=j.id) AND j.payload->'lines' IS DISTINCT FROM (
   SELECT jsonb_agg(jsonb_build_object('accountCode',account_row.code,'debit',line_row.debit::text,'credit',line_row.credit::text) ORDER BY line_row.line_no)
     FROM public.journal_lines line_row JOIN public.accounts account_row ON account_row.company_id=line_row.company_id AND account_row.id=line_row.account_id WHERE line_row.journal_id=j.id
 ) THEN RAISE EXCEPTION 'LINE_PAYLOAD_MISMATCH'; END IF;
 IF j.entry_type='source' AND EXISTS(SELECT 1 FROM public.journal_entries WHERE company_id=j.company_id AND transaction_id=j.transaction_id AND entry_type='source' AND state='Posted' AND id<>j.id)
   THEN RAISE EXCEPTION 'DUPLICATE_POSTING'; END IF;
 IF j.entry_type='source' AND NOT EXISTS(SELECT 1 FROM public.business_transactions WHERE company_id=j.company_id AND id=j.transaction_id
   AND recognition_on=j.recognition_on AND period_id=j.period_id) THEN RAISE EXCEPTION 'TRANSACTION_MISMATCH'; END IF;
 IF j.entry_type='reversal' AND NOT EXISTS(SELECT 1 FROM public.journal_entries original WHERE original.company_id=j.company_id AND original.id=j.reversal_of AND original.state='Posted'
   AND original.transaction_id=j.transaction_id AND original.entry_type<>'reversal'
   AND j.payload->'lines'=(SELECT jsonb_agg(jsonb_build_object('accountCode',v->>'accountCode','debit',v->>'credit','credit',v->>'debit')) FROM jsonb_array_elements(original.payload->'lines') v))
   THEN RAISE EXCEPTION 'REVERSAL_INVALID'; END IF;
END;$$;

CREATE FUNCTION public.accounting_command(target_company uuid,command text,input jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.journal_entries%ROWTYPE;payload jsonb;h text;key text;p uuid;a public.approval_requests%ROWTYPE;l jsonb;n int:=0;decision text;
BEGIN
 IF NOT private.has_company_scope(target_company,'erp:read') OR NOT private.has_company_scope(target_company,
   CASE WHEN command='decide' THEN 'accounting:approve' WHEN command='close' THEN 'accounting:close' ELSE 'accounting:write' END)
   THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='FORBIDDEN'; END IF;
 IF command='save' THEN
   payload:=input->'payload';key:=input->>'idempotencyKey';
   IF payload IS NULL OR jsonb_typeof(payload)<>'object' OR coalesce(length(key),0) NOT BETWEEN 1 AND 128 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
   h:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');
   PERFORM pg_advisory_xact_lock(hashtextextended(target_company::text||key,0));
   SELECT * INTO j FROM public.journal_entries WHERE company_id=target_company AND idempotency_key=key;
   IF FOUND THEN IF j.content_hash<>h THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;RETURN private.journal_result(j); END IF;
   INSERT INTO public.journal_entries(company_id,transaction_id,period_id,recognition_on,entry_type,payload,content_hash,idempotency_key,created_by,reversal_of)
    VALUES(target_company,(payload->>'transactionId')::uuid,(payload->>'periodId')::uuid,(payload->>'recognitionOn')::date,payload->>'entryType',payload,h,key,auth.uid(),(payload->>'reversalOf')::uuid)
    RETURNING * INTO j;
   PERFORM private.check_journal(j.id);
   FOR l IN SELECT * FROM jsonb_array_elements(payload->'lines') LOOP
     n:=n+1;
     INSERT INTO public.journal_lines(company_id,journal_id,line_no,account_id,debit,credit)
       SELECT target_company,j.id,n,id,(l->>'debit')::numeric,(l->>'credit')::numeric FROM public.accounts WHERE company_id=target_company AND code=l->>'accountCode';
   END LOOP;
 ELSIF command='close' THEN
   p:=(input->>'periodId')::uuid;
   PERFORM 1 FROM public.fiscal_periods WHERE company_id=target_company AND id=p AND status='open' FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'PERIOD_CLOSED'; END IF;
   IF EXISTS(SELECT 1 FROM public.business_transactions t WHERE t.company_id=target_company AND t.period_id=p
     AND NOT EXISTS(SELECT 1 FROM public.journal_entries posted WHERE posted.company_id=t.company_id AND posted.transaction_id=t.id AND posted.state='Posted' AND posted.entry_type='source'))
     OR EXISTS(SELECT 1 FROM public.journal_entries WHERE company_id=target_company AND period_id=p AND state<>'Posted' AND discarded_at IS NULL)
     THEN RAISE EXCEPTION 'CLOSE_INCOMPLETE'; END IF;
   UPDATE public.fiscal_periods SET status='closed' WHERE company_id=target_company AND id=p;
   INSERT INTO public.audit_logs(company_id,trace_id,actor_user_id,entity_type,entity_id,action,origin)
     VALUES(target_company,gen_random_uuid(),auth.uid(),'fiscal_periods',p,'period_close','synthetic_erp');
   RETURN jsonb_build_object('periodId',p,'state','closed');
 ELSE
   SELECT * INTO j FROM public.journal_entries WHERE company_id=target_company AND id=(input->>'journalId')::uuid FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
   IF j.discarded_at IS NOT NULL THEN
     IF command='discard' AND input->>'expectedHash'=j.content_hash AND input->>'reason'=j.discard_reason THEN RETURN private.journal_result(j); END IF;
     RAISE EXCEPTION 'JOURNAL_DISCARDED';
   END IF;
   IF command='discard' THEN
     IF j.state='Posted' OR input->>'expectedHash' IS DISTINCT FROM j.content_hash OR coalesce(length(input->>'reason'),0) NOT BETWEEN 1 AND 500
       OR EXISTS(SELECT 1 FROM public.approval_requests WHERE journal_id=j.id AND status='approved') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
     UPDATE public.journal_entries SET discarded_at=now(),discard_reason=input->>'reason' WHERE id=j.id RETURNING * INTO j;
     INSERT INTO public.audit_logs(company_id,trace_id,actor_user_id,entity_type,entity_id,action,origin)
       VALUES(target_company,gen_random_uuid(),auth.uid(),'journal_entries',j.id,'journal_discard','synthetic_erp');
     RETURN private.journal_result(j);
   END IF;
   IF NOT EXISTS(SELECT 1 FROM public.journal_lines WHERE journal_id=j.id) THEN RAISE EXCEPTION 'LINE_PAYLOAD_MISMATCH'; END IF;
   IF command='post' AND j.state='Posted' THEN
     IF input->>'expectedHash' IS DISTINCT FROM j.content_hash THEN RAISE EXCEPTION 'HASH_MISMATCH'; END IF;
     RETURN private.journal_result(j);
   END IF;
   PERFORM private.check_journal(j.id);
   CASE command
    WHEN 'validate' THEN
      IF j.state='Draft' THEN UPDATE public.journal_entries SET state='Validated' WHERE id=j.id; END IF;
    WHEN 'request' THEN
      IF j.state NOT IN ('Validated','Approval') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
      INSERT INTO public.approval_requests(company_id,journal_id,version,content_hash,requested_by)
        VALUES(target_company,j.id,j.version,j.content_hash,auth.uid()) ON CONFLICT DO NOTHING;
      UPDATE public.journal_entries SET state='Approval' WHERE id=j.id;
    WHEN 'decide' THEN
      IF j.state<>'Approval' OR j.created_by=auth.uid() OR input->>'expectedHash' IS DISTINCT FROM j.content_hash THEN RAISE EXCEPTION 'APPROVAL_INVALID'; END IF;
      decision:=input->>'decision';IF decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
      SELECT * INTO a FROM public.approval_requests WHERE company_id=target_company AND journal_id=j.id AND version=j.version FOR UPDATE;
      IF a.status<>'pending' THEN
        IF a.status=decision AND a.decided_by=auth.uid() THEN RETURN private.journal_result(j); END IF;
        RAISE EXCEPTION 'DECISION_IMMUTABLE';
      END IF;
      UPDATE public.approval_requests SET status=decision,decided_by=auth.uid(),decided_at=now() WHERE id=a.id;
    WHEN 'post' THEN
      IF j.state<>'Approval' OR input->>'expectedHash' IS DISTINCT FROM j.content_hash OR NOT EXISTS(
        SELECT 1 FROM public.approval_requests r WHERE r.company_id=target_company AND r.journal_id=j.id AND r.version=j.version
          AND r.status='approved' AND r.content_hash=j.content_hash AND r.decided_by<>j.created_by
          AND EXISTS(SELECT 1 FROM public.company_memberships m JOIN public.principals pr ON pr.company_id=m.company_id AND pr.user_id=m.user_id
            JOIN public.principal_scopes s ON s.company_id=pr.company_id AND s.principal_id=pr.id
            WHERE m.company_id=target_company AND m.user_id=r.decided_by AND m.active AND pr.active AND s.scope='accounting:approve'
              AND (m.expires_at IS NULL OR m.expires_at>statement_timestamp()))) THEN RAISE EXCEPTION 'APPROVAL_REQUIRED'; END IF;
      UPDATE public.journal_entries SET state='Posted',posted_at=now() WHERE id=j.id;
    ELSE RAISE EXCEPTION 'INVALID_COMMAND';
   END CASE;
   SELECT * INTO j FROM public.journal_entries WHERE id=j.id;
 END IF;
 INSERT INTO public.audit_logs(company_id,trace_id,actor_user_id,entity_type,entity_id,action,origin)
   VALUES(target_company,gen_random_uuid(),auth.uid(),'journal_entries',j.id,
     CASE command WHEN 'save' THEN 'journal_save' WHEN 'validate' THEN 'journal_validate' WHEN 'request' THEN 'journal_request'
       WHEN 'post' THEN 'journal_post' WHEN 'decide' THEN 'journal_'||decision END,'synthetic_erp');
 RETURN private.journal_result(j);
END;$$;
REVOKE ALL ON FUNCTION public.accounting_command(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accounting_command(uuid,text,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION private.check_journal(uuid),private.journal_result(public.journal_entries),private.accounting_immutable() FROM PUBLIC,anon,authenticated;
DO $$DECLARE t text;BEGIN
 FOR t IN SELECT unnest(ARRAY['journal_entries','journal_lines','approval_requests','agent_runs','agent_tasks','mcp_tool_calls','reconciliation_matches']) LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  EXECUTE format('CREATE POLICY company_read ON public.%I FOR SELECT TO authenticated USING(private.has_company_scope(company_id,''erp:read''))',t);
 END LOOP;
END;$$;
ALTER TABLE public.external_api_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.external_api_cache FROM PUBLIC,anon,authenticated;
COMMIT;
