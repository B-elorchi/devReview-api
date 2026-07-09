import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireWorkspace } from "../middleware/auth.js";
import { supabaseAdmin } from "../config/supabase.js";
import { runReviewJob } from "../services/review.js";
import { enqueueNotification } from "../services/notifications.js";

const r = Router();
r.use(requireAuth, requireWorkspace);

r.get("/reviews", async (req, res) => {
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

r.post("/projects/:id/reviews", async (req, res) => {
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

r.get("/reviews/:id", async (req, res) => {
  const { data, error } = await supabaseAdmin.from("reviews")
    .select("*, review_findings(*)").eq("id", req.params.id).maybeSingle();
  if (error) throw error;
  if (!data) return res.status(404).json({ error: "Not found" });
  res.json({ review: data });
});

r.get("/projects/:id/pull-requests", async (req, res) => {
  const { data, error } = await supabaseAdmin.from("pull_requests")
    .select("*").eq("project_id", req.params.id).order("updated_at", { ascending: false });
  if (error) throw error;
  res.json({ pull_requests: data });
});

export default r;
