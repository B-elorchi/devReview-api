-- Supabase Seed Data

-- 1. Insert initial user profile (Assume auth.users is populated separately via signup, but we can seed profiles directly if testing locally)
-- Note: In a real Supabase instance, you must create auth.users first. For local seeding, sometimes we can insert a dummy user.
-- Here we'll create a dummy user in auth.users just for the seed.
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, recovery_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token) 
VALUES 
('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@devreview.ai', '$2a$10$wT0E8K.Yw.lF.m9B6Q5m.O9o8X.V.tT.M.V.R.H.Q.P.y.J.U.X.I.A', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Admin User"}', now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, full_name, avatar_url, default_workspace_id, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000000', 
  'admin@devreview.ai', 
  'Admin User', 
  'https://ui-avatars.com/api/?name=Admin+User&background=random',
  NULL,
  now(),
  now()
) ON CONFLICT (id) DO NOTHING;

-- 2. Insert Workspace
INSERT INTO public.workspaces (id, name, slug, owner_id, plan)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'Acme Inc',
  'acme-inc',
  '00000000-0000-0000-0000-000000000000',
  'pro'
) ON CONFLICT (id) DO NOTHING;

-- Update profile default workspace
UPDATE public.profiles SET default_workspace_id = '11111111-1111-1111-1111-111111111111' WHERE id = '00000000-0000-0000-0000-000000000000';

-- 3. Insert Workspace Members
INSERT INTO public.workspace_members (workspace_id, user_id, role)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  '00000000-0000-0000-0000-000000000000',
  'owner'
) ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- 4. Insert Project
INSERT INTO public.projects (id, workspace_id, name, description, repo_url, default_branch, created_by, health_score, visibility)
VALUES (
  '22222222-2222-2222-2222-222222222222',
  '11111111-1111-1111-1111-111111111111',
  'auth-service',
  'Core authentication microservice',
  'https://github.com/acme/auth-service',
  'main',
  '00000000-0000-0000-0000-000000000000',
  92,
  'private'
) ON CONFLICT (id) DO NOTHING;

-- 5. Insert Pull Request
INSERT INTO public.pull_requests (id, project_id, number, title, author, state, url, base_sha, head_sha, ai_status)
VALUES (
  '33333333-3333-3333-3333-333333333333',
  '22222222-2222-2222-2222-222222222222',
  42,
  'feat: implement OAuth2 provider',
  'jane-doe',
  'open',
  'https://github.com/acme/auth-service/pull/42',
  'a1b2c3d4',
  'e5f6g7h8',
  'reviewed'
) ON CONFLICT (id) DO NOTHING;

-- 6. Insert AI Review
INSERT INTO public.reviews (id, project_id, pr_id, status, ref, pr_number, commit_sha, summary, score, model, requested_by)
VALUES (
  '44444444-4444-4444-4444-444444444444',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333',
  'completed',
  'refs/pull/42/head',
  42,
  'e5f6g7h8',
  'Review complete. Found a few security issues with the OAuth state parameter.',
  85,
  'gpt-4-turbo',
  '00000000-0000-0000-0000-000000000000'
) ON CONFLICT (id) DO NOTHING;

-- 7. Insert Review Findings
INSERT INTO public.review_findings (id, review_id, file_path, line_start, line_end, severity, category, title, message, suggestion)
VALUES (
  '55555555-5555-5555-5555-555555555555',
  '44444444-4444-4444-4444-444444444444',
  'src/controllers/oauth.ts',
  23,
  23,
  'high',
  'security',
  'Missing state validation',
  'The state parameter is not validated against the session, leading to potential CSRF attacks.',
  'Implement a secure state parameter check using a cryptographic nonce.'
) ON CONFLICT (id) DO NOTHING;

-- 8. Insert Agent
INSERT INTO public.agents (id, workspace_id, slug, name, system_prompt, model, tools, created_by)
VALUES (
  '66666666-6666-6666-6666-666666666666',
  '11111111-1111-1111-1111-111111111111',
  'security-expert',
  'Security Expert',
  'You are a cybersecurity expert analyzing source code for vulnerabilities.',
  'gpt-4-turbo',
  '["read_file", "grep_search"]',
  '00000000-0000-0000-0000-000000000000'
) ON CONFLICT (id) DO NOTHING;

-- 9. Insert Templates
INSERT INTO public.templates (id, slug, name, stack, tags, repo_url, usage_count)
VALUES (
  '77777777-7777-7777-7777-777777777777',
  'express-ts-api',
  'Express + TypeScript API',
  'node',
  '{"express", "typescript", "api"}',
  'https://github.com/templates/express-ts',
  142
) ON CONFLICT (id) DO NOTHING;
