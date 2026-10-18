BEGIN;

-- Connection diagnostics only. No ledger/approval authority is granted here.
CREATE TABLE private.client_connection_setups (
  handoff_hash text PRIMARY KEY CHECK (handoff_hash ~ '^[a-f0-9]{64}$'),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  owner_user_id uuid REFERENCES auth.users(id),
  access_hash text NOT NULL CHECK (access_hash ~ '^[a-f0-9]{64}$'),
  encrypted_payload text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  opened_at timestamptz,
  browser_hash text UNIQUE,
  browser_expires_at timestamptz,
  client_name text CHECK (length(client_name) <= 100),
  status_checked_at timestamptz,
  context_checked_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK ((browser_hash IS NULL) = (browser_expires_at IS NULL))
);
CREATE INDEX client_connection_setups_access ON private.client_connection_setups(access_hash, expires_at);
CREATE INDEX client_connection_setups_expiry ON private.client_connection_setups(expires_at);
ALTER TABLE private.client_connection_setups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.client_connection_setups FROM PUBLIC, anon, authenticated;

COMMIT;
