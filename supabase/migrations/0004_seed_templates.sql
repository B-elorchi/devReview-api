-- Seed built-in templates (idempotent)
INSERT INTO public.templates (slug, name, stack, tags, repo_url, usage_count) VALUES
  ('nextjs-saas',       'Next.js SaaS Starter',        'frontend', ARRAY['Next.js','TypeScript','Tailwind','Prisma','Stripe'],    'https://github.com/vercel/nextjs-subscription-payments', 1240),
  ('react-vite',        'React + Vite',                'frontend', ARRAY['React','Vite','TypeScript','TailwindCSS'],              'https://github.com/vitejs/vite/tree/main/packages/create-vite', 980),
  ('t3-stack',          'T3 Stack',                    'frontend', ARRAY['Next.js','tRPC','Prisma','NextAuth','Tailwind'],        'https://github.com/t3-oss/create-t3-app', 860),
  ('fastapi-postgres',  'FastAPI + PostgreSQL',        'backend',  ARRAY['FastAPI','Python','PostgreSQL','SQLAlchemy','Docker'], 'https://github.com/tiangolo/full-stack-fastapi-template', 720),
  ('express-api',       'Express REST API',            'backend',  ARRAY['Node.js','Express','TypeScript','Zod','JWT'],          'https://github.com/expressjs/express', 650),
  ('nestjs-api',        'NestJS Enterprise API',       'backend',  ARRAY['NestJS','TypeScript','Prisma','PostgreSQL','Swagger'], 'https://github.com/nestjs/nest', 530),
  ('go-rest',           'Go REST API',                 'backend',  ARRAY['Go','Gin','PostgreSQL','Docker','JWT'],                'https://github.com/gin-gonic/gin', 410),
  ('django-drf',        'Django REST Framework',       'backend',  ARRAY['Django','Python','DRF','PostgreSQL','Celery'],         'https://github.com/encode/django-rest-framework', 390),
  ('expo-react-native', 'Expo React Native',           'mobile',   ARRAY['React Native','Expo','TypeScript','NativeWind'],      'https://github.com/expo/expo', 480),
  ('flutter-app',       'Flutter App',                 'mobile',   ARRAY['Flutter','Dart','Firebase','Riverpod'],               'https://github.com/flutter/flutter', 360),
  ('terraform-aws',     'Terraform AWS Infrastructure','infra',    ARRAY['Terraform','AWS','VPC','ECS','RDS'],                  'https://github.com/hashicorp/terraform', 290),
  ('docker-compose',    'Docker Compose Stack',        'infra',    ARRAY['Docker','Nginx','PostgreSQL','Redis','Traefik'],      'https://github.com/docker/compose', 510),
  ('k8s-helm',          'Kubernetes + Helm Charts',    'infra',    ARRAY['Kubernetes','Helm','ArgoCD','Prometheus','Grafana'],  'https://github.com/helm/helm', 210),
  ('langchain-agent',   'LangChain AI Agent',          'ai',       ARRAY['Python','LangChain','OpenAI','FastAPI','Redis'],      'https://github.com/langchain-ai/langchain', 670),
  ('rag-pipeline',      'RAG Pipeline',                'ai',       ARRAY['Python','LangChain','Chroma','OpenAI','FastAPI'],     'https://github.com/chroma-core/chroma', 420),
  ('nextjs-ai-chat',    'Next.js AI Chat App',         'ai',       ARRAY['Next.js','AI SDK','OpenAI','TypeScript','Tailwind'],  'https://github.com/vercel/ai', 580)
ON CONFLICT (slug) DO UPDATE SET
  name        = EXCLUDED.name,
  stack       = EXCLUDED.stack,
  tags        = EXCLUDED.tags,
  repo_url    = EXCLUDED.repo_url,
  usage_count = GREATEST(public.templates.usage_count, EXCLUDED.usage_count);
