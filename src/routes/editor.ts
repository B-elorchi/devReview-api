import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { aiLimiter } from "../middleware/rateLimit.js";
import { chatModel } from "../config/ai.js";
import { supabaseAdmin } from "../config/supabase.js";
import { openSse, sseSend, sseClose } from "../utils/sse.js";

const r = Router();
r.use(requireAuth);

r.post("/sandboxes", async (req, res) => {
  const body = z.object({
    project_id: z.string().uuid().optional(),
    template: z.string().default("node20"),
  }).parse(req.body);
  const { data, error } = await supabaseAdmin.from("editor_sandboxes").insert({
    ...body, owner_id: req.user!.id, status: "provisioning",
  }).select().single();
  if (error) throw error;
  // TODO: enqueue sandbox provisioning job
  res.status(201).json({ sandbox: data });
});

r.get("/sandboxes/:id/files", async (req, res) => {
  const path = (req.query.path as string) || "/";
  const { data, error } = await supabaseAdmin.from("editor_files")
    .select("path, type, size, updated_at")
    .eq("sandbox_id", req.params.id).like("path", `${path}%`);
  if (error) throw error;
  res.json({ files: data });
});

r.put("/sandboxes/:id/files", async (req, res) => {
  const body = z.object({ path: z.string().min(1), content: z.string() }).parse(req.body);
  const { error } = await supabaseAdmin.from("editor_files").upsert({
    sandbox_id: req.params.id, path: body.path, content: body.content,
    size: body.content.length, type: "file", updated_at: new Date().toISOString(),
  }, { onConflict: "sandbox_id,path" });
  if (error) throw error;
  res.json({ ok: true });
});

r.post("/chat", aiLimiter, async (req, res) => {
  const body = z.object({
    messages: z.array(z.object({ role: z.enum(["user", "assistant", "system"]), content: z.string() })),
    file: z.object({ path: z.string(), language: z.string(), content: z.string() }).optional(),
  }).parse(req.body);
  openSse(res);
  const system = `You are an AI pair-programmer inside an online IDE.${
    body.file
      ? `\nActive file: ${body.file.path} (${body.file.language})\n\`\`\`\n${body.file.content}\n\`\`\``
      : ""
  }\nWhen suggesting edits, return the COMPLETE updated file in a single fenced code block.`;

  const langchainMessages = [
    { role: "system", content: system },
    ...body.messages
  ];

  try {
    const stream = await chatModel.stream(langchainMessages);
    for await (const chunk of stream) {
      if (chunk.content) {
        sseSend(res, "delta", { text: chunk.content });
      }
    }
  } catch (error) {
    console.error("LangChain chat error:", error);
    sseSend(res, "error", { text: "Chat failed." });
  } finally {
    sseClose(res);
  }
});

export default r;
