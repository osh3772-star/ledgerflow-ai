BEGIN;
-- Opt-in web-session persistence. Never exposed through the public API schema.
-- Existing accounting/ERP rows and migrations 001~005 are unchanged.
CREATE TABLE private.human_sessions(
 company_id uuid NOT NULL REFERENCES public.companies(id),
 token_hash text NOT NULL CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 nonce bytea NOT NULL CHECK(octet_length(nonce)=12),
 ciphertext bytea NOT NULL CHECK(octet_length(ciphertext) BETWEEN 1 AND 32768),
 auth_tag bytea NOT NULL CHECK(octet_length(auth_tag)=16),
 expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(company_id,token_hash),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '30 minutes')
);
CREATE INDEX human_sessions_expiry ON private.human_sessions(company_id,expires_at);
ALTER TABLE private.human_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.human_sessions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON private.human_sessions FROM PUBLIC,anon,authenticated;
-- Only the trusted migration owner/server DB role receives a policy. Client
-- authenticated/anon roles have neither table grants nor an access policy.
DO $$BEGIN
 EXECUTE format('CREATE POLICY server_session_owner ON private.human_sessions TO %I USING(true) WITH CHECK(true)',current_user);
END;$$;
COMMIT;
