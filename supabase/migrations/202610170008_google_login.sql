-- Short-lived, single-use, encrypted Google PKCE state. No ledger changes.
BEGIN;
CREATE TABLE private.remote_login_flows (
 token_hash char(64) PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 encrypted_flow text NOT NULL,expires_at timestamptz NOT NULL
);
CREATE INDEX remote_login_expiry ON private.remote_login_flows(expires_at);
ALTER TABLE private.remote_login_flows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.remote_login_flows FROM PUBLIC,anon,authenticated;
COMMIT;
