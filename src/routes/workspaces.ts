import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { supabaseAdmin } from "../config/supabase.js";

const r = Router();
r.use(requireAuth);

r.get("/", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("workspaces")
    .select("*, workspace_members!inner(role)")
    .eq("workspace_members.user_id", req.user!.id);
  if (error) throw error;

  // Safety net: if the user somehow has zero workspaces, generate one dynamically.
  if (!data || data.length === 0) {
    const { data: ws } = await supabaseAdmin.from("workspaces")
      .insert({ name: "Personal Workspace", slug: `ws-${Date.now()}`, owner_id: req.user!.id })
      .select().single();
    
    if (ws) {
      await supabaseAdmin.from("workspace_members").insert({
        workspace_id: ws.id, user_id: req.user!.id, role: "owner"
      });
      return res.json({ workspaces: [{ ...ws, workspace_members: [{ role: "owner" }] }] });
    }
  }

  res.json({ workspaces: data });
});

r.post("/", async (req, res) => {
  const body = z.object({ name: z.string().min(1).max(80), slug: z.string().min(1).max(60) }).parse(req.body);
  const { data: ws, error } = await supabaseAdmin
    .from("workspaces").insert({ name: body.name, slug: body.slug, owner_id: req.user!.id })
    .select().single();
  if (error) throw error;
  await supabaseAdmin.from("workspace_members").insert({
    workspace_id: ws.id, user_id: req.user!.id, role: "owner",
  });
  res.status(201).json({ workspace: ws });
});

r.get("/:id/members", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("workspace_members")
    .select("user_id, role, created_at, profiles(id, full_name, avatar_url, email)")
    .eq("workspace_id", req.params.id);
  if (error) throw error;
  res.json({ members: data });
});

r.post("/:id/members/invite", async (req, res) => {
  const body = z.object({
    email: z.string().email(),
    role: z.enum(["member", "admin", "reviewer"]).default("member"),
  }).parse(req.body);

  // Look up user by email via auth
  const { data: { users }, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
  if (listErr) throw listErr;
  const target = users.find((u) => u.email === body.email);

  if (!target) {
    // Store pending invite
    const { error } = await supabaseAdmin.from("workspace_invites").upsert({
      workspace_id: req.params.id,
      invited_by: req.user!.id,
      email: body.email,
      role: body.role,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    }, { onConflict: "workspace_id,email" });
    if (error) throw error;
    return res.status(202).json({ status: "invited", note: "User not yet registered; invite stored." });
  }

  const { error } = await supabaseAdmin.from("workspace_members").upsert({
    workspace_id: req.params.id,
    user_id: target.id,
    role: body.role,
  }, { onConflict: "workspace_id,user_id" });
  if (error) throw error;
  res.status(201).json({ status: "added", user_id: target.id });
});

r.patch("/:id/members/:userId/role", async (req, res) => {
  const { role } = z.object({ role: z.enum(["member", "admin", "reviewer", "owner"]) }).parse(req.body);
  const { error } = await supabaseAdmin
    .from("workspace_members")
    .update({ role })
    .eq("workspace_id", req.params.id)
    .eq("user_id", req.params.userId);
  if (error) throw error;
  res.json({ ok: true });
});

r.delete("/:id/members/:userId", async (req, res) => {
  const { error } = await supabaseAdmin
    .from("workspace_members")
    .delete()
    .eq("workspace_id", req.params.id)
    .eq("user_id", req.params.userId);
  if (error) throw error;
  res.status(204).end();
});

export default r;
