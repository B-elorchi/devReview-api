-- Store the user's GitHub OAuth token so the platform can list/push THEIR repos
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS github_token text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS github_refresh_token text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS github_username varchar(100);
