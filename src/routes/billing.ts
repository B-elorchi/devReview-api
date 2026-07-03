import { Router, raw } from "express";
import Stripe from "stripe";
import { env } from "../config/env.js";
import { requireAuth, requireWorkspace } from "../middleware/auth.js";
import { supabaseAdmin } from "../config/supabase.js";

const r = Router();
const stripe = env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null;

const PLANS = [
  {
    id: "free",
    name: "Free",
    price: 0,
    currency: "USD",
    interval: "month",
    features: ["5 projects", "50 AI reviews/month", "Basic DevOps generation", "Community support"],
  },
  {
    id: "pro",
    name: "Pro",
    price: 15,
    currency: "USD",
    interval: "month",
    features: ["Unlimited projects", "1,000 AI reviews/month", "Advanced DevOps + K8s", "GitHub integration", "Priority support"],
  },
  {
    id: "team",
    name: "Team",
    price: 49,
    currency: "USD",
    interval: "month",
    features: ["Everything in Pro", "10 seats", "SSO / SAML", "Audit log", "SLA 99.9%", "Dedicated support"],
  },
];

// GET /billing/plans
r.get("/plans", async (_req, res) => {
  res.json({ plans: PLANS });
});

// GET /billing/subscription
r.get("/subscription", requireAuth, requireWorkspace, async (req, res) => {
  const { data: ws, error } = await supabaseAdmin
    .from("workspaces")
    .select("plan")
    .eq("id", req.workspaceId!)
    .single();
  if (error) throw error;
  const plan = PLANS.find((p) => p.id === (ws?.plan ?? "free")) ?? PLANS[0];
  res.json({ subscription: { plan, expires_at: null } });
});

// GET /billing/invoices
r.get("/invoices", requireAuth, requireWorkspace, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("billing_events")
    .select("id, type, payload, created_at")
    .eq("type", "invoice.payment_succeeded")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;

  const invoices = (data ?? []).map((row: any) => ({
    id: row.id,
    date: row.created_at,
    amount: row.payload?.data?.object?.amount_paid ?? 0,
    currency: row.payload?.data?.object?.currency ?? "usd",
    status: "paid",
    pdf: row.payload?.data?.object?.invoice_pdf ?? null,
  }));
  res.json({ invoices });
});

// GET /billing/usage
r.get("/usage", requireAuth, requireWorkspace, async (req, res) => {
  const wsId = (req as any).workspaceId as string;
  const since = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  // reviews join through projects; agent_sessions join through agents
  const [{ count: reviews }, { count: agents }] = await Promise.all([
    supabaseAdmin.from("reviews")
      .select("id, projects!inner(workspace_id)", { count: "exact", head: true })
      .eq("projects.workspace_id", wsId).gte("created_at", since),
    supabaseAdmin.from("agent_sessions")
      .select("id, agents!inner(workspace_id)", { count: "exact", head: true })
      .eq("agents.workspace_id", wsId).gte("started_at", since),
  ]);
  const devops = 0; // devops_generations table not yet in schema

  res.json({
    usage: {
      reviews: reviews ?? 0,
      devops_generations: devops,
      agent_runs: agents ?? 0,
      period_start: since,
    },
  });
});

// Stripe Checkout Session
r.post("/stripe/checkout", requireAuth, requireWorkspace, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: "Stripe not configured" });
  const { plan } = req.body;
  const workspaceId = req.workspaceId!;

  try {
    let priceId = "";
    if (plan === "pro") priceId = "price_pro_placeholder";
    else if (plan === "team") priceId = "price_team_placeholder";
    else return res.status(400).json({ error: "Invalid plan selected" });

    // Ensure we have a customer
    const { data: profile } = await supabaseAdmin.from("profiles")
      .select("stripe_customer_id").eq("id", req.user!.id).single();

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "subscription",
      customer: profile?.stripe_customer_id || undefined,
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: workspaceId,
      success_url: `${env.APP_URL}/pricing?success=true`,
      cancel_url: `${env.APP_URL}/pricing?canceled=true`,
    });

    res.json({ url: session.url });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Stripe Portal
r.get("/portal", requireAuth, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: "Stripe not configured" });
  const { data: profile } = await supabaseAdmin.from("profiles")
    .select("stripe_customer_id").eq("id", req.user!.id).single();
  if (!profile?.stripe_customer_id) return res.status(404).json({ error: "No customer" });
  
  const session = await stripe.billingPortal.sessions.create({
    customer: profile.stripe_customer_id,
    return_url: `${env.APP_URL}/pricing`,
  });
  res.json({ url: session.url });
});

// Stripe Webhook
r.post("/webhook", raw({ type: "*/*" }), async (req, res) => {
  if (!stripe) return res.status(503).end();
  const sig = req.header("stripe-signature");
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body as Buffer, sig!, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return res.status(400).send("Invalid signature");
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const workspaceId = session.client_reference_id;
    if (workspaceId) {
       await supabaseAdmin.from("workspaces").update({ plan: "pro" }).eq("id", workspaceId);
    }
  }

  await supabaseAdmin.from("billing_events").insert({ type: event.type, payload: event as never });
  res.json({ received: true });
});

// ---------------------------------------------------------
// PayPal Integration (Basic REST approach)
// ---------------------------------------------------------

async function getPayPalAccessToken() {
  const clientId = (process.env as any).PAYPAL_CLIENT_ID || "placeholder_client_id";
  const clientSecret = (process.env as any).PAYPAL_CLIENT_SECRET || "placeholder_secret";
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch("https://api-m.sandbox.paypal.com/v1/oauth2/token", {
    method: "POST",
    body: "grant_type=client_credentials",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
  });
  const data = await response.json();
  return data.access_token;
}

r.post("/paypal/create-order", requireAuth, requireWorkspace, async (req, res) => {
  const { plan } = req.body;
  try {
    const accessToken = await getPayPalAccessToken();
    const response = await fetch("https://api-m.sandbox.paypal.com/v2/checkout/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{ amount: { currency_code: "USD", value: plan === "pro" ? "15.00" : "49.00" } }],
      }),
    });
    const order = await response.json();
    res.json({ id: order.id });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

r.post("/paypal/capture-order", requireAuth, requireWorkspace, async (req, res) => {
  const { orderId, plan } = req.body;
  try {
    const accessToken = await getPayPalAccessToken();
    const response = await fetch(`https://api-m.sandbox.paypal.com/v2/checkout/orders/${orderId}/capture`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const captureData = await response.json();
    
    if (captureData.status === "COMPLETED") {
      await supabaseAdmin.from("workspaces").update({ plan: plan || "pro" }).eq("id", req.workspaceId!);
    }
    res.json(captureData);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default r;
