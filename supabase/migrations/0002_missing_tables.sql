-- Migration: add tables referenced by new API endpoints

-- Workspace invites (for team invite flow)
CREATE TABLE IF NOT EXISTS public.workspace_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL REFERENCES auth.users(id),
  email text NOT NULL,
  role public.workspace_role NOT NULL DEFAULT 'member',
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE (workspace_id, email)
);

-- Notification preferences per user
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email_review_complete boolean DEFAULT true,
  email_pr_opened boolean DEFAULT true,
  email_deploy_failed boolean DEFAULT true,
  email_weekly_report boolean DEFAULT false,
  push_review_complete boolean DEFAULT true,
  push_pr_opened boolean DEFAULT false,
  push_deploy_failed boolean DEFAULT true,
  push_weekly_report boolean DEFAULT false,
  updated_at timestamptz DEFAULT now()
);

-- Telegram messages log (for status stats)
CREATE TABLE IF NOT EXISTS public.telegram_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  chat_id text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  text text,
  created_at timestamptz DEFAULT now()
);

-- DevOps generation log (for billing usage)
CREATE TABLE IF NOT EXISTS public.devops_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  requested_by UUID REFERENCES auth.users(id),
  stack jsonb,
  result jsonb,
  created_at timestamptz DEFAULT now()
);

-- Add missing columns to existing tables
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS plan_expires_at timestamptz;
ALTER TABLE public.github_installations ADD COLUMN IF NOT EXISTS webhook_active boolean DEFAULT true;
ALTER TABLE public.github_installations ADD COLUMN IF NOT EXISTS installed_at timestamptz DEFAULT now();
ALTER TABLE public.github_installations ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE public.pull_requests ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id);
ALTER TABLE public.pull_requests ADD COLUMN IF NOT EXISTS review_started_at timestamptz;
ALTER TABLE public.pull_requests ADD COLUMN IF NOT EXISTS additions integer DEFAULT 0;
ALTER TABLE public.pull_requests ADD COLUMN IF NOT EXISTS deletions integer DEFAULT 0;
ALTER TABLE public.pull_requests ADD COLUMN IF NOT EXISTS comments integer DEFAULT 0;
ALTER TABLE public.pull_requests ADD COLUMN IF NOT EXISTS score integer;
ALTER TABLE public.agent_sessions ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id);
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS quality_score integer;

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.workspace_invites,
  public.notification_preferences,
  public.telegram_messages,
  public.devops_generations
TO authenticated;
GRANT ALL ON public.workspace_invites, public.notification_preferences, public.telegram_messages, public.devops_generations TO service_role;

-- RLS
ALTER TABLE public.workspace_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devops_generations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "invites scoped" ON public.workspace_invites;
  DROP POLICY IF EXISTS "own preferences" ON public.notification_preferences;
  DROP POLICY IF EXISTS "own tg messages" ON public.telegram_messages;
  DROP POLICY IF EXISTS "devops scoped" ON public.devops_generations;
END $$;

CREATE POLICY "invites scoped" ON public.workspace_invites FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "own preferences" ON public.notification_preferences FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "own tg messages" ON public.telegram_messages FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "devops scoped" ON public.devops_generations FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
