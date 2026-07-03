import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireWorkspace } from "../middleware/auth.js";
import { aiLimiter } from "../middleware/rateLimit.js";
import { chatModel } from "../config/ai.js";
import { openSse, sseSend, sseClose } from "../utils/sse.js";
import { supabaseAdmin } from "../config/supabase.js";
import { env } from "../config/env.js";

const r = Router();
r.use(requireAuth, requireWorkspace);


function extractRepoFullName(repoUrl: string): string | null {
  try {
    const u = new URL(repoUrl);
    if (u.hostname !== "github.com") return null;
    const parts = u.pathname.replace(/^\//, "").replace(/\.git$/, "").split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  } catch {
    return null;
  }
}

async function ghFetch(path: string, init?: RequestInit) {
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

async function fetchRepoFilePaths(repoUrl: string): Promise<string[]> {
  if (!env.GITHUB_TOKEN) return [];
  const fullName = extractRepoFullName(repoUrl);
  if (!fullName) return [];

  try {
    const repoRes = await ghFetch(`/repos/${fullName}`);
    if (!repoRes.ok) return [];
    const repoData: any = await repoRes.json();
    const branch = repoData.default_branch ?? "main";

    const treeRes = await ghFetch(`/repos/${fullName}/git/trees/${branch}?recursive=1`);
    if (!treeRes.ok) return [];
    const treeData: any = await treeRes.json();
    return (treeData.tree ?? [])
      .filter((t: any) => t.type === "blob")
      .map((t: any) => t.path as string)
      .slice(0, 200);
  } catch {
    return [];
  }
}


function parseAiOutput(raw: string): Record<string, { lang: string; content: string }> {
  const result: Record<string, { lang: string; content: string }> = {};
  const fileBlockRegex = /===FILE:\s*(.+?)===\s*([\s\S]*?)===END===/g;
  let match: RegExpExecArray | null;

  while ((match = fileBlockRegex.exec(raw)) !== null) {
    const name = match[1].trim();
    const content = match[2].trim();
    result[name] = { lang: langFromName(name), content };
  }

  if (Object.keys(result).length === 0 && raw.trim()) {
    result["Dockerfile"] = { lang: "dockerfile", content: raw.trim() };
  }

  return result;
}

function langFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower === "dockerfile" || lower.endsWith(".dockerfile")) return "dockerfile";
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    yml: "yaml", yaml: "yaml", json: "json", toml: "toml",
    sh: "shell", bash: "shell", tf: "hcl", hcl: "hcl",
    ts: "typescript", js: "javascript", py: "python",
  };
  return map[ext] ?? "yaml";
}


const generateSchema = z.object({
  projectId: z.string().uuid().optional(),
  framework: z.string().default("Node.js / Express"),
  language: z.string().default("TypeScript"),
  database: z.string().default("PostgreSQL"),
  deployTarget: z.string().default("Docker"),
  targets: z.array(z.enum(["dockerfile", "docker-compose", "github-actions", "kubernetes"])).default(["dockerfile", "docker-compose", "github-actions"]),
  nodeVersion: z.string().default("20"),
  port: z.coerce.number().default(3000),
});

r.post("/generate", aiLimiter, async (req, res) => {
  const body = generateSchema.parse(req.body);

  let repoFilePaths: string[] = [];
  let projectName = "app";

  if (body.projectId) {
    const { data: project } = await supabaseAdmin
      .from("projects")
      .select("name, repo_url")
      .eq("id", body.projectId)
      .eq("workspace_id", req.workspaceId!)
      .single();

    if (project) {
      projectName = project.name ?? "app";
      if (project.repo_url) {
        repoFilePaths = await fetchRepoFilePaths(project.repo_url);
      }
    }
  }

  const targetDescriptions: Record<string, string> = {
    "dockerfile": "a production-ready multi-stage Dockerfile",
    "docker-compose": "a docker-compose.yml with the app + database + Redis services",
    "github-actions": "a GitHub Actions CI/CD workflow (.github/workflows/ci.yml) that builds, tests, and optionally deploys the app",
    "kubernetes": "Kubernetes deployment and service manifests (k8s/deployment.yaml and k8s/service.yaml)",
  };

  const targetsText = body.targets.map(t => `- ${targetDescriptions[t]}`).join("\n");

  const repoContext = repoFilePaths.length > 0
    ? `\nThe project repository contains these files (use this to infer the exact tech stack and dependencies):\n${repoFilePaths.slice(0, 150).join("\n")}\n`
    : "";

  const systemPrompt = `You are a senior DevOps engineer and infrastructure expert. Your job is to generate production-ready DevOps configuration files.

CRITICAL OUTPUT FORMAT — you MUST use this exact delimiter format for EACH file you generate:
===FILE: <exact-filename>===
<file content here>
===END===

Rules:
- Generate ONLY the files requested in the targets list.
- Use exact filenames: Dockerfile, docker-compose.yml, .github/workflows/ci.yml, k8s/deployment.yaml, k8s/service.yaml
- Add inline comments explaining non-obvious choices.
- Follow security best practices (non-root user in Docker, secret injection via env vars, etc.).
- Consider performance, scalability, and cost.
- Do NOT add any explanation text outside the ===FILE=== blocks.`;

  const userPrompt = `Generate DevOps configuration files for the following project:

Project name: ${projectName}
Framework: ${body.framework}
Language: ${body.language}
Database: ${body.database}
Deployment target: ${body.deployTarget}
Node/runtime version: ${body.nodeVersion}
App port: ${body.port}
${repoContext}
Files to generate:
${targetsText}

Remember: output ONLY ===FILE: filename=== blocks with ===END=== delimiters. No other text.`;

  openSse(res);
  sseSend(res, "status", { message: "Generating DevOps configuration files…" });

  let fullOutput = "";

  try {
    const stream = await chatModel.stream([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);

    for await (const chunk of stream) {
      const text = typeof chunk.content === "string" ? chunk.content : "";
      if (text) {
        fullOutput += text;
        sseSend(res, "delta", { text });
      }
    }

    const generated = parseAiOutput(fullOutput);
    sseSend(res, "done", { generated });
  } catch (err: any) {
    const detail = err?.message ?? String(err);
    console.error("DevOps generate failed:", detail);
    sseSend(res, "error", { message: `AI generation failed: ${detail}` });
  }

  sseClose(res);
});


r.post("/push", async (req, res) => {
  const body = z.object({
    projectId: z.string().uuid(),
    files: z.array(z.object({ path: z.string(), content: z.string() })).min(1).max(20),
    message: z.string().min(1).max(500).default("chore: add AI-generated DevOps configuration"),
  }).parse(req.body);

  if (!env.GITHUB_TOKEN) {
    return res.status(501).json({ error: "GITHUB_TOKEN not configured on the server" });
  }

  const { data: project } = await supabaseAdmin
    .from("projects")
    .select("name, repo_url")
    .eq("id", body.projectId)
    .eq("workspace_id", req.workspaceId!)
    .single();

  if (!project?.repo_url) {
    return res.status(400).json({ error: "Project has no linked GitHub repository" });
  }

  const fullName = extractRepoFullName(project.repo_url);
  if (!fullName) {
    return res.status(400).json({ error: "Cannot parse GitHub repo URL" });
  }

  const repoRes = await ghFetch(`/repos/${fullName}`);
  if (!repoRes.ok) return res.status(502).json({ error: "Cannot reach GitHub repo" });
  const repoData: any = await repoRes.json();
  const branch = repoData.default_branch ?? "main";

  const results: { path: string; status: string; url?: string }[] = [];

  for (const file of body.files) {
    let sha: string | undefined;
    try {
      const existing = await ghFetch(`/repos/${fullName}/contents/${file.path}?ref=${branch}`);
      if (existing.ok) {
        const ed: any = await existing.json();
        sha = ed.sha;
      }
    } catch { }

    const contentB64 = Buffer.from(file.content, "utf-8").toString("base64");
    const pushRes = await ghFetch(`/repos/${fullName}/contents/${file.path}`, {
      method: "PUT",
      body: JSON.stringify({ message: body.message, content: contentB64, sha, branch }),
    });

    const pushData: any = pushRes.ok ? await pushRes.json() : null;
    results.push({
      path: file.path,
      status: pushRes.ok ? "pushed" : "failed",
      url: pushData?.content?.html_url,
    });
  }

  const allOk = results.every((r) => r.status === "pushed");
  res.status(allOk ? 200 : 207).json({ results, branch, repo: fullName });
});

export default r;
