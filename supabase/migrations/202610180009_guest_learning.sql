BEGIN;
CREATE TABLE private.guest_workspaces (
 id uuid PRIMARY KEY,bootstrap_hash char(64) NOT NULL UNIQUE,access_hash char(64) NOT NULL UNIQUE,
 company_id uuid NOT NULL UNIQUE REFERENCES public.companies(id),
 writer_id uuid NOT NULL UNIQUE REFERENCES private.execution_actors(id),
 reviewer_id uuid NOT NULL UNIQUE REFERENCES private.execution_actors(id),
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,
 revoked boolean NOT NULL DEFAULT false,claimed_user_id uuid UNIQUE REFERENCES auth.users(id),
 CHECK(writer_id<>reviewer_id),CHECK(expires_at>created_at)
);
CREATE INDEX guest_workspace_expiry ON private.guest_workspaces(expires_at);
CREATE TABLE private.guest_review_tickets (
 token_hash char(64) PRIMARY KEY,guest_id uuid NOT NULL REFERENCES private.guest_workspaces(id),
 journal_id uuid NOT NULL REFERENCES public.journal_entries(id),version integer NOT NULL CHECK(version>0),
 content_hash char(64) NOT NULL,expires_at timestamptz NOT NULL
);
CREATE TABLE private.guest_browser_sessions (
 token_hash char(64) PRIMARY KEY,guest_id uuid NOT NULL REFERENCES private.guest_workspaces(id),
 journal_id uuid NOT NULL REFERENCES public.journal_entries(id),version integer NOT NULL,
 content_hash char(64) NOT NULL,csrf_hash char(64) NOT NULL,expires_at timestamptz NOT NULL
);
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['guest_workspaces','guest_review_tickets','guest_browser_sessions'] LOOP
  EXECUTE format('ALTER TABLE private.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON private.%I FROM PUBLIC,anon,authenticated',t);
 END LOOP;
END;$$;
-- Guest reviewers are scoped capabilities, not fabricated Supabase Auth users.
ALTER TABLE public.approval_requests DROP CONSTRAINT approval_requests_decided_by_fkey;
ALTER TABLE public.approval_requests ADD CONSTRAINT approval_requests_decided_by_fkey FOREIGN KEY(decided_by) REFERENCES private.execution_actors(id);
ALTER TABLE public.agent_runs DROP CONSTRAINT agent_runs_client_check;
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_client_check CHECK(client IN ('codex','claude_code','antigravity'));

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
 ) OR EXISTS(
  SELECT 1 FROM private.guest_workspaces g
  JOIN public.principals p ON p.company_id=g.company_id AND p.id=auth.uid() AND p.active
  JOIN public.principal_scopes s ON s.company_id=p.company_id AND s.principal_id=p.id AND s.scope=required_scope
  WHERE g.company_id=target_company AND NOT g.revoked AND g.claimed_user_id IS NULL AND g.expires_at>statement_timestamp()
   AND ((auth.uid()=g.writer_id AND required_scope IN ('erp:read','accounting:write','accounting:close'))
    OR (auth.uid()=g.reviewer_id AND required_scope IN ('erp:read','accounting:approve')))
 );$$;
CREATE FUNCTION private.approval_actor_active(target_company uuid,actor uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.company_memberships m JOIN public.principals p ON p.company_id=m.company_id AND p.user_id=m.user_id
  JOIN public.principal_scopes s ON s.company_id=p.company_id AND s.principal_id=p.id
  WHERE m.company_id=target_company AND m.user_id=actor AND m.active AND p.active AND s.scope='accounting:approve'
   AND (m.expires_at IS NULL OR m.expires_at>statement_timestamp()))
 OR EXISTS(SELECT 1 FROM private.guest_workspaces g JOIN public.principals p ON p.company_id=g.company_id AND p.id=g.reviewer_id AND p.active
  JOIN public.principal_scopes s ON s.company_id=p.company_id AND s.principal_id=p.id AND s.scope='accounting:approve'
  WHERE g.company_id=target_company AND g.reviewer_id=actor AND NOT g.revoked AND g.claimed_user_id IS NULL AND g.expires_at>statement_timestamp());$$;
-- Preserve every accounting calculation/state/hash/period check. Only factor the
-- existing posting approver-eligibility subquery to include isolated guest review.
DO $$DECLARE definition text;needle text;BEGIN
 SELECT pg_get_functiondef('public.accounting_command(uuid,text,jsonb)'::regprocedure) INTO definition;
 definition:=replace(definition,chr(13),'');
 needle:=$needle$EXISTS(SELECT 1 FROM public.company_memberships m JOIN public.principals pr ON pr.company_id=m.company_id AND pr.user_id=m.user_id
            JOIN public.principal_scopes s ON s.company_id=pr.company_id AND s.principal_id=pr.id
            WHERE m.company_id=target_company AND m.user_id=r.decided_by AND m.active AND pr.active AND s.scope='accounting:approve'
              AND (m.expires_at IS NULL OR m.expires_at>statement_timestamp()))$needle$;
 needle:=replace(needle,chr(13),'');
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'GUEST_ACCOUNTING_UPGRADE_REVIEW_REQUIRED';END IF;
 EXECUTE replace(definition,needle,'private.approval_actor_active(target_company,r.decided_by)');
END;$$;
REVOKE ALL ON FUNCTION private.approval_actor_active(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.has_company_scope(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.has_company_scope(uuid,text) TO authenticated;
COMMIT;
