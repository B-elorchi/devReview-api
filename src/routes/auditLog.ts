import { Router } from "express";
import { requireAuth, requireWorkspace } from "../middleware/auth.js";
import { supabaseAdmin } from "../config/supabase.js";

const r = Router();
r.use(requireAuth, requireWorkspace);

r.get("/", async (req, res) => {
  const { data, error } = await supabaseAdmin.from("audit_log")
    .select("*").eq("workspace_id", req.workspaceId!)
    .order("created_at", { ascending: false }).limit(200);
  if (error) throw error;
  res.json({ events: data });
});

export default r;
