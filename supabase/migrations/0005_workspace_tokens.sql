ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS tokens_used integer DEFAULT 0;
