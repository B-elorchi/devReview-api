import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireWorkspace } from "../middleware/auth.js";
import { supabaseAdmin } from "../config/supabase.js";
import { runReviewJob, getReviewProgress } from "../services/review.js";
import { enqueueNotification } from "../services/notifications.js";

const r = Router();

r.get("/reviews", requireAuth, requireWorkspace, async (req, res) => {
  let q = supabaseAdmin
    .from("reviews")
    .select("*, review_findings(*), projects!inner(name, workspace_id)")
    .eq("projects.workspace_id", req.workspaceId!)
    .order("created_at", { ascending: false })
    .limit(20);
  if (req.query.projectId) q = q.eq("project_id", req.query.projectId as string);
  const { data, error } = await q;
  if (error) throw error;
  res.json({ data });
});

r.post("/projects/:id/reviews", requireAuth, requireWorkspace, async (req, res) => {
  const body = z.object({
    ref: z.string().default("HEAD"),
    pr_number: z.number().optional(),
    diff: z.string().optional(),
  }).parse(req.body);

  const { data: review, error } = await supabaseAdmin.from("reviews").insert({
    project_id: req.params.id, status: "queued",
    requested_by: req.user!.id, ref: body.ref, pr_number: body.pr_number,
  }).select().single();
  if (error) throw error;

  // Run inline (no Redis/BullMQ required) — respond immediately then process
  res.status(202).json({ review });
  // Fire and forget — errors are caught inside runReviewJob
  runReviewJob({ reviewId: review.id, diff: body.diff }).catch((err) => {
    console.error("Review job error", err);
  });
});

// Live progress — polled by the frontend while a review runs
r.get("/reviews/:id/progress", requireAuth, requireWorkspace, async (req, res) => {
  const progress = getReviewProgress(req.params.id);
  if (progress) return res.json({ progress });
  // No in-memory entry (server restarted or review finished long ago) — derive from DB
  const { data } = await supabaseAdmin.from("reviews").select("status").eq("id", req.params.id).maybeSingle();
  res.json({ progress: data ? { status: data.status, files_total: 0, files_done: 0, current_file: null, findings_count: 0, files: [], recent_findings: [] } : null });
});

r.get("/reviews/:id", requireAuth, requireWorkspace, async (req, res) => {
  const { data, error } = await supabaseAdmin.from("reviews")
    .select("*, review_findings(*)").eq("id", req.params.id).maybeSingle();
  if (error) throw error;
  if (!data) return res.status(404).json({ error: "Not found" });
  res.json({ review: data });
});

r.get("/projects/:id/pull-requests", requireAuth, requireWorkspace, async (req, res) => {
  const { data, error } = await supabaseAdmin.from("pull_requests")
    .select("*").eq("project_id", req.params.id).order("updated_at", { ascending: false });
  if (error) throw error;
  res.json({ pull_requests: data });
});

export default r;
