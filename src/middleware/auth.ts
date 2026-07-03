import type { Request, Response, NextFunction } from "express";
import { jwtVerify } from "jose";
import { env } from "../config/env.js";
import { supabaseForUser, supabaseAdmin } from "../config/supabase.js";
import type { SupabaseClient } from "@supabase/supabase-js";

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email?: string };
      supabase?: SupabaseClient;
      accessToken?: string;
      workspaceId?: string;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization") || req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing bearer token" });
  }
  const token = header.slice(7);
  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user) throw new Error("Invalid token");
    
    req.user = { id: data.user.id, email: data.user.email };
    req.accessToken = token;
    req.supabase = supabaseForUser(token);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

// Scope queries to a workspace the user belongs to.
export async function requireWorkspace(req: Request, res: Response, next: NextFunction) {
  const wsId = (req.header("x-workspace-id") || req.query.workspaceId) as string | undefined;
  if (!wsId) return res.status(400).json({ error: "x-workspace-id required" });
  const { data, error } = await supabaseAdmin
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("workspace_id", wsId)
    .eq("user_id", req.user!.id)
    .maybeSingle();
  if (error || !data) return res.status(403).json({ error: "Not a member of this workspace" });
  req.workspaceId = wsId;
  next();
}
