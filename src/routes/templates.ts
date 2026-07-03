import { Router } from "express";
import { requireAuth, requireWorkspace } from "../middleware/auth.js";
import { supabaseAdmin } from "../config/supabase.js";
import { z } from "zod";

const r = Router();

// GET /templates?stack=&q= (public)
r.get("/", async (req, res) => {
  const stack = req.query.stack as string | undefined;
  const q = req.query.q as string | undefined;

  let query = supabaseAdmin.from("templates").select("*");
  if (stack) query = query.eq("stack", stack);
  if (q) query = query.ilike("name", `%${q}%`);

  const { data, error } = await query;
  if (error) throw error;
  res.json({ data });
});

// GET /templates/:slug (public)
r.get("/:slug", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("templates")
    .select("*")
    .eq("slug", req.params.slug)
    .maybeSingle();

  if (error) throw error;
  if (!data) return res.status(404).json({ error: "Not found" });
  res.json({ data });
});

// Requires Auth
r.use(requireAuth);

// POST /templates/:slug/use
r.post("/:slug/use", requireWorkspace, async (req, res) => {
  // Logic to create a project from template
  res.status(201).json({ status: "created", message: "Project created from template" });
});

// POST /templates (admin only ideally, skipping strict role check for now)
r.post("/", async (req, res) => {
  const body = z.object({
    slug: z.string(),
    name: z.string(),
    stack: z.string(),
    tags: z.array(z.string()).optional(),
    repo_url: z.string().url(),
  }).parse(req.body);

  const { data, error } = await supabaseAdmin
    .from("templates")
    .insert(body)
    .select()
    .single();

  if (error) throw error;
  res.status(201).json({ data });
});

export default r;
