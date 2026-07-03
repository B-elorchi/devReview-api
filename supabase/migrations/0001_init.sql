-- DevReview AI — Initial schema (idempotent)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- PROFILES
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  avatar_url text,
  stripe_customer_id text,
  default_workspace_id UUID,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- WORKSPACES
CREATE TABLE IF NOT EXISTS public.workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan text DEFAULT 'free',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- WORKSPACE MEMBERS
DO $$ BEGIN
  CREATE TYPE public.workspace_role AS ENUM ('owner','admin','member','viewer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.workspace_members (
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.workspace_role NOT NULL DEFAULT 'member',
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE OR REPLACE FUNCTION public.has_workspace_role(check_workspace_id UUID, required_roles text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = check_workspace_id
    AND user_id = auth.uid()
    AND role = ANY(required_roles::public.workspace_role[])
  );
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_member(_ws uuid, _uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id = _ws AND user_id = _uid)
$$;

-- PROJECTS
CREATE TABLE IF NOT EXISTS public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  repo_url text,
  default_branch text DEFAULT 'main',
  created_by UUID REFERENCES auth.users(id),
  health_score integer,
  visibility text DEFAULT 'private',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- PULL REQUESTS
CREATE TABLE IF NOT EXISTS public.pull_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  number integer NOT NULL,
  title text, author text, state text,
  url text,
  base_sha text, head_sha text,
  ai_status text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (project_id, number)
);

-- REVIEWS
CREATE TABLE IF NOT EXISTS public.reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  pr_id UUID REFERENCES public.pull_requests(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('queued','running','completed','failed')),
  ref text,
  pr_number int,
  commit_sha text,
  summary text,
  score integer,
  model text,
  requested_by UUID REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

-- REVIEW FINDINGS
CREATE TABLE IF NOT EXISTS public.review_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
  file_path text, line int,
  line_start int, line_end int,
  severity text CHECK (severity IN ('info','low','medium','high','critical')),
  category text, title text,
  message text, suggestion text,
  auto_fix jsonb,
  created_at timestamptz DEFAULT now()
);

-- AGENTS
CREATE TABLE IF NOT EXISTS public.agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  slug text,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  system_prompt text NOT NULL,
  model text NOT NULL DEFAULT 'gpt-4.1-mini',
  tools jsonb DEFAULT '[]'::jsonb,
  icon_key varchar(40) NOT NULL DEFAULT 'bot',
  color varchar(100) NOT NULL DEFAULT 'from-primary to-accent',
  created_by UUID REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.agent_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  started_by UUID REFERENCES auth.users(id),
  status text NOT NULL,
  output text,
  started_at timestamptz DEFAULT now(),
  ended_at timestamptz
);

-- ONLINE IDE
CREATE TABLE IF NOT EXISTS public.editor_sandboxes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  template text NOT NULL,
  status text NOT NULL,
  container_id text,
  created_at timestamptz DEFAULT now(),
  last_active_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.editor_files (
  sandbox_id UUID NOT NULL REFERENCES public.editor_sandboxes(id) ON DELETE CASCADE,
  path text NOT NULL,
  type text NOT NULL DEFAULT 'file',
  content text,
  size int DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (sandbox_id, path)
);

-- INTEGRATIONS
CREATE TABLE IF NOT EXISTS public.github_installations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  installation_id bigint NOT NULL UNIQUE,
  account_login text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.telegram_links (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  chat_id text NOT NULL,
  linked_at timestamptz DEFAULT now()
);

-- API KEYS
CREATE TABLE IF NOT EXISTS public.api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  prefix text NOT NULL,
  hash text NOT NULL,
  last_used_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- SECRETS VAULT
CREATE TABLE IF NOT EXISTS public.secrets_vault (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  ciphertext text NOT NULL,
  iv text NOT NULL,
  tag text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- WEBHOOKS
CREATE TABLE IF NOT EXISTS public.webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  url text NOT NULL,
  secret text NOT NULL,
  events text[] NOT NULL,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- TEMPLATES
CREATE TABLE IF NOT EXISTS public.templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  stack text NOT NULL,
  tags text[],
  repo_url text NOT NULL,
  usage_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- BILLING / NOTIFICATIONS / AUDIT
CREATE TABLE IF NOT EXISTS public.billing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  payload jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES auth.users(id),
  action text NOT NULL,
  target_type text,
  target_id text,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

-- GRANTS
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.profiles, public.workspaces, public.workspace_members,
  public.projects, public.reviews, public.review_findings,
  public.pull_requests, public.agents, public.agent_sessions,
  public.editor_sandboxes, public.editor_files,
  public.github_installations, public.telegram_links,
  public.api_keys, public.notifications, public.audit_log,
  public.secrets_vault, public.webhooks, public.templates
TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

-- RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pull_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.editor_sandboxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.editor_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.secrets_vault ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;

-- POLICIES (drop first so re-runs don't fail)
DO $$ BEGIN
  DROP POLICY IF EXISTS "own profile" ON public.profiles;
  DROP POLICY IF EXISTS "ws read" ON public.workspaces;
  DROP POLICY IF EXISTS "ws owner write" ON public.workspaces;
  DROP POLICY IF EXISTS "ws members read" ON public.workspace_members;
  DROP POLICY IF EXISTS "projects scoped" ON public.projects;
  DROP POLICY IF EXISTS "reviews via project" ON public.reviews;
  DROP POLICY IF EXISTS "findings via review" ON public.review_findings;
  DROP POLICY IF EXISTS "prs via project" ON public.pull_requests;
  DROP POLICY IF EXISTS "agents scoped" ON public.agents;
  DROP POLICY IF EXISTS "agent sessions via agent" ON public.agent_sessions;
  DROP POLICY IF EXISTS "own sandboxes" ON public.editor_sandboxes;
  DROP POLICY IF EXISTS "own files" ON public.editor_files;
  DROP POLICY IF EXISTS "own keys" ON public.api_keys;
  DROP POLICY IF EXISTS "own notifications" ON public.notifications;
  DROP POLICY IF EXISTS "audit via workspace" ON public.audit_log;
  DROP POLICY IF EXISTS "secrets admin" ON public.secrets_vault;
  DROP POLICY IF EXISTS "webhooks admin" ON public.webhooks;
  DROP POLICY IF EXISTS "templates public" ON public.templates;
END $$;

CREATE POLICY "own profile" ON public.profiles FOR ALL TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE POLICY "ws read" ON public.workspaces FOR SELECT TO authenticated USING (public.is_workspace_member(id, auth.uid()));
CREATE POLICY "ws owner write" ON public.workspaces FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE POLICY "ws members read" ON public.workspace_members FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "projects scoped" ON public.projects FOR ALL TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid())) WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "reviews via project" ON public.reviews FOR ALL TO authenticated USING (EXISTS(SELECT 1 FROM public.projects p WHERE p.id = project_id AND public.is_workspace_member(p.workspace_id, auth.uid())));
CREATE POLICY "findings via review" ON public.review_findings FOR SELECT TO authenticated USING (EXISTS(SELECT 1 FROM public.reviews r JOIN public.projects p ON p.id = r.project_id WHERE r.id = review_id AND public.is_workspace_member(p.workspace_id, auth.uid())));

CREATE POLICY "prs via project" ON public.pull_requests FOR SELECT TO authenticated USING (EXISTS(SELECT 1 FROM public.projects p WHERE p.id = project_id AND public.is_workspace_member(p.workspace_id, auth.uid())));

CREATE POLICY "agents scoped" ON public.agents FOR ALL TO authenticated USING (workspace_id IS NULL OR public.is_workspace_member(workspace_id, auth.uid())) WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "agent sessions via agent" ON public.agent_sessions FOR SELECT TO authenticated USING (EXISTS(SELECT 1 FROM public.agents a WHERE a.id = agent_id AND public.is_workspace_member(a.workspace_id, auth.uid())));

CREATE POLICY "own sandboxes" ON public.editor_sandboxes FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "own files" ON public.editor_files FOR ALL TO authenticated USING (EXISTS(SELECT 1 FROM public.editor_sandboxes s WHERE s.id = sandbox_id AND s.owner_id = auth.uid())) WITH CHECK (EXISTS(SELECT 1 FROM public.editor_sandboxes s WHERE s.id = sandbox_id AND s.owner_id = auth.uid()));

CREATE POLICY "own keys" ON public.api_keys FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own notifications" ON public.notifications FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "audit via workspace" ON public.audit_log FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "secrets admin" ON public.secrets_vault FOR ALL TO authenticated USING (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin'])) WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']));
CREATE POLICY "webhooks admin" ON public.webhooks FOR ALL TO authenticated USING (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin'])) WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']));

CREATE POLICY "templates public" ON public.templates FOR SELECT USING (true);
