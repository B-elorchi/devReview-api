import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { requireAuth } from "../middleware/auth.js";
import { supabaseAdmin } from "../config/supabase.js";
import { runAgent, type AgentType } from "../agents/agentFactory.js";

const r = Router();

// ─── Telegram Bot API helper ──────────────────────────────────────────────────

async function tgSend(chatId: string | number, text: string, extra: Record<string, any> = {}) {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text.slice(0, 4096), // Telegram max
      parse_mode: "Markdown",
      ...extra,
    }),
  });
}

async function tgSendLong(chatId: string | number, text: string) {
  // Split long responses into ≤4096-char chunks at newlines
  const MAX = 4000;
  if (text.length <= MAX) { await tgSend(chatId, text); return; }
  const parts: string[] = [];
  let chunk = "";
  for (const line of text.split("\n")) {
    if ((chunk + "\n" + line).length > MAX) {
      parts.push(chunk);
      chunk = line;
    } else {
      chunk = chunk ? chunk + "\n" + line : line;
    }
  }
  if (chunk) parts.push(chunk);
  for (const part of parts) await tgSend(chatId, part);
}

// ─── Agent config ─────────────────────────────────────────────────────────────

const AGENT_COMMANDS: Record<string, { agentType: AgentType; label: string; emoji: string }> = {
  codereview:   { agentType: "code-review",  label: "Code Review",  emoji: "🔍" },
  review:       { agentType: "code-review",  label: "Code Review",  emoji: "🔍" },
  quality:      { agentType: "code-quality", label: "Code Quality", emoji: "⚡" },
  codequaliy:   { agentType: "code-quality", label: "Code Quality", emoji: "⚡" },
  security:     { agentType: "security",     label: "Security",     emoji: "🔒" },
  sec:          { agentType: "security",     label: "Security",     emoji: "🔒" },
  devops:       { agentType: "dev",          label: "DevOps",       emoji: "🚀" },
  dev:          { agentType: "dev",          label: "DevOps",       emoji: "🚀" },
  platform:     { agentType: "platform-assistant", label: "Platform Assistant", emoji: "🧠" },
};

const HELP_TEXT = `*DevReview AI Bot* 🤖

I'm your AI code assistant. Send me code and I'll analyse it.

*Agent Commands:*
/codereview — 🔍 Senior code review (bugs, anti-patterns, best practices)
/quality — ⚡ Code quality & architecture (SOLID, complexity, DRY)
/security — 🔒 Security scan (OWASP Top 10, vulnerabilities, CWEs)
/devops — 🚀 DevOps & infrastructure (Docker, CI/CD, Kubernetes, Terraform)
/platform — 🧠 Platform Assistant (Manage projects, trigger reviews, edit code)

*How to use:*
1. Send a slash command to set the active agent
2. Paste your code in the next message
3. Or combine: \`/security\\n<your code here>\`

*Examples:*
• /security → paste SQL query → get vulnerability report
• /codereview → paste function → get review with fixes
• /devops → paste Dockerfile → get best practice analysis

/help — Show this message`;

// ─── Per-chat conversation state (in-memory, resets on server restart) ────────

type ChatState = {
  agentType: AgentType;
  history: { role: "user" | "assistant"; content: string }[];
  lastActivity: number;
};
const chatStates = new Map<string, ChatState>();

function getState(chatId: string): ChatState {
  if (!chatStates.has(chatId)) {
    chatStates.set(chatId, { agentType: "code-review", history: [], lastActivity: Date.now() });
  }
  const s = chatStates.get(chatId)!;
  s.lastActivity = Date.now();
  // Keep history to last 10 exchanges
  if (s.history.length > 20) s.history = s.history.slice(-20);
  return s;
}

// Prune stale sessions every hour
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, s] of chatStates) {
    if (s.lastActivity < cutoff) chatStates.delete(id);
  }
}, 60 * 60 * 1000);

// ─── Process a Telegram update ────────────────────────────────────────────────

async function processUpdate(update: any) {
  const msg = update.message ?? update.edited_message;
  if (!msg?.text) return;

  const chatId  = String(msg.chat.id);
  const text    = msg.text.trim();
  const state   = getState(chatId);

  // /start
  if (text === "/start") {
    await tgSend(chatId, `Welcome to *DevReview AI* 👋\n\n${HELP_TEXT}`);
    return;
  }

  // /help
  if (text === "/help" || text === "/help@devreviewbot") {
    await tgSend(chatId, HELP_TEXT);
    return;
  }

  // slash command to switch agent (with optional inline message)
  const cmdMatch = text.match(/^\/([a-zA-Z]+)(?:@\w+)?(?:\s+([\s\S]*))?$/);
  if (cmdMatch) {
    const cmd = cmdMatch[1].toLowerCase();
    const rest = (cmdMatch[2] ?? "").trim();
    const agentCfg = AGENT_COMMANDS[cmd];

    if (agentCfg) {
      state.agentType = agentCfg.agentType;
      state.history   = []; // reset history on agent switch

      if (!rest) {
        await tgSend(chatId,
          `${agentCfg.emoji} *${agentCfg.label} Agent* activated.\n\nSend me your code or ask me anything. I'll use specialised tools to analyse it for you.`
        );
        return;
      }
      // Inline code after slash command — fall through with rest as the message
      await runAgentAndReply(chatId, state, rest);
      return;
    }

    // Unknown command
    await tgSend(chatId, `Unknown command. Send /help to see available commands.`);
    return;
  }

  // Plain message — run with current active agent
  await runAgentAndReply(chatId, state, text);
}

async function runAgentAndReply(chatId: string, state: ChatState, userText: string) {
  const agentCfg = Object.values(AGENT_COMMANDS).find(a => a.agentType === state.agentType)
    ?? { label: "Code Review", emoji: "🔍" };

  // Lookup user to log messages
  const { data: link } = await supabaseAdmin.from("telegram_links").select("user_id").eq("chat_id", chatId).maybeSingle();
  const userId = link?.user_id;

  if (userId) {
    await supabaseAdmin.from("telegram_messages").insert({ user_id: userId, chat_id: chatId, direction: "inbound", text: userText });
  }

  // Typing indicator
  if (env.TELEGRAM_BOT_TOKEN) {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" }),
    });
  }

  let response = "";
  try {
    response = await runAgent({
      agentType:   state.agentType,
      message:     userText,
      history:     state.history,
      userId:      userId,
      onChunk:     () => {}, // streaming not needed for Telegram — use return value
    });

    // Update history
    state.history.push({ role: "user", content: userText });
    state.history.push({ role: "assistant", content: response });
  } catch (err: any) {
    console.error("Telegram agent run failed", err);
    await tgSend(chatId, `❌ Agent error: ${err.message ?? "Something went wrong. Please try again."}`);
    return;
  }

  if (!response.trim()) {
    await tgSend(chatId, "⚠️ The agent returned an empty response. Please try rephrasing.");
    return;
  }

  await tgSendLong(chatId, response);
  
  if (userId) {
    await supabaseAdmin.from("telegram_messages").insert({ user_id: userId, chat_id: chatId, direction: "outbound", text: response });
  }
}

// ─── REST routes ──────────────────────────────────────────────────────────────

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
        { command: "/codereview", description: "🔍 Senior code review" },
        { command: "/quality",    description: "⚡ Code quality & architecture" },
        { command: "/security",   description: "🔒 Security vulnerability scan" },
        { command: "/devops",     description: "🚀 DevOps & infrastructure analysis" },
        { command: "/help",       description: "Show available commands" },
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

// Register webhook URL with Telegram — POST with { url: "https://your-public-url.com" }
r.post("/register-webhook", requireAuth, async (req, res) => {
  if (!env.TELEGRAM_BOT_TOKEN) return res.status(501).json({ error: "TELEGRAM_BOT_TOKEN not set" });
  const { url } = z.object({ url: z.string().url() }).parse(req.body);
  const webhookUrl = `${url}/integrations/telegram/webhook`;
  const resp = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: webhookUrl, secret_token: env.TELEGRAM_WEBHOOK_SECRET }),
  });
  const data = await resp.json();
  res.json({ webhookUrl, telegram: data });
});

// Check current webhook info
r.get("/webhook-info", requireAuth, async (_req, res) => {
  if (!env.TELEGRAM_BOT_TOKEN) return res.status(501).json({ error: "TELEGRAM_BOT_TOKEN not set" });
  const resp = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getWebhookInfo`);
  res.json(await resp.json());
});

// Register bot commands with Telegram (call once after deploy)
r.post("/setup-commands", requireAuth, async (_req, res) => {
  if (!env.TELEGRAM_BOT_TOKEN) return res.status(501).json({ error: "TELEGRAM_BOT_TOKEN not set" });
  const resp = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setMyCommands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      commands: [
        { command: "codereview", description: "🔍 Senior code review — bugs, anti-patterns, best practices" },
        { command: "quality",    description: "⚡ Code quality & architecture — SOLID, complexity, DRY" },
        { command: "security",   description: "🔒 Security scan — OWASP Top 10, vulnerabilities, CWEs" },
        { command: "devops",     description: "🚀 DevOps analysis — Docker, CI/CD, Kubernetes, Terraform" },
        { command: "platform",   description: "🧠 Platform Assistant — Manage projects, trigger reviews, edit code" },
        { command: "help",       description: "Show all available commands" },
      ],
    }),
  });
  const data = await resp.json();
  res.json(data);
});

// Public webhook — Telegram calls this for every new message
r.post("/webhook", async (req, res) => {
  const token = req.header("x-telegram-bot-api-secret-token");
  if (!token || token !== env.TELEGRAM_WEBHOOK_SECRET) {
    return res.status(401).send("Invalid token");
  }

  // Respond to Telegram immediately (must be < 5s) then process async
  res.json({ ok: true });

  processUpdate(req.body).catch((err) =>
    console.error("Telegram processUpdate error", err)
  );
});

r.get("/messages", requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin.from("telegram_messages")
    .select("*").eq("user_id", req.user!.id).order("created_at", { ascending: true }).limit(100);
  res.json({ messages: data || [] });
});

r.post("/messages", requireAuth, async (req, res) => {
  const { text } = z.object({ text: z.string().min(1) }).parse(req.body);
  const { data: link } = await supabaseAdmin.from("telegram_links")
    .select("chat_id").eq("user_id", req.user!.id).maybeSingle();
  if (!link) return res.status(400).json({ error: "Not linked" });

  await tgSend(link.chat_id, text);
  const { data: msg } = await supabaseAdmin.from("telegram_messages").insert({
    user_id: req.user!.id, chat_id: link.chat_id, direction: "outbound", text
  }).select().single();
  res.json({ message: msg });
});

r.get("/preferences", requireAuth, async (req, res) => {
  const { data } = await supabaseAdmin.from("notification_preferences").select("*").eq("user_id", req.user!.id).maybeSingle();
  res.json({ preferences: data || {} });
});

r.put("/preferences", requireAuth, async (req, res) => {
  await supabaseAdmin.from("notification_preferences").upsert({ user_id: req.user!.id, ...req.body });
  res.json({ ok: true });
});

export default r;
