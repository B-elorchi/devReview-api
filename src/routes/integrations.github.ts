import { Router, raw } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { supabaseAdmin } from "../config/supabase.js";
import { hmacSha256Hex, safeEqual } from "../utils/crypto.js";
import { requireAuth } from "../middleware/auth.js";
import { githubSyncQueue } from "../workers/queues.js";

const r = Router();

r.get("/stats", requireAuth, async (req, res) => {
  const workspaceId = req.query.workspaceId as string | undefined;
  let openPRs = 0;
  if (workspaceId) {
    const { count } = await supabaseAdmin
      .from("pull_requests")
      .select("id, projects!inner(workspace_id)", { count: "exact", head: true })
      .eq("projects.workspace_id", workspaceId)
      .eq("state", "open");
    openPRs = count ?? 0;
  }

  const { data: installation } = await supabaseAdmin
    .from("github_installations")
    .select("workspace_id, created_at")
    .eq("workspace_id", workspaceId ?? "")
    .maybeSingle();

  res.json({
    stats: {
      open_prs: openPRs,
      webhook_status: installation ? "Healthy" : "Not configured",
      installed: !!installation,
      installed_at: installation?.created_at ?? null,
    },
  });
});

r.get("/install-url", requireAuth, (_req, res) => {
  res.json({
    url: `https://github.com/apps/devreview-ai/installations/new?state=${encodeURIComponent("user")}`,
  });
});

r.get("/repos", requireAuth, async (req, res) => {
  if (!env.GITHUB_TOKEN) {
    return res.json({ repos: [], note: "GITHUB_TOKEN not configured" });
  }
  const ghRes = await fetch("https://api.github.com/user/repos?per_page=50&sort=pushed&affiliation=owner,collaborator", {
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json" },
  });
  if (!ghRes.ok) return res.status(502).json({ error: "GitHub API error" });
  const list: any[] = await ghRes.json();
  res.json({
    repos: list.map((r) => ({
      id: String(r.id),
      name: r.full_name,
      language: r.language ?? "Unknown",
      stars: r.stargazers_count,
      lastUpdated: new Date(r.pushed_at).toLocaleDateString(),
      private: r.private,
      url: r.html_url,
      clone_url: r.clone_url,
    })),
  });
});

r.post("/repos", requireAuth, async (req, res) => {
  if (!env.GITHUB_TOKEN) {
    return res.status(501).json({ error: "GITHUB_TOKEN not configured on server" });
  }
  const body = z.object({
    name: z.string().min(1).max(100),
    description: z.string().max(350).optional(),
    private: z.boolean().default(false),
  }).parse(req.body);

  const ghRes = await fetch("https://api.github.com/user/repos", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: body.name, description: body.description, private: body.private, auto_init: true }),
  });
  if (!ghRes.ok) {
    const err: any = await ghRes.json();
    return res.status(400).json({ error: err.message ?? "GitHub repo creation failed" });
  }
  const repo: any = await ghRes.json();
  res.status(201).json({ repo: { id: String(repo.id), name: repo.full_name, url: repo.html_url, clone_url: repo.clone_url } });
});

r.get("/installations", requireAuth, async (req, res) => {
  res.json({ installations: [] });
});

r.get("/installations/:id/repos", requireAuth, async (req, res) => {
  res.json({ repos: [] });
});

r.post("/installations/:id/link", requireAuth, async (req, res) => {
  res.status(201).json({ status: "linked" });
});

r.delete("/installations/:id", requireAuth, async (req, res) => {
  res.status(204).end();
});

// Public webhook — HMAC verified.
r.post("/webhook", raw({ type: "*/*" }), async (req, res) => {
  const sig = req.header("x-hub-signature-256");
  const body = (req.body as Buffer).toString("utf8");
  const expected = "sha256=" + hmacSha256Hex(env.GITHUB_WEBHOOK_SECRET, body);
  if (!sig || !safeEqual(sig, expected)) return res.status(401).send("Invalid signature");
  const event = req.header("x-github-event") || "unknown";
  await githubSyncQueue.add(event, { event, payload: JSON.parse(body) });
  res.json({ ok: true });
});

export default r;
