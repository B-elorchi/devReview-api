import { Router } from "express";
import { requireAuth, requireWorkspace } from "../middleware/auth.js";
import { supabaseAdmin } from "../config/supabase.js";
import { chatModel } from "../config/ai.js";
import { z } from "zod";

const r = Router();

// ─── Public endpoints ─────────────────────────────────────────────────────────

r.get("/", async (req, res) => {
  const stack = req.query.stack as string | undefined;
  const q     = req.query.q     as string | undefined;

  let query = supabaseAdmin.from("templates").select("*").order("usage_count", { ascending: false });
  if (stack) query = query.eq("stack", stack);
  if (q)     query = query.ilike("name", `%${q}%`);

  const { data, error } = await query;
  if (error) throw error;
  res.json({ data: data ?? [] });
});

r.get("/:slug", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("templates").select("*").eq("slug", req.params.slug).maybeSingle();
  if (error) throw error;
  if (!data) return res.status(404).json({ error: "Not found" });
  res.json({ data });
});

// ─── Auth required ────────────────────────────────────────────────────────────

r.use(requireAuth, requireWorkspace);

// POST /templates/:slug/use — create a project + AI-generate starter files
r.post("/:slug/use", async (req, res) => {
  const { data: tpl, error: tplErr } = await supabaseAdmin
    .from("templates").select("*").eq("slug", req.params.slug).maybeSingle();
  if (tplErr) throw tplErr;
  if (!tpl) return res.status(404).json({ error: "Template not found" });

  // 1. Create the project
  const { data: project, error: projErr } = await supabaseAdmin
    .from("projects")
    .insert({
      workspace_id: req.workspaceId!,
      created_by:   req.user!.id,
      name:         tpl.name,
      description:  `Created from template: ${tpl.name}`,
      repo_url:     tpl.repo_url,
      default_branch: "main",
    })
    .select()
    .single();
  if (projErr) throw projErr;

  // 2. Bump usage count (fire-and-forget)
  supabaseAdmin.from("templates").update({ usage_count: (tpl.usage_count ?? 0) + 1 })
    .eq("slug", tpl.slug).then(() => {});

  // 3. Generate starter files with AI (async — client polls /projects/:id/files)
  generateStarterFiles(project.id, tpl).catch((e) => console.error("Starter file gen failed", e));

  res.status(201).json({ project });
});

// POST /templates — admin seed
r.post("/", async (req, res) => {
  const body = z.object({
    slug:        z.string(),
    name:        z.string(),
    stack:       z.string(),
    tags:        z.array(z.string()).optional(),
    repo_url:    z.string().url(),
    description: z.string().optional(),
  }).parse(req.body);

  const { data, error } = await supabaseAdmin.from("templates").insert(body).select().single();
  if (error) throw error;
  res.status(201).json({ data });
});

export default r;

// ─── AI starter file generator ────────────────────────────────────────────────

const TEMPLATE_PROMPTS: Record<string, string> = {
  "nextjs-saas":       "Generate a production-ready Next.js 14 SaaS starter with TypeScript, Tailwind CSS, Prisma ORM, NextAuth.js, and Stripe billing.",
  "react-vite":        "Generate a React 18 + Vite + TypeScript project with TailwindCSS, React Router, and a clean component structure.",
  "t3-stack":          "Generate a T3 stack app with Next.js, tRPC, Prisma, NextAuth, and Tailwind CSS.",
  "fastapi-postgres":  "Generate a FastAPI project with PostgreSQL, SQLAlchemy 2.0, Alembic migrations, Pydantic v2, and Docker Compose.",
  "express-api":       "Generate an Express.js REST API with TypeScript, Zod validation, JWT auth, Prisma ORM, and error handling middleware.",
  "nestjs-api":        "Generate a NestJS enterprise API with TypeScript, Prisma, PostgreSQL, JWT auth, Swagger docs, and class-validator.",
  "go-rest":           "Generate a Go REST API with Gin framework, GORM, PostgreSQL, JWT middleware, and Docker.",
  "django-drf":        "Generate a Django REST Framework project with PostgreSQL, JWT auth, Celery tasks, and Docker Compose.",
  "expo-react-native": "Generate an Expo React Native app with TypeScript, NativeWind, Expo Router, and Zustand state management.",
  "flutter-app":       "Generate a Flutter app with Riverpod state management, GoRouter, Firebase Auth, and clean architecture.",
  "terraform-aws":     "Generate Terraform AWS infrastructure with VPC, ECS Fargate, RDS PostgreSQL, S3, CloudFront, and ALB.",
  "docker-compose":    "Generate a Docker Compose stack with Nginx reverse proxy, Node.js app, PostgreSQL, Redis, and Traefik.",
  "k8s-helm":          "Generate Kubernetes Helm charts with Deployment, Service, Ingress, HPA, ConfigMap, and Secret manifests.",
  "langchain-agent":   "Generate a LangChain AI agent with FastAPI, OpenAI, tool calling, memory, and streaming SSE responses.",
  "rag-pipeline":      "Generate a RAG pipeline with LangChain, ChromaDB vector store, OpenAI embeddings, FastAPI endpoints, and document ingestion.",
  "nextjs-ai-chat":    "Generate a Next.js AI chat app using Vercel AI SDK, OpenAI streaming, shadcn/ui components, and chat history.",
};

async function generateStarterFiles(projectId: string, tpl: any) {
  const prompt = TEMPLATE_PROMPTS[tpl.slug] ??
    `Generate a starter project for: ${tpl.name} (${tpl.tags?.join(", ")}).`;

  const systemPrompt = `You are an expert developer. Generate a complete, production-ready project starter.

Return ONLY a JSON object (no markdown, no explanation) in this exact format:
{
  "files": [
    { "path": "relative/path/file.ext", "content": "full file content here" }
  ]
}

Rules:
- Include 8-15 files covering: entry point, config, main feature, types, tests, README, .gitignore, Dockerfile or compose
- Files must be complete and functional, not just placeholders
- Use best practices for the stack
- No binary files`;

  try {
    const stream = await chatModel.stream([
      { role: "system", content: systemPrompt },
      { role: "user",   content: prompt },
    ]);

    let full = "";
    for await (const chunk of stream) {
      if (chunk.content) full += chunk.content;
    }

    // Extract JSON from response (may be wrapped in ```json blocks)
    const jsonMatch = full.match(/```json\s*([\s\S]*?)```/) ??
                      full.match(/```\s*([\s\S]*?)```/) ??
                      full.match(/(\{[\s\S]*\})/);

    if (!jsonMatch) throw new Error("No JSON in AI response");

    const parsed = JSON.parse(jsonMatch[1]);
    const files: { path: string; content: string }[] = parsed.files ?? [];

    if (files.length === 0) throw new Error("AI returned 0 files");

    // Store files in editor_files table linked to a sandbox
    // First create a sandbox for this project
    const { data: sandbox } = await supabaseAdmin
      .from("editor_sandboxes")
      .insert({
        owner_id:   (await supabaseAdmin.from("projects").select("created_by").eq("id", projectId).single()).data?.created_by,
        project_id: projectId,
        template:   tpl.slug,
        status:     "ready",
      })
      .select()
      .single();

    if (sandbox) {
      const rows = files.map((f) => ({
        sandbox_id: sandbox.id,
        path:       f.path,
        type:       "file" as const,
        content:    f.content,
        size:       f.content.length,
      }));

      await supabaseAdmin.from("editor_files").insert(rows);
    }

    // Also update project with a marker that AI files are ready
    await supabaseAdmin.from("projects").update({
      description: `Created from template: ${tpl.name} — AI starter files generated`,
    }).eq("id", projectId);

  } catch (err) {
    console.error("AI file generation error:", err);
  }
}
