import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireWorkspace } from "../middleware/auth.js";
import { supabaseAdmin } from "../config/supabase.js";

const r = Router();
r.use(requireAuth, requireWorkspace);

// GET /pull-requests/stats
r.get("/stats", async (req, res) => {
  // pull_requests is linked to workspace through projects
  const { data, error } = await supabaseAdmin
    .from("pull_requests")
    .select("state, created_at, projects!inner(workspace_id)")
    .eq("projects.workspace_id", req.workspaceId!);
  if (error) throw error;

  const counts = { open: 0, review: 0, merged: 0, closed: 0 };
  for (const pr of data ?? []) {
    const state = pr.state as keyof typeof counts;
    if (state in counts) counts[state]++;
  }

  res.json({ stats: { ...counts, avg_review_time: "N/A" } });
});

// GET /pull-requests?projectId=&state=
r.get("/", async (req, res) => {
  const projectId = req.query.projectId as string | undefined;
  const state = req.query.state as string | undefined;

  let query = supabaseAdmin
    .from("pull_requests")
    .select("*, projects!inner(workspace_id)")
    .eq("projects.workspace_id", req.workspaceId!);

  if (projectId) query = query.eq("project_id", projectId);
  if (state) query = query.eq("state", state);

  const { data, error } = await query;
  if (error) throw error;
  res.json({ data });
});

// GET /pull-requests/:id
r.get("/:id", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("pull_requests")
    .select("*")
    .eq("id", req.params.id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return res.status(404).json({ error: "Not found" });
  res.json({ data });
});

// POST /pull-requests/:id/review
r.post("/:id/review", async (req, res) => {
  // Stub for triggering an AI review
  res.status(202).json({ status: "queued", message: "Review triggered" });
});

// POST /pull-requests/:id/comment
r.post("/:id/comment", async (req, res) => {
  const body = z.object({ body: z.string().min(1) }).parse(req.body);
  // Stub for posting comment to GitHub PR
  res.status(201).json({ status: "commented" });
});

// POST /pull-requests/:id/approve
r.post("/:id/approve", async (req, res) => {
  // Stub for approving PR
  res.status(200).json({ status: "approved" });
});

// POST /pull-requests/:id/request-changes
r.post("/:id/request-changes", async (req, res) => {
  const body = z.object({ body: z.string().min(1) }).parse(req.body);
  // Stub for requesting changes on PR
  res.status(200).json({ status: "changes_requested" });
});

// GET /pull-requests/:id/diff
r.get("/:id/diff", async (req, res) => {
  // Stub for returning a unified diff
  res.json({ diff: "--- a/file\n+++ b/file\n..." });
});

export default r;
