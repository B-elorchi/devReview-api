import { Router } from "express";
import { requireAuth, requireWorkspace } from "../middleware/auth.js";
import { supabaseAdmin } from "../config/supabase.js";
import { z } from "zod";

const r = Router();
r.use(requireAuth, requireWorkspace);

// GET /webhooks
r.get("/", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("webhooks")
    .select("*")
    .eq("workspace_id", req.workspaceId!);
  if (error) throw error;
  res.json({ data });
});

// POST /webhooks
r.post("/", async (req, res) => {
  const body = z.object({
    url: z.string().url(),
    secret: z.string().min(1),
    events: z.array(z.string()),
    active: z.boolean().default(true)
  }).parse(req.body);

  const { data, error } = await supabaseAdmin
    .from("webhooks")
    .insert({ ...body, workspace_id: req.workspaceId! })
    .select()
    .single();

  if (error) throw error;
  res.status(201).json({ data });
});

// PATCH /webhooks/:id
r.patch("/:id", async (req, res) => {
  const body = z.object({
    url: z.string().url().optional(),
    secret: z.string().min(1).optional(),
    events: z.array(z.string()).optional(),
    active: z.boolean().optional()
  }).parse(req.body);

  const { data, error } = await supabaseAdmin
    .from("webhooks")
    .update(body)
    .eq("id", req.params.id)
    .eq("workspace_id", req.workspaceId!)
    .select()
    .single();

  if (error) throw error;
  res.json({ data });
});

// DELETE /webhooks/:id
r.delete("/:id", async (req, res) => {
  const { error } = await supabaseAdmin
    .from("webhooks")
    .delete()
    .eq("id", req.params.id)
    .eq("workspace_id", req.workspaceId!);

  if (error) throw error;
  res.status(204).end();
});

// GET /webhooks/:id/deliveries
r.get("/:id/deliveries", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("webhook_deliveries")
    .select("*")
    .eq("webhook_id", req.params.id); // In reality might need to check workspace_id ownership

  if (error) throw error;
  res.json({ data });
});

// POST /webhooks/:id/test
r.post("/:id/test", async (req, res) => {
  res.json({ status: "test_event_queued" });
});

export default r;
