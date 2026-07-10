import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireWorkspace } from "../middleware/auth.js";
import { aiLimiter } from "../middleware/rateLimit.js";
import { chatModel } from "../config/ai.js";
import { openSse, sseSend, sseClose } from "../utils/sse.js";
import { supabaseAdmin } from "../config/supabase.js";
import { env } from "../config/env.js";
import { runAgent } from "../agents/agentFactory.js";

const r = Router();
r.use(requireAuth, requireWorkspace);

// ─── LangChain agent chat (tool-augmented) ────────────────────────────────────

r.post("/inline-chat", aiLimiter, async (req, res) => {
  const body = z.object({
    agentType: z.enum(["code-review", "code-quality", "security", "dev"]),
    message:   z.string().min(1).max(8000),
    fileName:  z.string().optional(),
    fileContent: z.string().max(100_000).optional(),
    history:   z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).default([]),
  }).parse(req.body);

  openSse(res);

  try {
    const { fullText } = await runAgent({
      agentType:   body.agentType,
      message:     body.message,
      fileName:    body.fileName,
      fileContent: body.fileContent,
      history:     body.history,
      onChunk:     (text) => sseSend(res, "delta", { text }),
    });
  } catch (err) {
    console.error("Agent run failed", err);
    sseSend(res, "error", { message: "Agent failed — check server logs" });
  }

  sseSend(res, "done", {});
  sseClose(res);
});

// ─── project architect chat (SSE) ────────────────────────────────────────────

const ARCHITECT_SYSTEM = `You are an expert software architect and full-stack developer.
Help the user design a new project step by step.

Guidelines:
- Ask 1-2 focused questions to understand the project type, purpose, and preferred tech stack
- Suggest a concrete architecture with folder structure
- Keep responses concise and actionable
- When the user confirms they're ready to generate, output ONLY a valid JSON block (no other text after it) in this exact format:

\`\`\`json
{
  "name": "repo-name-kebab-case",
  "description": "one sentence description",
  "techStack": "e.g. Node.js + TypeScript + Express",
  "files": [
    { "path": "README.md", "content": "# Project\\n..." },
    { "path": "src/index.ts", "content": "..." },
    { "path": "package.json", "content": "{ \\"name\\": \\"...\\" }" }
  ]
}
\`\`\`

Always include: README.md, main entry file, package.json or equivalent, .gitignore, and basic config files relevant to the stack.
File content should be real, working starter code — not placeholders.`;

r.post("/architect/chat", aiLimiter, async (req, res) => {
  const body = z.object({
    message: z.string().min(1).max(4000),
    history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).default([]),
  }).parse(req.body);

  openSse(res);

  const msgs: { role: string; content: string }[] = [
    { role: "system", content: ARCHITECT_SYSTEM },
    ...body.history,
    { role: "user", content: body.message },
  ];

  let full = "";
  try {
    const stream = await chatModel.stream(msgs);
    for await (const chunk of stream) {
      if (chunk.content) {
        full += chunk.content;
        sseSend(res, "delta", { text: chunk.content });
      }
    }
  } catch (err) {
    console.error("Architect chat failed", err);
    sseSend(res, "error", { message: "AI request failed" });
  }

  sseSend(res, "done", { full });
  sseClose(res);
});

// ─── project architect create (create GitHub repo + push generated files) ────

async function ghApi(path: string, init?: RequestInit) {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

r.post("/architect/create", aiLimiter, async (req, res) => {
  const body = z.object({
    repoName: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    isPrivate: z.boolean().default(false),
    files: z.array(z.object({ path: z.string(), content: z.string() })).min(1).max(50),
  }).parse(req.body);

  if (!env.GITHUB_TOKEN) {
    return res.status(501).json({ error: "GITHUB_TOKEN not configured on server" });
  }

  // 1. Create GitHub repo
  const ghRes = await ghApi("/user/repos", {
    method: "POST",
    body: JSON.stringify({
      name: body.repoName,
      description: body.description,
      private: body.isPrivate,
      auto_init: true,
    }),
  });
  if (!ghRes.ok) {
    const err: any = await ghRes.json();
    return res.status(400).json({ error: err.message ?? "Failed to create GitHub repo" });
  }
  const ghRepo: any = await ghRes.json();
  const branch = ghRepo.default_branch ?? "main";

  // 2. Create project record in DB
  const { data: project, error: dbErr } = await supabaseAdmin.from("projects").insert({
    name: body.repoName,
    repo_url: ghRepo.html_url,
    description: body.description,
    workspace_id: req.workspaceId!,
    created_by: req.user!.id,
  }).select().single();
  if (dbErr) return res.status(500).json({ error: dbErr.message });

  // 3. Wait for GitHub to finish initialising the repo
  await new Promise((resolve) => setTimeout(resolve, 2500));

  // 4. Push each generated file
  const pushResults: { path: string; ok: boolean }[] = [];
  for (const file of body.files) {
    let sha: string | undefined;
    try {
      const existing = await ghApi(`/repos/${ghRepo.full_name}/contents/${file.path}?ref=${branch}`);
      if (existing.ok) { const ed: any = await existing.json(); sha = ed.sha; }
    } catch {}

    const contentB64 = Buffer.from(file.content, "utf-8").toString("base64");
    const pr = await ghApi(`/repos/${ghRepo.full_name}/contents/${file.path}`, {
      method: "PUT",
      body: JSON.stringify({
        message: "chore: initial project structure (v0) 🚀",
        content: contentB64,
        sha,
        branch,
      }),
    });
    pushResults.push({ path: file.path, ok: pr.ok });
  }

  res.status(201).json({ project, repo: ghRepo, pushResults });
});

export default r;
