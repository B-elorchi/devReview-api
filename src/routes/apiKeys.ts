import { Router } from "express";
import { z } from "zod";
import { randomBytes } from "crypto";
import { requireAuth } from "../middleware/auth.js";
import { supabaseAdmin } from "../config/supabase.js";
import { hashApiKey } from "../utils/crypto.js";

const r = Router();
r.use(requireAuth);

r.get("/", async (req, res) => {
  const { data, error } = await supabaseAdmin.from("api_keys")
    .select("id, name, prefix, last_used_at, created_at")
    .eq("user_id", req.user!.id);
  if (error) throw error;
  res.json({ keys: data });
});

r.post("/", async (req, res) => {
  const { name } = z.object({ name: z.string().min(1).max(80) }).parse(req.body);
  const raw = "dvr_" + randomBytes(24).toString("base64url");
  const hash = await hashApiKey(raw);
  const { data, error } = await supabaseAdmin.from("api_keys").insert({
    user_id: req.user!.id, name, prefix: raw.slice(0, 10), hash,
  }).select("id, name, prefix, created_at").single();
  if (error) throw error;
  res.status(201).json({ key: data, secret: raw });
});

r.delete("/:id", async (req, res) => {
  const { error } = await supabaseAdmin.from("api_keys")
    .delete().eq("id", req.params.id).eq("user_id", req.user!.id);
  if (error) throw error;
  res.status(204).end();
});

export default r;
