-- Agents: add new columns (idempotent)
ALTER TABLE public.agents
  ALTER COLUMN slug DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS description  text         NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS icon_key     varchar(40)  NOT NULL DEFAULT 'bot',
  ADD COLUMN IF NOT EXISTS color        varchar(100) NOT NULL DEFAULT 'from-primary to-accent',
  ADD COLUMN IF NOT EXISTS updated_at   timestamptz;

-- Default model to gpt-4.1-mini for existing rows that have the old value
UPDATE public.agents SET model = 'gpt-4.1-mini' WHERE model = 'openai/gpt-4.1-mini';

-- Back-fill slug for any rows that have null
UPDATE public.agents SET slug = id::text WHERE slug IS NULL;
