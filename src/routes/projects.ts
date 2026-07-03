import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireWorkspace } from "../middleware/auth.js";
import { supabaseAdmin } from "../config/supabase.js";
import { env } from "../config/env.js";
import { enqueueNotification } from "../services/notifications.js";

const r = Router();
r.use(requireAuth, requireWorkspace);

// ─── helpers ──────────────────────────────────────────────────────────────────

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

type TreeNode = {
  name: string; type: "file" | "folder"; lang?: string; content?: string; children?: TreeNode[];
};

function buildTree(flatFiles: { path: string; sha: string }[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const file of flatFiles) {
    const parts = file.path.split("/");
    let nodes = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      let node = nodes.find((n) => n.name === part);
      if (!node) {
        node = isLast
          ? { name: part, type: "file", lang: langFromName(part), content: "" }
          : { name: part, type: "folder", children: [] };
        nodes.push(node);
      }
      if (!isLast) nodes = (node as any).children;
    }
  }
  return root;
}

function langFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescriptreact", js: "javascript", jsx: "javascriptreact",
    py: "python", go: "go", rs: "rust", java: "java", cs: "csharp",
    json: "json", yaml: "yaml", yml: "yaml", toml: "toml",
    md: "markdown", sh: "shell", dockerfile: "dockerfile", tf: "hcl",
    html: "html", css: "css", sql: "sql",
  };
  if (name.toLowerCase() === "dockerfile") return "dockerfile";
  return map[ext] ?? "plaintext";
}

const STATIC_FILES: any = {
  fileTree: [
    { name: "src", type: "folder", children: [
      { name: "controllers", type: "folder", children: [
        { name: "auth.ts", type: "file", lang: "typescript" },
        { name: "user.ts", type: "file", lang: "typescript" },
      ] },
      { name: "index.ts", type: "file", lang: "typescript" },
    ] },
    { name: "package.json", type: "file", lang: "json" },
    { name: "Dockerfile", type: "file", lang: "dockerfile" },
  ],
  sampleFiles: {
    "src/index.ts": { lang: "typescript", content: `import express from 'express';\nconst app = express();\napp.listen(3000);` },
    "src/controllers/auth.ts": { lang: "typescript", content: `export async function login(req, res) {\n  // TODO: implement\n}` },
    "src/controllers/user.ts": { lang: "typescript", content: `export async function getUser(req, res) {\n  const userId = req.params.id;\n  // ⚠️ SQL injection risk:\n  // const result = await db.raw(\`SELECT * FROM users WHERE id = \${userId}\`);\n  res.json({ id: userId });\n}` },
    "package.json": { lang: "json", content: `{\n  "name": "app",\n  "version": "1.0.0"\n}` },
    "Dockerfile": { lang: "dockerfile", content: `FROM node:20-alpine\nWORKDIR /app\nCOPY . .\nRUN npm ci\nCMD ["node", "dist/index.js"]` },
  },
};

// ─── routes ───────────────────────────────────────────────────────────────────

r.get("/", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("projects").select("*").eq("workspace_id", req.workspaceId!);
  if (error) throw error;
  res.json({ projects: data });
});

r.post("/", async (req, res) => {
  const body = z.object({
    name: z.string().min(1).max(120),
    repo_url: z.string().url().optional(),
    description: z.string().max(500).optional(),
  }).parse(req.body);
  const { data, error } = await supabaseAdmin.from("projects").insert({
    ...body, workspace_id: req.workspaceId!, created_by: req.user!.id,
  }).select().single();
  if (error) throw error;
  await enqueueNotification({
    userId: req.user!.id,
    type: "project",
    title: "Project created",
    body: `${data.name} was added to your workspace.`,
    link: `/projects/${data.id}`,
  });
  res.status(201).json({ project: data });
});

r.get("/:id", async (req, res) => {
  const { data, error } = await supabaseAdmin.from("projects")
    .select("*").eq("id", req.params.id).eq("workspace_id", req.workspaceId!).maybeSingle();
  if (error) throw error;
  if (!data) return res.status(404).json({ error: "Not found" });
  res.json({ project: data });
});

r.get("/:id/files", async (req, res) => {
  // Try to fetch real files from GitHub if configured
  if (env.GITHUB_TOKEN) {
    const { data: project } = await supabaseAdmin.from("projects")
      .select("repo_url").eq("id", req.params.id).single();

    const fullName = project?.repo_url ? extractRepoFullName(project.repo_url) : null;

    if (fullName) {
      try {
        // Get the default branch
        const repoRes = await ghFetch(`/repos/${fullName}`);
        if (repoRes.ok) {
          const repoData: any = await repoRes.json();
          const branch = repoData.default_branch ?? "main";

          // Get recursive tree
          const treeRes = await ghFetch(`/repos/${fullName}/git/trees/${branch}?recursive=1`);
          if (treeRes.ok) {
            const treeData: any = await treeRes.json();
            const fileItems = (treeData.tree ?? []).filter((t: any) => t.type === "blob" && t.size < 200_000);

            const fileTree = buildTree(fileItems.map((f: any) => ({ path: f.path, sha: f.sha })));

            // Fetch content for up to 10 small files to pre-populate the editor
            const smallFiles = fileItems.filter((f: any) => (f.size ?? 0) < 50_000).slice(0, 10);
            const sampleFiles: Record<string, { lang: string; content: string }> = {};

            await Promise.all(
              smallFiles.map(async (f: any) => {
                try {
                  const cr = await ghFetch(`/repos/${fullName}/contents/${f.path}?ref=${branch}`);
                  if (cr.ok) {
                    const cd: any = await cr.json();
                    if (cd.content) {
                      const content = Buffer.from(cd.content.replace(/\n/g, ""), "base64").toString("utf-8");
                      sampleFiles[f.path] = { lang: langFromName(f.name ?? f.path.split("/").pop() ?? ""), content };
                    }
                  }
                } catch (innerErr) {
                  console.error(`Failed to fetch content for ${f.path}:`, innerErr);
                }
              })
            );

            return res.json({ fileTree, sampleFiles, source: "github", branch });
          }
        }
      } catch (err) {
        console.error("GitHub file fetch failed, falling back to static", err);
      }
    }
  }

  res.json({ ...STATIC_FILES, source: "static" });
});

// Fetch a single file's content (for lazy loading when user clicks a tree node)
r.get("/:id/files/:filePath(*)", async (req, res) => {
  const filePath = req.params.filePath;

  if (env.GITHUB_TOKEN) {
    const { data: project } = await supabaseAdmin.from("projects")
      .select("repo_url").eq("id", req.params.id).single();
    const fullName = project?.repo_url ? extractRepoFullName(project.repo_url) : null;

    if (fullName) {
      try {
        const repoRes = await ghFetch(`/repos/${fullName}`);
        const repoData: any = repoRes.ok ? await repoRes.json() : {};
        const branch = repoData.default_branch ?? "main";

        const cr = await ghFetch(`/repos/${fullName}/contents/${filePath}?ref=${branch}`);
        if (cr.ok) {
          const cd: any = await cr.json();
          if (cd.encoding === "base64") {
            const content = Buffer.from(cd.content.replace(/\n/g, ""), "base64").toString("utf-8");
            return res.json({ content, lang: langFromName(filePath.split("/").pop() ?? filePath) });
          }
        }
      } catch (err) {
        console.error("Single file fetch failed", err);
      }
    }
  }

  res.status(404).json({ error: "File not found or GitHub not configured", content: "" });
});

r.post("/:id/push", async (req, res) => {
  const body = z.object({
    message: z.string().min(1).max(500),
    files: z.array(z.object({ path: z.string(), content: z.string() })).min(1).max(20),
  }).parse(req.body);

  if (!env.GITHUB_TOKEN) {
    return res.status(501).json({ error: "GITHUB_TOKEN not configured" });
  }

  const { data: project } = await supabaseAdmin.from("projects")
    .select("repo_url, name").eq("id", req.params.id).single();
  const fullName = project?.repo_url ? extractRepoFullName(project.repo_url) : null;
  if (!fullName) return res.status(400).json({ error: "Project has no linked GitHub repo" });

  // Get default branch
  const repoRes = await ghFetch(`/repos/${fullName}`);
  if (!repoRes.ok) return res.status(502).json({ error: "Cannot reach GitHub repo" });
  const repoData: any = await repoRes.json();
  const branch = repoData.default_branch ?? "main";

  const results: { path: string; status: string }[] = [];

  for (const file of body.files) {
    // Get existing SHA if file exists (required for update)
    let sha: string | undefined;
    try {
      const existing = await ghFetch(`/repos/${fullName}/contents/${file.path}?ref=${branch}`);
      if (existing.ok) {
        const ed: any = await existing.json();
        sha = ed.sha;
      }
    } catch {}

    const contentB64 = Buffer.from(file.content, "utf-8").toString("base64");
    const pushRes = await ghFetch(`/repos/${fullName}/contents/${file.path}`, {
      method: "PUT",
      body: JSON.stringify({ message: body.message, content: contentB64, sha, branch }),
    });

    results.push({ path: file.path, status: pushRes.ok ? "pushed" : "failed" });
  }

  res.json({ results, branch, repo: fullName });
});

r.patch("/:id", async (req, res) => {
  const body = z.object({ name: z.string().optional(), description: z.string().optional() }).parse(req.body);
  const { data, error } = await supabaseAdmin.from("projects")
    .update(body).eq("id", req.params.id).eq("workspace_id", req.workspaceId!)
    .select().single();
  if (error) throw error;
  res.json({ project: data });
});

r.delete("/:id", async (req, res) => {
  const { error } = await supabaseAdmin.from("projects")
    .delete().eq("id", req.params.id).eq("workspace_id", req.workspaceId!);
  if (error) throw error;
  res.status(204).end();
});

export default r;
