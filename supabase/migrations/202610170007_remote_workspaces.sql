-- Remote tenancy and OAuth. Existing journal payloads, hashes and controls stay intact.
BEGIN;
CREATE TABLE private.execution_actors (
 id uuid PRIMARY KEY, user_id uuid UNIQUE REFERENCES auth.users(id),
 company_id uuid REFERENCES public.companies(id),
 CHECK ((user_id IS NOT NULL AND id=user_id AND company_id IS NULL) OR (user_id IS NULL AND company_id IS NOT NULL))
);
INSERT INTO private.execution_actors(id,user_id) SELECT id,id FROM auth.users;
CREATE FUNCTION private.register_human_actor() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN INSERT INTO private.execution_actors(id,user_id) VALUES(NEW.id,NEW.id); RETURN NEW; END;$$;
CREATE TRIGGER ledgerflow_human_actor AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION private.register_human_actor();
CREATE TABLE private.remote_workspaces (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id), company_id uuid NOT NULL UNIQUE REFERENCES public.companies(id),
 writer_id uuid NOT NULL UNIQUE REFERENCES private.execution_actors(id), created_at timestamptz NOT NULL DEFAULT now()
);
-- A service actor has no Supabase login and cannot obtain a human approval scope.
ALTER TABLE public.journal_entries DROP CONSTRAINT journal_entries_created_by_fkey;
ALTER TABLE public.journal_entries ADD CONSTRAINT journal_entries_created_by_fkey FOREIGN KEY(created_by) REFERENCES private.execution_actors(id);
ALTER TABLE public.approval_requests DROP CONSTRAINT approval_requests_requested_by_fkey;
ALTER TABLE public.approval_requests ADD CONSTRAINT approval_requests_requested_by_fkey FOREIGN KEY(requested_by) REFERENCES private.execution_actors(id);
ALTER TABLE public.agent_runs DROP CONSTRAINT agent_runs_created_by_fkey;
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_created_by_fkey FOREIGN KEY(created_by) REFERENCES private.execution_actors(id);
ALTER TABLE public.audit_logs DROP CONSTRAINT audit_logs_actor_user_id_fkey;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_actor_user_id_fkey FOREIGN KEY(actor_user_id) REFERENCES private.execution_actors(id);
CREATE OR REPLACE FUNCTION private.has_company_scope(target_company uuid,required_scope text) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS (
  SELECT 1 FROM public.company_memberships m
  JOIN public.principals p ON p.company_id=m.company_id AND p.user_id=m.user_id
  JOIN public.principal_scopes s ON s.company_id=p.company_id AND s.principal_id=p.id
  WHERE m.company_id=target_company AND m.user_id=auth.uid() AND m.active
   AND (m.expires_at IS NULL OR m.expires_at>statement_timestamp()) AND p.active AND p.kind='human' AND s.scope=required_scope
 ) OR EXISTS (
  SELECT 1 FROM private.remote_workspaces w
  JOIN public.company_memberships m ON m.company_id=w.company_id AND m.user_id=w.user_id
  JOIN public.principals owner ON owner.company_id=m.company_id AND owner.user_id=m.user_id AND owner.active
  JOIN public.principals writer ON writer.company_id=w.company_id AND writer.id=w.writer_id AND writer.kind='service' AND writer.active
  JOIN public.principal_scopes s ON s.company_id=writer.company_id AND s.principal_id=writer.id
  WHERE w.company_id=target_company AND w.writer_id=auth.uid() AND m.active
   AND (m.expires_at IS NULL OR m.expires_at>statement_timestamp())
   AND required_scope IN ('erp:read','accounting:write','accounting:close') AND s.scope=required_scope
 );$$;
CREATE TABLE private.remote_browser_sessions (
 token_hash char(64) PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users(id),
 encrypted_session text NOT NULL,expires_at timestamptz NOT NULL
);
CREATE INDEX remote_browser_expiry ON private.remote_browser_sessions(expires_at);
CREATE TABLE private.remote_oauth_clients (
 id text PRIMARY KEY, name text NOT NULL, redirect_uris jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE private.remote_oauth_codes (
 code_hash char(64) PRIMARY KEY,client_id text NOT NULL REFERENCES private.remote_oauth_clients(id),
 user_id uuid NOT NULL REFERENCES auth.users(id),redirect_uri text NOT NULL,challenge text NOT NULL,
 resource text NOT NULL,expires_at timestamptz NOT NULL
);
CREATE TABLE private.remote_oauth_grants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),client_id text NOT NULL REFERENCES private.remote_oauth_clients(id),
 user_id uuid NOT NULL REFERENCES auth.users(id),resource text NOT NULL,access_hash char(64) NOT NULL UNIQUE,refresh_hash char(64) NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL,refresh_expires_at timestamptz NOT NULL,revoked boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX remote_grant_user ON private.remote_oauth_grants(user_id);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['execution_actors','remote_workspaces','remote_browser_sessions','remote_oauth_clients','remote_oauth_codes','remote_oauth_grants'] LOOP
  EXECUTE format('ALTER TABLE private.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON private.%I FROM PUBLIC,anon,authenticated',t);
 END LOOP;
END;$$;
REVOKE ALL ON FUNCTION private.register_human_actor() FROM PUBLIC,anon,authenticated;
COMMIT;
