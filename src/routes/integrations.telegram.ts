import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { requireAuth } from "../middleware/auth.js";
import { supabaseAdmin } from "../config/supabase.js";

const r = Router();

r.get("/status", requireAuth, async (req, res) => {
  const { data: link } = await supabaseAdmin
    .from("telegram_links")
    .select("chat_id, linked_at")
    .eq("user_id", req.user!.id)
    .maybeSingle();

  const { count: msgCount } = await supabaseAdmin
    .from("telegram_messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", req.user!.id)
    .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .eq("direction", "inbound");

  res.json({
    status: {
      linked: !!link,
      chat_id: link?.chat_id ?? null,
      linked_at: link?.linked_at ?? null,
      bot_active: !!env.TELEGRAM_BOT_TOKEN,
      messages_today: msgCount ?? 0,
      commands: [
        { command: "/review", description: "Trigger a code review" },
        { command: "/status", description: "Check project health" },
        { command: "/deploy", description: "Deploy latest build" },
        { command: "/report", description: "Get weekly summary" },
        { command: "/help", description: "Show available commands" },
      ],
    },
  });
});

r.post("/link", requireAuth, async (req, res) => {
  const { chat_id } = z.object({ chat_id: z.string().min(1) }).parse(req.body);
  await supabaseAdmin.from("telegram_links").upsert({
    user_id: req.user!.id, chat_id, linked_at: new Date().toISOString(),
  });
  res.json({ ok: true });
});

// Public webhook — secret token in header.
r.post("/webhook", async (req, res) => {
  const token = req.header("x-telegram-bot-api-secret-token");
  if (!token || token !== env.TELEGRAM_WEBHOOK_SECRET) {
    return res.status(401).send("Invalid token");
  }
  // TODO: enqueue telegram update processing
  res.json({ ok: true });
});

export default r;
