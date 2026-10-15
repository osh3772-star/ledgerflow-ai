-- P2-B2: synthetic ERP subledgers. Requires the P2-A migration.
-- Test Auth bootstrap is a separate local-only file, never a Supabase migration.
BEGIN;

CREATE DOMAIN private.erp_won AS numeric
  CHECK(VALUE>=0 AND VALUE<1000000000000000000 AND VALUE=trunc(VALUE));
CREATE DOMAIN private.erp_quantity AS numeric
  CHECK(VALUE>0 AND VALUE<1000000000000 AND VALUE=trunc(VALUE));

CREATE TABLE public.counterparties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  origin text NOT NULL CHECK(origin='synthetic_erp'),
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
  role text NOT NULL CHECK(role IN ('customer','supplier')),
  registration_number text CHECK(registration_number IS NULL),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,id)
);

CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  origin text NOT NULL CHECK(origin='synthetic_erp'),
  sku text NOT NULL CHECK(length(sku) BETWEEN 1 AND 64),
  unit_cost private.erp_won NOT NULL,
  unit_price private.erp_won NOT NULL,
  UNIQUE(company_id,sku),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,id)
);

CREATE TABLE public.bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  origin text NOT NULL CHECK(origin='synthetic_erp'),
  label text NOT NULL CHECK(length(label) BETWEEN 1 AND 100),
  account_number text CHECK(account_number IS NULL),
  UNIQUE(company_id,label),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,id)
);

CREATE TABLE public.sales_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  origin text NOT NULL CHECK(origin='synthetic_erp'),
  transaction_id uuid NOT NULL,
  counterparty_id uuid NOT NULL,
  delivered_on date NOT NULL,
  performance_obligations integer NOT NULL CHECK(performance_obligations > 0),
  UNIQUE(company_id,transaction_id),
  FOREIGN KEY(company_id,transaction_id) REFERENCES public.business_transactions(company_id,id),
  FOREIGN KEY(company_id,counterparty_id) REFERENCES public.counterparties(company_id,id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,id)
);

CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  origin text NOT NULL CHECK(origin='synthetic_erp'),
  number text NOT NULL CHECK(length(number) BETWEEN 1 AND 160),
  transaction_id uuid NOT NULL,
  source_document_id uuid NOT NULL,
  counterparty_id uuid NOT NULL,
  direction text NOT NULL CHECK(direction IN ('sale','purchase')),
  issue_date date NOT NULL,
  net_amount private.erp_won NOT NULL,
  tax_amount private.erp_won NOT NULL,
  gross_amount private.erp_won NOT NULL,
  government_issued boolean NOT NULL DEFAULT false CHECK(NOT government_issued),
  CHECK(gross_amount=net_amount+tax_amount),
  UNIQUE(company_id,number),
  UNIQUE(company_id,transaction_id),
  FOREIGN KEY(company_id,transaction_id) REFERENCES public.business_transactions(company_id,id),
  FOREIGN KEY(company_id,source_document_id) REFERENCES public.source_documents(company_id,id),
  FOREIGN KEY(company_id,counterparty_id) REFERENCES public.counterparties(company_id,id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,id)
);

CREATE TABLE public.invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  origin text NOT NULL CHECK(origin='synthetic_erp'),
  invoice_id uuid NOT NULL,
  product_id uuid,
  description text NOT NULL CHECK(length(description) BETWEEN 1 AND 200),
  quantity private.erp_quantity NOT NULL,
  unit_price private.erp_won NOT NULL,
  net_amount private.erp_won NOT NULL,
  CHECK(net_amount=quantity*unit_price),
  FOREIGN KEY(company_id,invoice_id) REFERENCES public.invoices(company_id,id),
  FOREIGN KEY(company_id,product_id) REFERENCES public.products(company_id,id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,id)
);

CREATE TABLE public.inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  origin text NOT NULL CHECK(origin='synthetic_erp'),
  transaction_id uuid NOT NULL,
  product_id uuid NOT NULL,
  occurred_on date NOT NULL,
  direction text NOT NULL CHECK(direction IN ('in','out')),
  quantity private.erp_quantity NOT NULL,
  unit_cost private.erp_won NOT NULL,
  UNIQUE(company_id,transaction_id,product_id,direction),
  FOREIGN KEY(company_id,transaction_id) REFERENCES public.business_transactions(company_id,id),
  FOREIGN KEY(company_id,product_id) REFERENCES public.products(company_id,id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,id)
);

CREATE TABLE public.bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  origin text NOT NULL CHECK(origin='synthetic_erp'),
  bank_account_id uuid NOT NULL,
  transaction_id uuid NOT NULL,
  booked_on date NOT NULL,
  direction text NOT NULL CHECK(direction IN ('in','out')),
  amount private.erp_won NOT NULL CHECK(amount>0),
  currency char(3) NOT NULL DEFAULT 'KRW' CHECK(currency='KRW'),
  UNIQUE(company_id,transaction_id,bank_account_id),
  FOREIGN KEY(company_id,bank_account_id) REFERENCES public.bank_accounts(company_id,id),
  FOREIGN KEY(company_id,transaction_id) REFERENCES public.business_transactions(company_id,id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,id)
);

CREATE TABLE public.settlement_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  origin text NOT NULL CHECK(origin='synthetic_erp'),
  bank_transaction_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  transaction_id uuid NOT NULL,
  amount private.erp_won NOT NULL CHECK(amount>0),
  UNIQUE(company_id,bank_transaction_id,invoice_id),
  FOREIGN KEY(company_id,bank_transaction_id) REFERENCES public.bank_transactions(company_id,id),
  FOREIGN KEY(company_id,invoice_id) REFERENCES public.invoices(company_id,id),
  FOREIGN KEY(company_id,transaction_id) REFERENCES public.business_transactions(company_id,id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,id)
);

CREATE TABLE public.fixed_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  origin text NOT NULL CHECK(origin='synthetic_erp'),
  transaction_id uuid NOT NULL,
  acquired_on date NOT NULL,
  available_on date NOT NULL,
  cost private.erp_won NOT NULL,
  residual private.erp_won NOT NULL,
  useful_life_months integer NOT NULL CHECK(useful_life_months BETWEEN 1 AND 1200),
  monthly_depreciation private.erp_won NOT NULL,
  CHECK(residual<=cost AND monthly_depreciation<=cost-residual AND available_on>=acquired_on),
  UNIQUE(company_id,transaction_id),
  FOREIGN KEY(company_id,transaction_id) REFERENCES public.business_transactions(company_id,id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,id)
);

CREATE TABLE public.prepayments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  origin text NOT NULL CHECK(origin='synthetic_erp'),
  transaction_id uuid NOT NULL,
  coverage_start date NOT NULL,
  coverage_end date NOT NULL,
  cost private.erp_won NOT NULL,
  monthly_expense private.erp_won NOT NULL CHECK(monthly_expense>0),
  CHECK(coverage_start<=coverage_end AND monthly_expense<=cost),
  UNIQUE(company_id,transaction_id),
  FOREIGN KEY(company_id,transaction_id) REFERENCES public.business_transactions(company_id,id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,id)
);

CREATE TABLE public.payrolls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  origin text NOT NULL CHECK(origin='synthetic_erp'),
  transaction_id uuid NOT NULL,
  employee_ref text NOT NULL CHECK(employee_ref LIKE 'SYNTHETIC-EMP-%'),
  gross private.erp_won NOT NULL,
  withholding private.erp_won NOT NULL,
  net_pay private.erp_won NOT NULL,
  statutory_calculation boolean NOT NULL CHECK(NOT statutory_calculation),
  CHECK(gross=withholding+net_pay),
  UNIQUE(company_id,transaction_id),
  FOREIGN KEY(company_id,transaction_id) REFERENCES public.business_transactions(company_id,id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,id)
);

CREATE TABLE public.accruals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  origin text NOT NULL CHECK(origin='synthetic_erp'),
  transaction_id uuid NOT NULL,
  service_start date NOT NULL,
  service_end date NOT NULL,
  amount private.erp_won NOT NULL,
  reversal_on date NOT NULL,
  CHECK(service_start<=service_end AND reversal_on>service_end),
  UNIQUE(company_id,transaction_id),
  FOREIGN KEY(company_id,transaction_id) REFERENCES public.business_transactions(company_id,id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,id)
);

CREATE TABLE public.adjustment_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  origin text NOT NULL CHECK(origin='synthetic_erp'),
  transaction_id uuid NOT NULL,
  type text NOT NULL CHECK(type IN ('depreciation','prepaid_expense')),
  asset_id uuid,
  prepayment_id uuid,
  effective_on date NOT NULL,
  amount private.erp_won NOT NULL,
  posting_state text NOT NULL CHECK(posting_state='proposed'),
  CHECK((type='depreciation' AND asset_id IS NOT NULL AND prepayment_id IS NULL) OR
        (type='prepaid_expense' AND asset_id IS NULL AND prepayment_id IS NOT NULL)),
  UNIQUE(company_id,transaction_id),
  UNIQUE(company_id,asset_id,effective_on),
  UNIQUE(company_id,prepayment_id,effective_on),
  FOREIGN KEY(company_id,transaction_id) REFERENCES public.business_transactions(company_id,id),
  FOREIGN KEY(company_id,asset_id) REFERENCES public.fixed_assets(company_id,id),
  FOREIGN KEY(company_id,prepayment_id) REFERENCES public.prepayments(company_id,id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,id)
);

CREATE INDEX invoice_date_lookup ON public.invoices(company_id,issue_date,id);
CREATE INDEX invoice_counterparty_lookup ON public.invoices(company_id,counterparty_id);
CREATE INDEX invoice_line_lookup ON public.invoice_lines(company_id,invoice_id);
CREATE INDEX inventory_product_lookup ON public.inventory_movements(company_id,product_id,occurred_on,id);
CREATE INDEX bank_date_lookup ON public.bank_transactions(company_id,bank_account_id,booked_on,id);
CREATE INDEX allocation_invoice_lookup ON public.settlement_allocations(company_id,invoice_id);
CREATE INDEX allocation_bank_lookup ON public.settlement_allocations(company_id,bank_transaction_id);
CREATE INDEX proposal_period_lookup ON public.adjustment_proposals(company_id,effective_on);

CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  trace_id uuid NOT NULL,
  actor_user_id uuid REFERENCES auth.users(id),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL CHECK(action='erp_insert'),
  origin text NOT NULL CHECK(origin='synthetic_erp'),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_entity_lookup ON public.audit_logs(company_id,entity_type,entity_id,occurred_at);
CREATE INDEX audit_trace_lookup ON public.audit_logs(company_id,trace_id);

CREATE FUNCTION private.record_erp_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  INSERT INTO public.audit_logs(company_id,trace_id,actor_user_id,entity_type,entity_id,action,origin)
  VALUES(NEW.company_id,coalesce(nullif(current_setting('ledgerflow.trace_id',true),'')::uuid,gen_random_uuid()),
    auth.uid(),TG_TABLE_NAME,NEW.id,'erp_insert','synthetic_erp');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.record_erp_insert() FROM PUBLIC;

CREATE FUNCTION private.reject_erp_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='ERP_SOURCE_IMMUTABLE: import corrections as new source events';
END;
$$;
REVOKE ALL ON FUNCTION private.reject_erp_mutation() FROM PUBLIC;

-- Lock the fiscal period even when adding a child to an existing transaction.
CREATE FUNCTION private.check_erp_source_period()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source public.business_transactions%ROWTYPE; period_state text; source_id uuid;
BEGIN
  source_id := CASE WHEN TG_TABLE_NAME='invoice_lines' THEN
    (SELECT transaction_id FROM public.invoices WHERE company_id=NEW.company_id AND id=(to_jsonb(NEW)->>'invoice_id')::uuid)
    ELSE (to_jsonb(NEW)->>'transaction_id')::uuid END;
  SELECT * INTO source FROM public.business_transactions WHERE company_id=NEW.company_id AND id=source_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='ERP_SOURCE_REFERENCE'; END IF;
  SELECT status INTO period_state FROM public.fiscal_periods
    WHERE company_id=source.company_id AND id=source.period_id FOR UPDATE;
  IF period_state<>'open' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PERIOD_CLOSED'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.check_erp_source_period() FROM PUBLIC;

-- Trusted backend/importer only. Lock bank first, then invoice, in every writer.
-- The parent UPDATE acts as a serialization point under REPEATABLE READ as well;
-- transactions with an old snapshot must retry rather than over-allocate.
CREATE FUNCTION private.check_settlement_allocation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE cash public.bank_transactions%ROWTYPE; bill public.invoices%ROWTYPE;
  used_cash numeric; used_bill numeric; source_kind text;
BEGIN
  SELECT * INTO cash FROM public.bank_transactions
    WHERE company_id=NEW.company_id AND id=NEW.bank_transaction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='ALLOCATION_BANK_REFERENCE'; END IF;
  SELECT * INTO bill FROM public.invoices WHERE company_id=NEW.company_id AND id=NEW.invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='ALLOCATION_INVOICE_REFERENCE'; END IF;
  SELECT kind INTO source_kind FROM public.business_transactions WHERE company_id=NEW.company_id AND id=NEW.transaction_id;
  IF cash.transaction_id<>NEW.transaction_id OR
    NOT((bill.direction='sale' AND cash.direction='in' AND source_kind='receipt') OR
        (bill.direction='purchase' AND cash.direction='out' AND source_kind='payment')) OR
    cash.booked_on<bill.issue_date THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='ALLOCATION_SOURCE_MISMATCH';
  END IF;
  SELECT coalesce(sum(amount),0) INTO used_cash FROM public.settlement_allocations
    WHERE company_id=NEW.company_id AND bank_transaction_id=cash.id;
  SELECT coalesce(sum(amount),0) INTO used_bill FROM public.settlement_allocations
    WHERE company_id=NEW.company_id AND invoice_id=bill.id;
  IF used_cash+NEW.amount>cash.amount OR used_bill+NEW.amount>bill.gross_amount THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='ALLOCATION_EXCEEDS_SOURCE';
  END IF;
  -- Only a lock-version field changes; the financial source columns stay intact.
  UPDATE public.bank_transactions SET allocation_version=allocation_version+1 WHERE id=cash.id;
  UPDATE public.invoices SET allocation_version=allocation_version+1 WHERE id=bill.id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.check_settlement_allocation() FROM PUBLIC;
ALTER TABLE public.bank_transactions ADD COLUMN allocation_version bigint NOT NULL DEFAULT 0 CHECK(allocation_version>=0);
ALTER TABLE public.invoices ADD COLUMN allocation_version bigint NOT NULL DEFAULT 0 CHECK(allocation_version>=0);

CREATE TRIGGER allocation_limit_guard BEFORE INSERT ON public.settlement_allocations
  FOR EACH ROW EXECUTE FUNCTION private.check_settlement_allocation();

-- Deferred checks see the complete atomic source package, including its lines.
CREATE FUNCTION private.validate_erp_package()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source public.business_transactions%ROWTYPE; bill public.invoices%ROWTYPE;
  tx_id uuid; gross numeric; asset public.fixed_assets%ROWTYPE; prepaid public.prepayments%ROWTYPE;
BEGIN
  tx_id := CASE WHEN TG_TABLE_NAME='invoice_lines' THEN
    (SELECT transaction_id FROM public.invoices WHERE company_id=NEW.company_id AND id=(to_jsonb(NEW)->>'invoice_id')::uuid)
    ELSE (to_jsonb(NEW)->>'transaction_id')::uuid END;
  SELECT * INTO source FROM public.business_transactions WHERE company_id=NEW.company_id AND id=tx_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='ERP_SOURCE_REFERENCE'; END IF;
  CASE TG_TABLE_NAME
    WHEN 'invoices','invoice_lines' THEN
      SELECT * INTO bill FROM public.invoices WHERE company_id=NEW.company_id AND transaction_id=tx_id;
      IF source.kind NOT IN ('sale','purchase','asset_acquisition') OR
        bill.direction<>(CASE WHEN source.kind='sale' THEN 'sale' ELSE 'purchase' END) OR
        bill.source_document_id<>source.source_document_id OR bill.issue_date<>source.occurred_on OR
        bill.net_amount<>source.net_amount OR bill.tax_amount<>source.tax_amount OR bill.gross_amount<>source.gross_amount OR
        NOT EXISTS(SELECT 1 FROM public.invoice_lines WHERE company_id=NEW.company_id AND invoice_id=bill.id) OR
        (SELECT sum(net_amount) FROM public.invoice_lines WHERE company_id=NEW.company_id AND invoice_id=bill.id)<>bill.net_amount OR
        NOT EXISTS(SELECT 1 FROM public.counterparties WHERE company_id=NEW.company_id AND id=bill.counterparty_id
          AND role=CASE WHEN source.kind='sale' THEN 'customer' ELSE 'supplier' END) THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_PACKAGE_MISMATCH';
      END IF;
    WHEN 'sales_contracts' THEN
      IF source.kind<>'sale' OR NEW.delivered_on>source.recognition_on OR
        NOT EXISTS(SELECT 1 FROM public.counterparties WHERE company_id=NEW.company_id AND id=NEW.counterparty_id AND role='customer') OR
        NOT EXISTS(SELECT 1 FROM public.invoices WHERE company_id=NEW.company_id AND transaction_id=source.id AND counterparty_id=NEW.counterparty_id) THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CONTRACT_SOURCE_MISMATCH';
      END IF;
    WHEN 'inventory_movements' THEN
      IF source.kind<>(CASE WHEN NEW.direction='in' THEN 'purchase' ELSE 'sale' END) OR NEW.occurred_on<>source.recognition_on OR
        NOT EXISTS(SELECT 1 FROM public.invoices i JOIN public.invoice_lines l ON l.company_id=i.company_id AND l.invoice_id=i.id
          WHERE i.company_id=NEW.company_id AND i.transaction_id=source.id AND l.product_id=NEW.product_id AND l.quantity=NEW.quantity) OR
        NOT EXISTS(SELECT 1 FROM public.products WHERE company_id=NEW.company_id AND id=NEW.product_id AND unit_cost=NEW.unit_cost) THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVENTORY_SOURCE_MISMATCH';
      END IF;
    WHEN 'bank_transactions' THEN
      SELECT sum(amount) INTO gross FROM public.bank_transactions WHERE company_id=NEW.company_id AND transaction_id=source.id;
      IF NEW.booked_on<>source.recognition_on OR
        NOT((source.kind IN ('opening_capital','receipt') AND NEW.direction='in') OR
          (source.kind IN ('payment','payroll','asset_acquisition','prepayment') AND NEW.direction='out')) OR
        gross<>(CASE WHEN source.kind='payroll' THEN
          (SELECT net_pay FROM public.payrolls WHERE company_id=NEW.company_id AND transaction_id=source.id)
          ELSE source.gross_amount END) OR
        (source.kind='payroll' AND NOT EXISTS(SELECT 1 FROM public.payrolls WHERE company_id=NEW.company_id AND transaction_id=source.id)) THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='BANK_SOURCE_MISMATCH';
      END IF;
    WHEN 'fixed_assets' THEN
      IF source.kind<>'asset_acquisition' OR NEW.cost<>source.net_amount OR NEW.acquired_on<>source.occurred_on THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='ASSET_SOURCE_MISMATCH';
      END IF;
    WHEN 'prepayments' THEN
      IF source.kind<>'prepayment' OR NEW.cost<>source.net_amount OR NEW.coverage_start<>source.occurred_on THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PREPAYMENT_SOURCE_MISMATCH';
      END IF;
    WHEN 'payrolls' THEN
      IF source.kind<>'payroll' OR NEW.gross<>source.gross_amount OR
        (SELECT coalesce(sum(amount),0) FROM public.bank_transactions WHERE company_id=NEW.company_id AND transaction_id=source.id)<>NEW.net_pay THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PAYROLL_SOURCE_MISMATCH';
      END IF;
    WHEN 'accruals' THEN
      IF source.kind<>'accrual' OR NEW.amount<>source.net_amount OR NEW.service_end<>source.recognition_on THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='ACCRUAL_SOURCE_MISMATCH';
      END IF;
    WHEN 'adjustment_proposals' THEN
      IF source.kind<>'adjustment' OR NEW.effective_on<>source.recognition_on OR NEW.amount<>source.net_amount OR
        NEW.effective_on<>(date_trunc('month',NEW.effective_on)+interval '1 month - 1 day')::date THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='ADJUSTMENT_SOURCE_MISMATCH';
      END IF;
      IF NEW.type='depreciation' THEN
        SELECT * INTO asset FROM public.fixed_assets WHERE company_id=NEW.company_id AND id=NEW.asset_id;
        IF NEW.effective_on<asset.available_on OR NEW.amount<>asset.monthly_depreciation OR
          (SELECT sum(amount) FROM public.adjustment_proposals WHERE company_id=NEW.company_id AND asset_id=asset.id)>asset.cost-asset.residual THEN
          RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DEPRECIATION_SOURCE_MISMATCH';
        END IF;
      ELSE
        SELECT * INTO prepaid FROM public.prepayments WHERE company_id=NEW.company_id AND id=NEW.prepayment_id;
        IF NEW.effective_on NOT BETWEEN prepaid.coverage_start AND prepaid.coverage_end OR NEW.amount<>prepaid.monthly_expense OR
          (SELECT sum(amount) FROM public.adjustment_proposals WHERE company_id=NEW.company_id AND prepayment_id=prepaid.id)>prepaid.cost THEN
          RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PREPAID_SOURCE_MISMATCH';
        END IF;
      END IF;
    ELSE NULL;
  END CASE;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.validate_erp_package() FROM PUBLIC;

ALTER TABLE public.counterparties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.counterparties FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.counterparties FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.counterparties TO authenticated;
CREATE POLICY counterparties_read ON public.counterparties FOR SELECT TO authenticated
  USING(private.has_company_scope(company_id,'erp:read'));
CREATE TRIGGER counterparties_audit AFTER INSERT ON public.counterparties
  FOR EACH ROW EXECUTE FUNCTION private.record_erp_insert();
GRANT INSERT ON public.counterparties TO authenticated;
CREATE POLICY counterparties_insert ON public.counterparties FOR INSERT TO authenticated
  WITH CHECK(private.has_company_scope(company_id,'erp:write'));

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.products FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.products TO authenticated;
CREATE POLICY products_read ON public.products FOR SELECT TO authenticated
  USING(private.has_company_scope(company_id,'erp:read'));
CREATE TRIGGER products_audit AFTER INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION private.record_erp_insert();
GRANT INSERT ON public.products TO authenticated;
CREATE POLICY products_insert ON public.products FOR INSERT TO authenticated
  WITH CHECK(private.has_company_scope(company_id,'erp:write'));

ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_accounts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.bank_accounts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.bank_accounts TO authenticated;
CREATE POLICY bank_accounts_read ON public.bank_accounts FOR SELECT TO authenticated
  USING(private.has_company_scope(company_id,'erp:read'));
CREATE TRIGGER bank_accounts_audit AFTER INSERT ON public.bank_accounts
  FOR EACH ROW EXECUTE FUNCTION private.record_erp_insert();
GRANT INSERT ON public.bank_accounts TO authenticated;
CREATE POLICY bank_accounts_insert ON public.bank_accounts FOR INSERT TO authenticated
  WITH CHECK(private.has_company_scope(company_id,'erp:write'));

ALTER TABLE public.sales_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_contracts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_contracts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.sales_contracts TO authenticated;
CREATE POLICY sales_contracts_read ON public.sales_contracts FOR SELECT TO authenticated
  USING(private.has_company_scope(company_id,'erp:read'));
CREATE TRIGGER sales_contracts_audit AFTER INSERT ON public.sales_contracts
  FOR EACH ROW EXECUTE FUNCTION private.record_erp_insert();
GRANT INSERT ON public.sales_contracts TO authenticated;
CREATE POLICY sales_contracts_insert ON public.sales_contracts FOR INSERT TO authenticated
  WITH CHECK(private.has_company_scope(company_id,'erp:write'));
CREATE TRIGGER sales_contracts_period BEFORE INSERT ON public.sales_contracts
  FOR EACH ROW EXECUTE FUNCTION private.check_erp_source_period();
CREATE CONSTRAINT TRIGGER sales_contracts_package AFTER INSERT ON public.sales_contracts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.validate_erp_package();

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.invoices FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.invoices TO authenticated;
CREATE POLICY invoices_read ON public.invoices FOR SELECT TO authenticated
  USING(private.has_company_scope(company_id,'erp:read'));
CREATE TRIGGER invoices_audit AFTER INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION private.record_erp_insert();
GRANT INSERT ON public.invoices TO authenticated;
CREATE POLICY invoices_insert ON public.invoices FOR INSERT TO authenticated
  WITH CHECK(private.has_company_scope(company_id,'erp:write'));
CREATE TRIGGER invoices_period BEFORE INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION private.check_erp_source_period();
CREATE CONSTRAINT TRIGGER invoices_package AFTER INSERT ON public.invoices
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.validate_erp_package();

ALTER TABLE public.invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_lines FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.invoice_lines FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.invoice_lines TO authenticated;
CREATE POLICY invoice_lines_read ON public.invoice_lines FOR SELECT TO authenticated
  USING(private.has_company_scope(company_id,'erp:read'));
CREATE TRIGGER invoice_lines_audit AFTER INSERT ON public.invoice_lines
  FOR EACH ROW EXECUTE FUNCTION private.record_erp_insert();
GRANT INSERT ON public.invoice_lines TO authenticated;
CREATE POLICY invoice_lines_insert ON public.invoice_lines FOR INSERT TO authenticated
  WITH CHECK(private.has_company_scope(company_id,'erp:write'));
CREATE TRIGGER invoice_lines_period BEFORE INSERT ON public.invoice_lines
  FOR EACH ROW EXECUTE FUNCTION private.check_erp_source_period();
CREATE CONSTRAINT TRIGGER invoice_lines_package AFTER INSERT ON public.invoice_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.validate_erp_package();

ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.inventory_movements FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.inventory_movements TO authenticated;
CREATE POLICY inventory_movements_read ON public.inventory_movements FOR SELECT TO authenticated
  USING(private.has_company_scope(company_id,'erp:read'));
CREATE TRIGGER inventory_movements_audit AFTER INSERT ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION private.record_erp_insert();
GRANT INSERT ON public.inventory_movements TO authenticated;
CREATE POLICY inventory_movements_insert ON public.inventory_movements FOR INSERT TO authenticated
  WITH CHECK(private.has_company_scope(company_id,'erp:write'));
CREATE TRIGGER inventory_movements_period BEFORE INSERT ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION private.check_erp_source_period();
CREATE CONSTRAINT TRIGGER inventory_movements_package AFTER INSERT ON public.inventory_movements
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.validate_erp_package();

ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_transactions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.bank_transactions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.bank_transactions TO authenticated;
CREATE POLICY bank_transactions_read ON public.bank_transactions FOR SELECT TO authenticated
  USING(private.has_company_scope(company_id,'erp:read'));
CREATE TRIGGER bank_transactions_audit AFTER INSERT ON public.bank_transactions
  FOR EACH ROW EXECUTE FUNCTION private.record_erp_insert();
GRANT INSERT ON public.bank_transactions TO authenticated;
CREATE POLICY bank_transactions_insert ON public.bank_transactions FOR INSERT TO authenticated
  WITH CHECK(private.has_company_scope(company_id,'erp:write'));
CREATE TRIGGER bank_transactions_period BEFORE INSERT ON public.bank_transactions
  FOR EACH ROW EXECUTE FUNCTION private.check_erp_source_period();
CREATE CONSTRAINT TRIGGER bank_transactions_package AFTER INSERT ON public.bank_transactions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.validate_erp_package();

ALTER TABLE public.settlement_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_allocations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.settlement_allocations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.settlement_allocations TO authenticated;
CREATE POLICY settlement_allocations_read ON public.settlement_allocations FOR SELECT TO authenticated
  USING(private.has_company_scope(company_id,'erp:read'));
CREATE TRIGGER settlement_allocations_audit AFTER INSERT ON public.settlement_allocations
  FOR EACH ROW EXECUTE FUNCTION private.record_erp_insert();
CREATE TRIGGER settlement_allocations_period BEFORE INSERT ON public.settlement_allocations
  FOR EACH ROW EXECUTE FUNCTION private.check_erp_source_period();

ALTER TABLE public.fixed_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fixed_assets FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.fixed_assets FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.fixed_assets TO authenticated;
CREATE POLICY fixed_assets_read ON public.fixed_assets FOR SELECT TO authenticated
  USING(private.has_company_scope(company_id,'erp:read'));
CREATE TRIGGER fixed_assets_audit AFTER INSERT ON public.fixed_assets
  FOR EACH ROW EXECUTE FUNCTION private.record_erp_insert();
GRANT INSERT ON public.fixed_assets TO authenticated;
CREATE POLICY fixed_assets_insert ON public.fixed_assets FOR INSERT TO authenticated
  WITH CHECK(private.has_company_scope(company_id,'erp:write'));
CREATE TRIGGER fixed_assets_period BEFORE INSERT ON public.fixed_assets
  FOR EACH ROW EXECUTE FUNCTION private.check_erp_source_period();
CREATE CONSTRAINT TRIGGER fixed_assets_package AFTER INSERT ON public.fixed_assets
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.validate_erp_package();

ALTER TABLE public.prepayments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prepayments FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.prepayments FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.prepayments TO authenticated;
CREATE POLICY prepayments_read ON public.prepayments FOR SELECT TO authenticated
  USING(private.has_company_scope(company_id,'erp:read'));
CREATE TRIGGER prepayments_audit AFTER INSERT ON public.prepayments
  FOR EACH ROW EXECUTE FUNCTION private.record_erp_insert();
GRANT INSERT ON public.prepayments TO authenticated;
CREATE POLICY prepayments_insert ON public.prepayments FOR INSERT TO authenticated
  WITH CHECK(private.has_company_scope(company_id,'erp:write'));
CREATE TRIGGER prepayments_period BEFORE INSERT ON public.prepayments
  FOR EACH ROW EXECUTE FUNCTION private.check_erp_source_period();
CREATE CONSTRAINT TRIGGER prepayments_package AFTER INSERT ON public.prepayments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.validate_erp_package();

ALTER TABLE public.payrolls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payrolls FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.payrolls FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.payrolls TO authenticated;
CREATE POLICY payrolls_read ON public.payrolls FOR SELECT TO authenticated
  USING(private.has_company_scope(company_id,'erp:read'));
CREATE TRIGGER payrolls_audit AFTER INSERT ON public.payrolls
  FOR EACH ROW EXECUTE FUNCTION private.record_erp_insert();
GRANT INSERT ON public.payrolls TO authenticated;
CREATE POLICY payrolls_insert ON public.payrolls FOR INSERT TO authenticated
  WITH CHECK(private.has_company_scope(company_id,'erp:write'));
CREATE TRIGGER payrolls_period BEFORE INSERT ON public.payrolls
  FOR EACH ROW EXECUTE FUNCTION private.check_erp_source_period();
CREATE CONSTRAINT TRIGGER payrolls_package AFTER INSERT ON public.payrolls
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.validate_erp_package();

ALTER TABLE public.accruals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accruals FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.accruals FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.accruals TO authenticated;
CREATE POLICY accruals_read ON public.accruals FOR SELECT TO authenticated
  USING(private.has_company_scope(company_id,'erp:read'));
CREATE TRIGGER accruals_audit AFTER INSERT ON public.accruals
  FOR EACH ROW EXECUTE FUNCTION private.record_erp_insert();
GRANT INSERT ON public.accruals TO authenticated;
CREATE POLICY accruals_insert ON public.accruals FOR INSERT TO authenticated
  WITH CHECK(private.has_company_scope(company_id,'erp:write'));
CREATE TRIGGER accruals_period BEFORE INSERT ON public.accruals
  FOR EACH ROW EXECUTE FUNCTION private.check_erp_source_period();
CREATE CONSTRAINT TRIGGER accruals_package AFTER INSERT ON public.accruals
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.validate_erp_package();

ALTER TABLE public.adjustment_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.adjustment_proposals FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.adjustment_proposals FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.adjustment_proposals TO authenticated;
CREATE POLICY adjustment_proposals_read ON public.adjustment_proposals FOR SELECT TO authenticated
  USING(private.has_company_scope(company_id,'erp:read'));
CREATE TRIGGER adjustment_proposals_audit AFTER INSERT ON public.adjustment_proposals
  FOR EACH ROW EXECUTE FUNCTION private.record_erp_insert();
CREATE TRIGGER adjustment_proposals_period BEFORE INSERT ON public.adjustment_proposals
  FOR EACH ROW EXECUTE FUNCTION private.check_erp_source_period();
CREATE CONSTRAINT TRIGGER adjustment_proposals_package AFTER INSERT ON public.adjustment_proposals
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.validate_erp_package();

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_logs FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.audit_logs TO authenticated;
CREATE POLICY audit_read ON public.audit_logs FOR SELECT TO authenticated
  USING(private.has_company_scope(company_id,'erp:read'));
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION private.reject_erp_mutation();
CREATE TRIGGER document_erp_audit AFTER INSERT ON public.source_documents
  FOR EACH ROW EXECUTE FUNCTION private.record_erp_insert();
CREATE TRIGGER transaction_erp_audit AFTER INSERT ON public.business_transactions
  FOR EACH ROW EXECUTE FUNCTION private.record_erp_insert();

COMMIT;

