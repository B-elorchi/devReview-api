import { randomBytes } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { supabaseAdmin } from "../config/supabase.js";
import { sendTeamInviteEmail } from "../services/email.js";

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
  const { data: members, error } = await supabaseAdmin
    .from("workspace_members")
    .select("user_id, role, created_at")
    .eq("workspace_id", req.params.id);
  if (error) throw error;

  const userIds = [...new Set((members ?? []).map((member) => member.user_id))];
  const { data: profiles, error: profilesError } = userIds.length
    ? await supabaseAdmin
        .from("profiles")
        .select("id, full_name, avatar_url, email")
        .in("id", userIds)
    : { data: [], error: null };
  if (profilesError) throw profilesError;

  const profilesById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  const missingProfileIds = userIds.filter((userId) => !profilesById.has(userId));

  if (missingProfileIds.length) {
    const { data: { users }, error: usersError } = await supabaseAdmin.auth.admin.listUsers();
    if (usersError) throw usersError;

    users
      .filter((user) => missingProfileIds.includes(user.id))
      .forEach((user) => {
        profilesById.set(user.id, {
          id: user.id,
          email: user.email ?? null,
          full_name: user.user_metadata?.full_name ?? user.email?.split("@")[0] ?? null,
          avatar_url: user.user_metadata?.avatar_url ?? null,
        });
      });
  }

  res.json({
    members: (members ?? []).map((member) => ({
      ...member,
      profiles: profilesById.get(member.user_id) ?? null,
    })),
  });
});

r.post("/:id/members/invite", async (req, res) => {
  const body = z.object({
    email: z.string().email(),
    role: z.enum(["member", "admin", "viewer"]).default("member"),
  }).parse(req.body);

  // Supabase Admin has no direct get-by-email endpoint.
  const { data: { users }, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
  if (listErr) throw listErr;

  let target = users.find((u) => u.email?.toLowerCase() === body.email.toLowerCase());
  let createdAccount = false;

  if (!target) {
    const temporaryPassword = randomBytes(24).toString("base64url");
    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: body.email,
      password: temporaryPassword,
      email_confirm: false,
      user_metadata: {
        invited_by: req.user!.id,
        invited_workspace_id: req.params.id,
      },
    });

    if (createError || !created?.user) {
      return res.status(400).json({ error: createError?.message ?? "Failed to create invited user" });
    }

    target = created.user;
    createdAccount = true;
  }

  const { error: profileError } = await supabaseAdmin.from("profiles").upsert({
    id: target.id,
    email: target.email ?? body.email,
    full_name: target.user_metadata?.full_name ?? (target.email ?? body.email).split("@")[0],
  }, { onConflict: "id", ignoreDuplicates: true });
  if (profileError) throw profileError;

  const { error } = await supabaseAdmin.from("workspace_members").upsert({
    workspace_id: req.params.id,
    user_id: target.id,
    role: body.role,
  }, { onConflict: "workspace_id,user_id" });
  if (error) throw error;

  const { data: workspace, error: workspaceError } = await supabaseAdmin
    .from("workspaces")
    .select("name")
    .eq("id", req.params.id)
    .maybeSingle();
  if (workspaceError) throw workspaceError;
  if (createdAccount) {
    const appUrl = process.env.APP_URL || "http://localhost:8080";
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email: body.email,
      options: { redirectTo: `${appUrl}/update-password` },
    });

    if (!linkError && linkData?.properties?.hashed_token) {
      const actionLink = `${appUrl}/update-password?token=${linkData.properties.hashed_token}`;
      await sendTeamInviteEmail(body.email, actionLink, workspace?.name ?? "your team");
    }
  }

  res.status(201).json({ status: createdAccount ? "created" : "added", user_id: target.id });
});

r.patch("/:id/members/:userId/role", async (req, res) => {
  const { role } = z.object({ role: z.enum(["member", "admin", "viewer", "owner"]) }).parse(req.body);
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
