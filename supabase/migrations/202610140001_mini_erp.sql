-- P2-A: Supabase PostgreSQL schema. auth.users/auth.uid() are provided by Supabase.
-- Native integration tests supply a separate test-only auth bootstrap.
BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  data_origin text NOT NULL CHECK (data_origin = 'synthetic_erp'),
  functional_currency char(3) NOT NULL DEFAULT 'KRW' CHECK (functional_currency = 'KRW'),
  fiscal_start_month smallint NOT NULL DEFAULT 1 CHECK (fiscal_start_month = 1),
  policy_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.company_memberships (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('viewer', 'preparer', 'admin')),
  active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, user_id)
);
CREATE INDEX membership_user_lookup ON public.company_memberships(user_id, company_id);

CREATE TABLE public.principals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('human', 'service', 'agent', 'policy')),
  user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  service_subject text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, id),
  UNIQUE(company_id, user_id),
  UNIQUE(company_id, service_subject),
  CHECK (
    (kind = 'human' AND user_id IS NOT NULL AND service_subject IS NULL) OR
    (kind <> 'human' AND user_id IS NULL AND service_subject IS NOT NULL)
  )
);

CREATE TABLE public.principal_scopes (
  company_id uuid NOT NULL,
  principal_id uuid NOT NULL,
  scope text NOT NULL CHECK (scope IN ('erp:read', 'erp:write')),
  PRIMARY KEY(company_id, principal_id, scope),
  FOREIGN KEY(company_id, principal_id) REFERENCES public.principals(company_id, id) ON DELETE RESTRICT
);

CREATE TABLE public.fiscal_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  fiscal_year int NOT NULL CHECK (fiscal_year BETWEEN 2000 AND 9999),
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closing', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, id),
  UNIQUE(company_id, start_date, end_date),
  CHECK (start_date <= end_date AND extract(year FROM start_date) = fiscal_year AND extract(year FROM end_date) = fiscal_year),
  EXCLUDE USING gist(company_id WITH =, daterange(start_date, end_date, '[]') WITH &&)
);

CREATE TABLE public.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (length(code) BETWEEN 1 AND 64),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  normal_side text NOT NULL CHECK (normal_side IN ('debit', 'credit')),
  mapping_version text NOT NULL DEFAULT 'demo-2026-v1',
  valid_from date NOT NULL DEFAULT '2026-01-01',
  valid_to date,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, id),
  UNIQUE(company_id, code),
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX account_kind_lookup ON public.accounts(company_id, kind);

CREATE TABLE public.source_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  document_type text NOT NULL,
  issue_date date NOT NULL,
  origin text NOT NULL CHECK (origin = 'synthetic_erp'),
  content jsonb NOT NULL CHECK (content ? 'origin' AND content ->> 'origin' = 'synthetic_erp'),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_path text, -- NULL means not uploaded to Supabase Storage.
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, id),
  UNIQUE(company_id, sha256)
);
CREATE INDEX document_date_lookup ON public.source_documents(company_id, issue_date);

CREATE TABLE public.business_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  period_id uuid NOT NULL,
  source_document_id uuid NOT NULL,
  external_ref text NOT NULL CHECK (length(external_ref) BETWEEN 1 AND 128),
  kind text NOT NULL CHECK (kind IN (
    'opening_capital', 'purchase', 'sale', 'receipt', 'payment',
    'payroll', 'asset_acquisition', 'prepayment', 'accrual', 'adjustment'
  )),
  occurred_on date NOT NULL,
  recognition_on date NOT NULL,
  currency char(3) NOT NULL CHECK (currency = 'KRW'),
  origin text NOT NULL CHECK (origin = 'synthetic_erp'),
  -- Unconstrained numeric prevents implicit scale rounding before CHECK evaluation.
  net_amount numeric NOT NULL CHECK (net_amount >= 0 AND net_amount < 1000000000000000000 AND net_amount = trunc(net_amount)),
  tax_amount numeric NOT NULL CHECK (tax_amount >= 0 AND tax_amount < 1000000000000000000 AND tax_amount = trunc(tax_amount)),
  gross_amount numeric NOT NULL CHECK (gross_amount >= 0 AND gross_amount < 1000000000000000000 AND gross_amount = trunc(gross_amount)),
  status text NOT NULL DEFAULT 'unprocessed' CHECK (status IN ('unprocessed', 'processing', 'waiting_approval', 'processed', 'failed')),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 128),
  payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  version int NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, id),
  UNIQUE(company_id, external_ref),
  UNIQUE(company_id, idempotency_key),
  CHECK (gross_amount = net_amount + tax_amount),
  FOREIGN KEY(company_id, period_id) REFERENCES public.fiscal_periods(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id, source_document_id) REFERENCES public.source_documents(company_id, id) ON DELETE RESTRICT
);
CREATE INDEX transaction_lookup ON public.business_transactions(company_id, recognition_on, id);
CREATE INDEX pending_transactions ON public.business_transactions(company_id, recognition_on, id)
  WHERE status = 'unprocessed';

CREATE TABLE private.seed_manifests (
  generator_version text NOT NULL,
  seed bigint NOT NULL CHECK (seed BETWEEN 0 AND 4294967295),
  manifest_hash char(64) NOT NULL CHECK (manifest_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(generator_version, seed)
);

-- Owned by the migration administrator. Clients cannot edit memberships/scopes.
-- Do not FORCE RLS on these helper-owned membership tables: avoid recursive policies.
CREATE FUNCTION private.has_company_scope(target_company uuid, required_scope text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.company_memberships m
    JOIN public.principals p ON p.company_id = m.company_id AND p.user_id = m.user_id
    JOIN public.principal_scopes s ON s.company_id = p.company_id AND s.principal_id = p.id
    WHERE m.company_id = target_company AND m.user_id = auth.uid()
      AND m.active AND (m.expires_at IS NULL OR m.expires_at > statement_timestamp())
      AND p.active AND p.kind = 'human' AND s.scope = required_scope
  );
$$;
REVOKE ALL ON FUNCTION private.has_company_scope(uuid,text) FROM PUBLIC;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.has_company_scope(uuid,text) TO authenticated;

CREATE FUNCTION private.check_transaction_period()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE selected_period public.fiscal_periods%ROWTYPE;
BEGIN
  SELECT * INTO selected_period FROM public.fiscal_periods
    WHERE id = NEW.period_id AND company_id = NEW.company_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'Invalid company/period reference';
  END IF;
  IF selected_period.status <> 'open' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PERIOD_CLOSED';
  END IF;
  IF NEW.recognition_on < selected_period.start_date OR NEW.recognition_on > selected_period.end_date THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Recognition date is outside the period';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.check_transaction_period() FROM PUBLIC;
CREATE TRIGGER transaction_period_guard BEFORE INSERT OR UPDATE
  ON public.business_transactions FOR EACH ROW EXECUTE FUNCTION private.check_transaction_period();

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.principals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.principal_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies FORCE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_periods FORCE ROW LEVEL SECURITY;
ALTER TABLE public.accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.source_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE public.business_transactions FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.companies, public.company_memberships, public.principals, public.principal_scopes,
  public.fiscal_periods, public.accounts, public.source_documents, public.business_transactions FROM anon, authenticated;
REVOKE ALL ON private.seed_manifests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.companies, public.company_memberships, public.principals, public.principal_scopes,
  public.fiscal_periods, public.accounts, public.source_documents, public.business_transactions TO authenticated;
GRANT INSERT ON public.source_documents, public.business_transactions TO authenticated;

CREATE POLICY company_read ON public.companies FOR SELECT TO authenticated
  USING (private.has_company_scope(id, 'erp:read'));
CREATE POLICY membership_self_read ON public.company_memberships FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY principal_self_read ON public.principals FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY scope_self_read ON public.principal_scopes FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.principals p
    WHERE p.id = public.principal_scopes.principal_id
      AND p.company_id = public.principal_scopes.company_id AND p.user_id = auth.uid()
  ));
CREATE POLICY period_read ON public.fiscal_periods FOR SELECT TO authenticated
  USING (private.has_company_scope(company_id, 'erp:read'));
CREATE POLICY account_read ON public.accounts FOR SELECT TO authenticated
  USING (private.has_company_scope(company_id, 'erp:read'));
CREATE POLICY document_read ON public.source_documents FOR SELECT TO authenticated
  USING (private.has_company_scope(company_id, 'erp:read'));
CREATE POLICY document_insert ON public.source_documents FOR INSERT TO authenticated
  WITH CHECK (private.has_company_scope(company_id, 'erp:write'));
CREATE POLICY transaction_read ON public.business_transactions FOR SELECT TO authenticated
  USING (private.has_company_scope(company_id, 'erp:read'));
CREATE POLICY transaction_insert ON public.business_transactions FOR INSERT TO authenticated
  WITH CHECK (private.has_company_scope(company_id, 'erp:write') AND status = 'unprocessed' AND version = 1);

COMMIT;
