# DevReview AI — Backend

Express.js + TypeScript + Supabase backend for the DevReview AI platform.
See `BACKEND.md` in the frontend repo for the full architectural spec.

## Quick start

```bash
cp .env.example .env       # fill in values
npm install
npm run dev                # API on :8080
npm run worker             # background jobs (separate terminal)
```

## Structure

```
src/
  config/        env loading, supabase client, redis, ai gateway
  middleware/    auth, error handler, rate limit, workspace scope
  routes/        v1 REST endpoints (mounted in app.ts)
  services/      business logic (ai, github, telegram, stripe, sandbox)
  workers/       BullMQ queue consumers
  utils/         crypto, logger, validation helpers
  types/         shared types
  db/            sql migration helpers
supabase/migrations/   SQL migrations (run via `supabase db push`)
```

## API Documentation

Interactive Swagger UI is available at:

- `GET /api-docs`       — Swagger UI explorer
- `GET /api-docs.json`  — Raw OpenAPI 3.0 spec

The spec lives in `src/openapi.ts` — keep it in sync when adding endpoints.

## Endpoints (v1)

All routes are prefixed with `/v1` and (unless noted) require a Supabase
JWT in `Authorization: Bearer <token>`.

- `GET    /healthz`
- `POST   /v1/auth/session`          — exchange Supabase JWT for profile
- `GET    /v1/workspaces`
- `POST   /v1/workspaces`
- `GET    /v1/workspaces/:id/members`
- `GET    /v1/projects`
- `POST   /v1/projects`
- `GET    /v1/projects/:id`
- `PATCH  /v1/projects/:id`
- `DELETE /v1/projects/:id`
- `POST   /v1/projects/:id/reviews` — enqueue AI code review
- `GET    /v1/reviews/:id`
- `GET    /v1/projects/:id/pull-requests`
- `POST   /v1/devops/generate`       — SSE stream (Dockerfile, CI, k8s)
- `GET    /v1/agents`
- `POST   /v1/agents`
- `POST   /v1/agents/:id/run`        — SSE stream
- `GET    /v1/agents/sessions/:id`
- `POST   /v1/editor/sandboxes`
- `GET    /v1/editor/sandboxes/:id/files`
- `PUT    /v1/editor/sandboxes/:id/files`
- `POST   /v1/editor/chat`           — SSE chat with tool calls
- `WS     /v1/editor/sandboxes/:id/terminal`
- `GET    /v1/integrations/github/install-url`
- `POST   /v1/integrations/github/webhook`     (public, HMAC verified)
- `POST   /v1/integrations/telegram/link`
- `POST   /v1/integrations/telegram/webhook`   (public, secret token)
- `GET    /v1/api-keys`
- `POST   /v1/api-keys`
- `DELETE /v1/api-keys/:id`
- `GET    /v1/billing/portal`
- `POST   /v1/billing/webhook`                 (public, Stripe sig)
- `GET    /v1/notifications`
- `GET    /v1/audit-log`

## Deployment

`Dockerfile` and `docker-compose.yml` are provided. Run the `api` and
`worker` services side-by-side; both share the same image.
