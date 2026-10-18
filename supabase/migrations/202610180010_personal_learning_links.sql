BEGIN;
-- One verified owner may retain multiple historical guest sessions.
ALTER TABLE private.guest_workspaces DROP CONSTRAINT guest_workspaces_claimed_user_id_key;
-- Browser-authenticated, short-lived setup tickets. Never store provider JWTs here.
CREATE TABLE private.remote_setup_tickets (
 code_hash char(64) PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id),
 company_id uuid NOT NULL REFERENCES public.companies(id),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
 redeemed_key_hash char(64), redeemed_at timestamptz,
 CHECK ((redeemed_at IS NULL)=(redeemed_key_hash IS NULL))
);
CREATE TABLE private.remote_learning_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id),
 access_hash char(64) NOT NULL UNIQUE, name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 revoked boolean NOT NULL DEFAULT false, CHECK (expires_at>created_at)
);
CREATE INDEX remote_learning_links_user ON private.remote_learning_links(user_id);
-- Keep the untouched sample company when adopting a guest with actual work.
CREATE TABLE private.remote_workspace_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id),
 previous_company_id uuid NOT NULL REFERENCES public.companies(id),
 company_id uuid NOT NULL REFERENCES public.companies(id), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (previous_company_id<>company_id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['remote_setup_tickets','remote_learning_links','remote_workspace_history'] LOOP
  EXECUTE format('ALTER TABLE private.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON private.%I FROM PUBLIC,anon,authenticated',t);
 END LOOP;
END;$$;
COMMIT;
