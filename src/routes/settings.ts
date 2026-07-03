import { Router } from "express";
import { requireAuth, requireWorkspace } from "../middleware/auth.js";
import { supabaseAdmin } from "../config/supabase.js";
import { z } from "zod";

const r = Router();
r.use(requireAuth);

// GET /settings/profile
r.get("/profile", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("id", req.user!.id)
    .single();

  if (error) throw error;
  res.json({ profile: data });
});

// PATCH /settings/profile
r.patch("/profile", async (req, res) => {
  const body = z.object({
    display_name: z.string().optional(),
    avatar_url: z.string().optional(),
    locale: z.string().optional()
  }).parse(req.body);

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .update(body)
    .eq("id", req.user!.id)
    .select()
    .single();

  if (error) throw error;
  res.json({ profile: data });
});

// POST /settings/avatar
r.post("/avatar", async (req, res) => {
  // Multipart upload logic stub
  res.json({ url: "https://example.com/avatar.png" });
});

// GET /settings/security
r.get("/security", async (req, res) => {
  res.json({ sessions: [], two_factor_enabled: false });
});

// POST /settings/sessions/:id/revoke
r.post("/sessions/:id/revoke", async (req, res) => {
  res.status(204).end();
});

// Workspace-scoped settings
r.get("/workspace", requireWorkspace, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("workspaces")
    .select("*")
    .eq("id", req.workspaceId!)
    .single();

  if (error) throw error;
  res.json({ workspace: data });
});

r.patch("/workspace", requireWorkspace, async (req, res) => {
  const body = z.object({ name: z.string().optional(), slug: z.string().optional() }).parse(req.body);
  const { data, error } = await supabaseAdmin
    .from("workspaces")
    .update(body)
    .eq("id", req.workspaceId!)
    .select()
    .single();

  if (error) throw error;
  res.json({ workspace: data });
});

// GET /settings/integrations
r.get("/integrations", requireWorkspace, async (req, res) => {
  res.json({ integrations: { github: false, telegram: false } });
});

// GET /settings/secrets
r.get("/secrets", requireWorkspace, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("secrets_vault")
    .select("name, updated_at")
    .eq("workspace_id", req.workspaceId!);
  if (error) throw error;
  res.json({ secrets: data });
});

// POST /settings/secrets
r.post("/secrets", requireWorkspace, async (req, res) => {
  const body = z.object({ name: z.string(), value: z.string() }).parse(req.body);
  // Real implementation needs to encrypt value
  const { error } = await supabaseAdmin
    .from("secrets_vault")
    .insert({
      workspace_id: req.workspaceId!,
      name: body.name,
      ciphertext: "encrypted",
      iv: "iv",
      tag: "tag"
    });
  
  if (error) throw error;
  res.status(201).json({ status: "saved" });
});

// DELETE /settings/secrets/:name
r.delete("/secrets/:name", requireWorkspace, async (req, res) => {
  const { error } = await supabaseAdmin
    .from("secrets_vault")
    .delete()
    .eq("workspace_id", req.workspaceId!)
    .eq("name", req.params.name);
  if (error) throw error;
  res.status(204).end();
});

export default r;
