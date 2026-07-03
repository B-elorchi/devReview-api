import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { supabaseAdmin } from "../config/supabase.js";

const r = Router();
r.use(requireAuth);

r.get("/", async (req, res) => {
  const { data, error } = await supabaseAdmin.from("notifications")
    .select("*").eq("user_id", req.user!.id)
    .order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  res.json({ notifications: data });
});

r.post("/:id/read", async (req, res) => {
  await supabaseAdmin.from("notifications").update({ read_at: new Date().toISOString() })
    .eq("id", req.params.id).eq("user_id", req.user!.id);
  res.json({ ok: true });
});

r.post("/read-all", async (req, res) => {
  await supabaseAdmin.from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", req.user!.id)
    .is("read_at", null);
  res.json({ ok: true });
});

r.get("/preferences", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("notification_preferences")
    .select("*")
    .eq("user_id", req.user!.id)
    .maybeSingle();
  if (error) throw error;
  // Return defaults if no row yet
  res.json({
    preferences: data ?? {
      email_review_complete: true,
      email_pr_opened: true,
      email_deploy_failed: true,
      email_weekly_report: false,
      push_review_complete: true,
      push_pr_opened: false,
      push_deploy_failed: true,
      push_weekly_report: false,
    },
  });
});

r.patch("/preferences", async (req, res) => {
  const body = z.object({
    email_review_complete: z.boolean().optional(),
    email_pr_opened: z.boolean().optional(),
    email_deploy_failed: z.boolean().optional(),
    email_weekly_report: z.boolean().optional(),
    push_review_complete: z.boolean().optional(),
    push_pr_opened: z.boolean().optional(),
    push_deploy_failed: z.boolean().optional(),
    push_weekly_report: z.boolean().optional(),
  }).parse(req.body);

  const { data, error } = await supabaseAdmin
    .from("notification_preferences")
    .upsert({ user_id: req.user!.id, ...body }, { onConflict: "user_id" })
    .select()
    .single();
  if (error) throw error;
  res.json({ preferences: data });
});

export default r;
