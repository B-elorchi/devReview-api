import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";

const r = Router();

// GET /search?q=&type=
r.get("/search", requireAuth, async (req, res) => {
  const q = req.query.q as string;
  const type = req.query.type as string;
  // Stub search
  res.json({ results: [] });
});

// GET /ready
r.get("/ready", async (req, res) => {
  // Stub readiness check
  res.json({ ready: true, db: "ok", redis: "ok" });
});

// GET /version
r.get("/version", async (req, res) => {
  res.json({ version: "0.1.0", sha: "unknown", buildTime: new Date().toISOString() });
});

export default r;
