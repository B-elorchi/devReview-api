import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireWorkspace } from "../middleware/auth.js";
import { aiLimiter } from "../middleware/rateLimit.js";
import { chatModel } from "../config/ai.js";
import { supabaseAdmin } from "../config/supabase.js";
import { openSse, sseSend, sseClose } from "../utils/sse.js";

const r = Router();
r.use(requireAuth, requireWorkspace);

// ─── CRUD ─────────────────────────────────────────────────────────────────────

r.get("/", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("agents")
    .select("*")
    .eq("workspace_id", req.workspaceId!)
    .order("created_at", { ascending: true });
  if (error) throw error;
  res.json({ agents: data });
});

r.post("/", async (req, res) => {
  const body = z.object({
    name:          z.string().min(1).max(80),
    description:   z.string().max(300).optional().default(""),
    system_prompt: z.string().min(1).max(12000),
    icon_key:      z.string().max(40).optional().default("bot"),
    color:         z.string().max(100).optional().default("from-primary to-accent"),
    model:         z.string().optional().default("gpt-4.1-mini"),
    tools:         z.array(z.string()).optional().default([]),
  }).parse(req.body);

  const slug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  const { data, error } = await supabaseAdmin
    .from("agents")
    .insert({ ...body, slug, workspace_id: req.workspaceId!, created_by: req.user!.id })
    .select()
    .single();
  if (error) throw error;
  res.status(201).json({ agent: data });
});

r.put("/:id", async (req, res) => {
  const body = z.object({
    name:          z.string().min(1).max(80).optional(),
    description:   z.string().max(300).optional(),
    system_prompt: z.string().min(1).max(12000).optional(),
    icon_key:      z.string().max(40).optional(),
    color:         z.string().max(100).optional(),
    model:         z.string().optional(),
  }).parse(req.body);

  const { data, error } = await supabaseAdmin
    .from("agents")
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .eq("workspace_id", req.workspaceId!)
    .select()
    .single();
  if (error) throw error;
  res.json({ agent: data });
});

r.delete("/:id", async (req, res) => {
  const { error } = await supabaseAdmin
    .from("agents")
    .delete()
    .eq("id", req.params.id)
    .eq("workspace_id", req.workspaceId!);
  if (error) throw error;
  res.json({ ok: true });
});

// ─── Run (SSE streaming) ──────────────────────────────────────────────────────

async function runAgentStream(
  res: any,
  systemPrompt: string,
  messages: { role: string; content: string }[],
  agentId: string,
  userId: string,
) {
  const { data: session } = await supabaseAdmin
    .from("agent_sessions")
    .insert({ agent_id: agentId, started_by: userId, status: "running" })
    .select()
    .single();

  openSse(res);
  sseSend(res, "session", { id: session?.id });

  const langMsgs: any[] = [];
  if (systemPrompt) langMsgs.push({ role: "system", content: systemPrompt });
  langMsgs.push(...messages);

  let full = "";
  try {
    const stream = await chatModel.stream(langMsgs);
    for await (const chunk of stream) {
      if (chunk.content) {
        full += chunk.content;
        sseSend(res, "delta", { text: chunk.content });
      }
    }
  } catch (e) {
    console.error("Agent stream failed", e);
    sseSend(res, "error", { message: "Agent failed" });
  }

  if (session) {
    await supabaseAdmin
      .from("agent_sessions")
      .update({ status: "completed", output: full, ended_at: new Date().toISOString() })
      .eq("id", session.id);
  }
  sseClose(res);
}

// GET — for EventSource clients (token + input as query params)
r.get("/:id/run", aiLimiter, async (req, res) => {
  const input = String(req.query.input ?? "").slice(0, 8000);
  if (!input) return res.status(400).json({ error: "input required" });

  const { data: agent } = await supabaseAdmin
    .from("agents").select("*").eq("id", req.params.id).single();
  if (!agent) return res.status(404).json({ error: "Agent not found" });

  await runAgentStream(
    res,
    agent.system_prompt,
    [{ role: "user", content: input }],
    req.params.id,
    req.user!.id,
  );
});

// POST — for fetch-based SSE with history
r.post("/:id/run", aiLimiter, async (req, res) => {
  const body = z.object({
    input:   z.string().min(1).max(8000),
    history: z.array(z.object({ role: z.string(), content: z.string() })).default([]),
  }).parse(req.body);

  const { data: agent } = await supabaseAdmin
    .from("agents").select("*").eq("id", req.params.id).single();
  if (!agent) return res.status(404).json({ error: "Agent not found" });

  await runAgentStream(
    res,
    agent.system_prompt,
    [...body.history, { role: "user", content: body.input }],
    req.params.id,
    req.user!.id,
  );
});

r.get("/sessions/:id", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("agent_sessions").select("*").eq("id", req.params.id).maybeSingle();
  if (error) throw error;
  res.json({ session: data });
});

export default r;
