-- P2-C: scoped ERP services; no journal proposal, approval, or posting.
BEGIN;
ALTER TABLE public.business_transactions ADD COLUMN counterparty_id uuid;
ALTER TABLE public.business_transactions ADD CONSTRAINT transaction_counterparty_fk
  FOREIGN KEY(company_id,counterparty_id) REFERENCES public.counterparties(company_id,id);

CREATE TABLE public.transaction_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  transaction_id uuid NOT NULL,
  document_id uuid NOT NULL,
  position smallint NOT NULL CHECK(position BETWEEN 1 AND 20),
  origin text NOT NULL DEFAULT 'synthetic_erp' CHECK(origin='synthetic_erp'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,transaction_id,document_id),
  UNIQUE(company_id,transaction_id,position),
  FOREIGN KEY(company_id,transaction_id) REFERENCES public.business_transactions(company_id,id),
  FOREIGN KEY(company_id,document_id) REFERENCES public.source_documents(company_id,id)
);
CREATE INDEX document_transaction_lookup ON public.transaction_documents(company_id,document_id);
ALTER TABLE public.transaction_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_documents FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.transaction_documents FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.transaction_documents TO authenticated;
CREATE POLICY transaction_document_read ON public.transaction_documents FOR SELECT TO authenticated
  USING(private.has_company_scope(company_id,'erp:read'));
CREATE TRIGGER transaction_document_audit AFTER INSERT ON public.transaction_documents
  FOR EACH ROW EXECUTE FUNCTION private.record_erp_insert();
-- Backfill the primary reference of existing fixture transactions exactly once.
INSERT INTO public.transaction_documents(company_id,transaction_id,document_id,position)
  SELECT company_id,id,source_document_id,1 FROM public.business_transactions;
CREATE FUNCTION private.link_primary_document()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  INSERT INTO public.transaction_documents(company_id,transaction_id,document_id,position)
    VALUES(NEW.company_id,NEW.id,NEW.source_document_id,1);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.link_primary_document() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER transaction_primary_document AFTER INSERT ON public.business_transactions
  FOR EACH ROW EXECUTE FUNCTION private.link_primary_document();

CREATE TABLE private.erp_create_requests (
  company_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 128),
  request_hash char(64) NOT NULL,
  transaction_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(company_id,idempotency_key),
  FOREIGN KEY(company_id,transaction_id) REFERENCES public.business_transactions(company_id,id)
);
REVOKE ALL ON private.erp_create_requests FROM PUBLIC,anon,authenticated;

ALTER TABLE public.audit_logs DROP CONSTRAINT audit_logs_action_check;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_action_check CHECK(action IN ('erp_insert','erp_read'));
CREATE FUNCTION public.record_erp_read(target_company uuid,resource text,trace uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NOT private.has_company_scope(target_company,'erp:read') OR resource NOT IN
    ('business_transactions','invoices','bank_transactions','inventory','counterparties') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='FORBIDDEN';
  END IF;
  INSERT INTO public.audit_logs(company_id,trace_id,actor_user_id,entity_type,entity_id,action,origin)
    VALUES(target_company,trace,auth.uid(),resource,target_company,'erp_read','synthetic_erp');
END;
$$;
REVOKE ALL ON FUNCTION public.record_erp_read(uuid,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_erp_read(uuid,text,uuid) TO authenticated;

-- A bounded compact representation matching the project fixture canonical JSON:
-- ASCII object field names, safe integer numbers, Unicode text values, depth<=8.
-- It is deliberately not advertised as a general RFC 8785 canonicalizer.
CREATE FUNCTION private.canonical_erp_json(value jsonb,depth int DEFAULT 0)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE result text; kind text; number numeric;
BEGIN
  IF depth>8 OR value IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVALID_INPUT'; END IF;
  kind:=jsonb_typeof(value);
  IF kind='object' THEN
    IF (SELECT count(*) FROM jsonb_object_keys(value))>64 OR EXISTS(
      SELECT 1 FROM jsonb_object_keys(value) key WHERE key !~ '^[A-Za-z][A-Za-z0-9_]{0,63}$'
    ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVALID_INPUT'; END IF;
    SELECT '{'||coalesce(string_agg(to_jsonb(key)::text||':'||private.canonical_erp_json(item,depth+1),',' ORDER BY key COLLATE "C"),'')||'}'
      INTO result FROM jsonb_each(value) entry(key,item);
    RETURN result;
  ELSIF kind='array' THEN
    IF jsonb_array_length(value)>100 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVALID_INPUT'; END IF;
    SELECT '['||coalesce(string_agg(private.canonical_erp_json(item,depth+1),',' ORDER BY ordinal),'')||']'
      INTO result FROM jsonb_array_elements(value) WITH ORDINALITY entry(item,ordinal);
    RETURN result;
  ELSIF kind='number' THEN
    number:=(value::text)::numeric;
    IF number<>trunc(number) OR abs(number)>9007199254740991 THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVALID_INPUT';
    END IF;
    RETURN trunc(number)::text;
  END IF;
  RETURN value::text;
END;
$$;
REVOKE ALL ON FUNCTION private.canonical_erp_json(jsonb,int) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.erp_transaction_json(source_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('id',id,'companyId',company_id,'periodId',period_id,'sourceDocumentId',source_document_id,
    'externalRef',external_ref,'kind',kind,'occurredOn',occurred_on::text,'recognitionOn',recognition_on::text,
    'currency',currency,'origin',origin,'net',net_amount::text,'tax',tax_amount::text,'gross',gross_amount::text,
    'status',status,'idempotencyKey',idempotency_key)
    || CASE WHEN counterparty_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('counterpartyId',counterparty_id) END
  FROM public.business_transactions WHERE id=source_id;
$$;
REVOKE ALL ON FUNCTION private.erp_transaction_json(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.create_erp_transaction(input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE company uuid; period public.fiscal_periods%ROWTYPE; counterpart uuid; counterpart_role text;
  request_hash text; receipt private.erp_create_requests%ROWTYPE; new_transaction_id uuid;
  evidence jsonb; existing public.source_documents%ROWTYPE; selected_document_id uuid; document_ids uuid[]:='{}';
  document_hash text; compact text; field text; count_docs int; ordinal int:=0; source_json jsonb;
  net numeric; tax numeric; gross numeric; occurred date; recognition date; mode text; ids jsonb;
BEGIN
  IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR octet_length(input::text)>400000 OR EXISTS(
    SELECT 1 FROM jsonb_object_keys(input) key WHERE key NOT IN
      ('companyId','idempotencyKey','externalRef','kind','occurredOn','recognitionOn','counterpartyId','currency','net','tax','gross','documentIds','documents')
  ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVALID_INPUT'; END IF;
  FOREACH field IN ARRAY ARRAY['companyId','idempotencyKey','externalRef','kind','occurredOn','recognitionOn','currency','net','tax','gross'] LOOP
    IF jsonb_typeof(input->field) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVALID_INPUT'; END IF;
  END LOOP;
  IF length(input->>'idempotencyKey') NOT BETWEEN 1 AND 128 OR length(input->>'externalRef') NOT BETWEEN 1 AND 128
    OR input->>'currency'<>'KRW' OR input->>'kind' NOT IN
      ('opening_capital','purchase','sale','receipt','payment','payroll','asset_acquisition','prepayment','accrual','adjustment')
    OR input->>'occurredOn' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    OR input->>'recognitionOn' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    OR input->>'net' !~ '^(0|[1-9][0-9]{0,17})$' OR input->>'tax' !~ '^(0|[1-9][0-9]{0,17})$'
    OR input->>'gross' !~ '^(0|[1-9][0-9]{0,17})$' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVALID_INPUT';
  END IF;
  company:=(input->>'companyId')::uuid; occurred:=(input->>'occurredOn')::date; recognition:=(input->>'recognitionOn')::date;
  net:=(input->>'net')::numeric;tax:=(input->>'tax')::numeric;gross:=(input->>'gross')::numeric;
  IF net+tax<>gross OR (input?'documents')=(input?'documentIds') THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVALID_INPUT';
  END IF;
  mode:=CASE WHEN input?'documents' THEN 'documents' ELSE 'documentIds' END;
  IF jsonb_typeof(input->mode) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVALID_INPUT'; END IF;
  count_docs:=jsonb_array_length(input->mode);
  IF count_docs NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVALID_INPUT'; END IF;
  IF NOT private.has_company_scope(company,'erp:write') OR NOT EXISTS(
    SELECT 1 FROM public.company_memberships m JOIN public.principals p ON p.company_id=m.company_id AND p.user_id=m.user_id
    WHERE m.company_id=company AND m.user_id=auth.uid() AND m.role IN ('preparer','admin') AND p.kind='human'
  ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='FORBIDDEN'; END IF;
  IF input?'counterpartyId' AND jsonb_typeof(input->'counterpartyId') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVALID_INPUT';
  END IF;
  request_hash:=encode(sha256(convert_to(private.canonical_erp_json(input,-3),'UTF8')),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(company::text||'/request/'||(input->>'idempotencyKey'),0));
  SELECT * INTO receipt FROM private.erp_create_requests r WHERE r.company_id=company AND r.idempotency_key=input->>'idempotencyKey';
  IF FOUND THEN
    IF receipt.request_hash<>request_hash THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='IDEMPOTENCY_CONFLICT'; END IF;
    SELECT jsonb_agg(d.document_id ORDER BY d.position) INTO ids FROM public.transaction_documents d
      WHERE d.company_id=company AND d.transaction_id=receipt.transaction_id;
    RETURN jsonb_build_object('transaction',private.erp_transaction_json(receipt.transaction_id),'documentIds',ids,'reused',true);
  END IF;
  SELECT * INTO period FROM public.fiscal_periods WHERE company_id=company AND recognition BETWEEN start_date AND end_date FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='REFERENCE_INVALID'; END IF;
  IF period.status<>'open' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PERIOD_CLOSED'; END IF;
  counterpart:=(input->>'counterpartyId')::uuid;
  IF counterpart IS NOT NULL THEN
    SELECT role INTO counterpart_role FROM public.counterparties WHERE company_id=company AND id=counterpart;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='REFERENCE_INVALID'; END IF;
    IF (input->>'kind' IN ('sale','receipt') AND counterpart_role<>'customer') OR
      (input->>'kind' IN ('purchase','payment','asset_acquisition') AND counterpart_role<>'supplier') THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='REFERENCE_INVALID';
    END IF;
  END IF;
  IF mode='documents' THEN
    -- Lock all content identities in a consistent order before creating any documents.
    FOR document_hash IN SELECT DISTINCT encode(sha256(convert_to(private.canonical_erp_json(e->'content'),'UTF8')),'hex')
      FROM jsonb_array_elements(input->'documents') e ORDER BY 1 LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended(company::text||'/document/'||document_hash,0));
    END LOOP;
  END IF;
  FOR evidence IN SELECT * FROM jsonb_array_elements(input->mode) LOOP
    IF mode='documentIds' THEN
      IF jsonb_typeof(evidence)<>'string' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVALID_INPUT'; END IF;
      selected_document_id:=(evidence#>>'{}')::uuid;
      SELECT * INTO existing FROM public.source_documents WHERE company_id=company AND id=selected_document_id;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='REFERENCE_INVALID'; END IF;
      IF existing.sha256<>encode(sha256(convert_to(private.canonical_erp_json(existing.content),'UTF8')),'hex') THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DOCUMENT_CONFLICT';
      END IF;
    ELSE
      IF jsonb_typeof(evidence) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(evidence) key WHERE key NOT IN ('documentType','issueDate','content'))
        OR jsonb_typeof(evidence->'documentType') IS DISTINCT FROM 'string' OR length(evidence->>'documentType') NOT BETWEEN 1 AND 64
        OR jsonb_typeof(evidence->'issueDate') IS DISTINCT FROM 'string' OR evidence->>'issueDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        OR jsonb_typeof(evidence->'content') IS DISTINCT FROM 'object' OR evidence->'content'->>'origin' IS DISTINCT FROM 'synthetic_erp' THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVALID_INPUT';
      END IF;
      compact:=private.canonical_erp_json(evidence->'content');
      IF octet_length(compact)>16384 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVALID_INPUT'; END IF;
      document_hash:=encode(sha256(convert_to(compact,'UTF8')),'hex');
      SELECT * INTO existing FROM public.source_documents WHERE company_id=company AND sha256=document_hash FOR UPDATE;
      IF FOUND THEN
        IF existing.content<>evidence->'content' OR existing.document_type<>evidence->>'documentType' OR existing.issue_date<>(evidence->>'issueDate')::date THEN
          RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DOCUMENT_CONFLICT';
        END IF;
        selected_document_id:=existing.id;
      ELSE
        selected_document_id:=gen_random_uuid();
        INSERT INTO public.source_documents(id,company_id,document_type,issue_date,origin,content,sha256)
          VALUES(selected_document_id,company,evidence->>'documentType',(evidence->>'issueDate')::date,'synthetic_erp',evidence->'content',document_hash);
      END IF;
    END IF;
    IF selected_document_id=ANY(document_ids) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DOCUMENT_CONFLICT'; END IF;
    document_ids:=array_append(document_ids,selected_document_id);
  END LOOP;
  new_transaction_id:=gen_random_uuid();
  INSERT INTO public.business_transactions(id,company_id,period_id,source_document_id,counterparty_id,external_ref,kind,
    occurred_on,recognition_on,currency,origin,net_amount,tax_amount,gross_amount,status,idempotency_key,payload_hash)
    VALUES(new_transaction_id,company,period.id,document_ids[1],counterpart,input->>'externalRef',input->>'kind',
      occurred,recognition,'KRW','synthetic_erp',net,tax,gross,'unprocessed',input->>'idempotencyKey',repeat('0',64));
  source_json:=private.erp_transaction_json(new_transaction_id);
  UPDATE public.business_transactions SET payload_hash=encode(sha256(convert_to(private.canonical_erp_json(source_json),'UTF8')),'hex') WHERE id=new_transaction_id;
  FOREACH selected_document_id IN ARRAY document_ids LOOP
    ordinal:=ordinal+1;
    INSERT INTO public.transaction_documents(company_id,transaction_id,document_id,position)
      VALUES(company,new_transaction_id,selected_document_id,ordinal) ON CONFLICT(company_id,transaction_id,document_id) DO NOTHING;
  END LOOP;
  INSERT INTO private.erp_create_requests(company_id,idempotency_key,request_hash,transaction_id)
    VALUES(company,input->>'idempotencyKey',request_hash,new_transaction_id);
  RETURN jsonb_build_object('transaction',source_json,'documentIds',to_jsonb(document_ids),'reused',false);
END;
$$;
REVOKE ALL ON FUNCTION public.create_erp_transaction(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_erp_transaction(jsonb) TO authenticated;
COMMIT;
