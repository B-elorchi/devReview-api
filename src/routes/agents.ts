import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireWorkspace } from "../middleware/auth.js";
import { aiLimiter } from "../middleware/rateLimit.js";
import { chatModel } from "../config/ai.js";
import { supabaseAdmin } from "../config/supabase.js";
import { openSse, sseSend, sseClose } from "../utils/sse.js";

const r = Router();
r.use(requireAuth, requireWorkspace);

r.get("/", async (req, res) => {
  const { data, error } = await supabaseAdmin.from("agents")
    .select("*").eq("workspace_id", req.workspaceId!);
  if (error) throw error;
  res.json({ agents: data });
});

r.post("/", async (req, res) => {
  const body = z.object({
    name: z.string().min(1).max(80),
    system_prompt: z.string().min(1).max(8000),
    model: z.string().default("google/gemini-2.5-flash"),
    tools: z.array(z.string()).default([]),
  }).parse(req.body);
  const { data, error } = await supabaseAdmin.from("agents").insert({
    ...body, workspace_id: req.workspaceId!, created_by: req.user!.id,
  }).select().single();
  if (error) throw error;
  res.status(201).json({ agent: data });
});

// GET version for EventSource clients (token + input as query params)
r.get("/:id/run", aiLimiter, async (req, res) => {
  const input = String(req.query.input ?? "").slice(0, 8000);
  if (!input) return res.status(400).json({ error: "input required" });
  const { data: agent } = await supabaseAdmin.from("agents").select("*").eq("id", req.params.id).single();
  const { data: session } = await supabaseAdmin.from("agent_sessions").insert({
    agent_id: req.params.id, started_by: req.user!.id, status: "running",
  }).select().single();

  openSse(res);
  sseSend(res, "session", { id: session!.id });

  const msgs: any[] = [];
  if (agent?.system_prompt) msgs.push({ role: "system", content: agent.system_prompt });
  msgs.push({ role: "user", content: input });

  let full = "";
  try {
    const stream = await chatModel.stream(msgs);
    for await (const chunk of stream) {
      if (chunk.content) { full += chunk.content; sseSend(res, "delta", { text: chunk.content }); }
    }
  } catch (e) { console.error("Agent run failed", e); }

  await supabaseAdmin.from("agent_sessions")
    .update({ status: "completed", output: full, ended_at: new Date().toISOString() })
    .eq("id", session!.id);
  sseClose(res);
});

r.post("/:id/run", aiLimiter, async (req, res) => {
  const { input } = z.object({ input: z.string().min(1).max(8000) }).parse(req.body);
  const { data: agent } = await supabaseAdmin.from("agents").select("*").eq("id", req.params.id).single();
  const { data: session } = await supabaseAdmin.from("agent_sessions").insert({
    agent_id: req.params.id, started_by: req.user!.id, status: "running",
  }).select().single();

  openSse(res);
  sseSend(res, "session", { id: session!.id });

  const langchainMessages = [];
  if (agent?.system_prompt) langchainMessages.push({ role: "system", content: agent.system_prompt });
  langchainMessages.push({ role: "user", content: input });

  let full = "";
  try {
    const stream = await chatModel.stream(langchainMessages);
    for await (const chunk of stream) {
      if (chunk.content) {
        full += chunk.content;
        sseSend(res, "delta", { text: chunk.content });
      }
    }
  } catch (error) {
    console.error("Agent run failed", error);
  }

  await supabaseAdmin.from("agent_sessions")
    .update({ status: "completed", output: full, ended_at: new Date().toISOString() })
    .eq("id", session!.id);
  sseClose(res);
});

r.get("/sessions/:id", async (req, res) => {
  const { data, error } = await supabaseAdmin.from("agent_sessions")
    .select("*").eq("id", req.params.id).maybeSingle();
  if (error) throw error;
  res.json({ session: data });
});

export default r;
