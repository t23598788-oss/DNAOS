/**
 * GET /api/admin/workspace/ai-agents — AI Agents tool's real data source
 * (Integrated Development Workspace shell, owner, 2026-08-05). Combines:
 *   - registry/AI_REGISTRY.json / AI_SESSIONS.json — static agent roster
 *   - dev_loop_sessions (Supabase) — real local watcher sessions
 *   - Integration Gateway channel state (engines/integration-gateway/policy/gate.ts)
 *
 * "แก้ไขโค้ดตาม Permission" (control/execute an agent from this UI) is
 * honestly NOT_IMPLEMENTED — the Integration Gateway's Execution Channel is
 * deliberately closed (channelIsEnabled("execute") === false) until
 * Proposal is proven across GitHub/Supabase/Vercel first (owner directive,
 * 2026-08-05). This route reports that real reason, never a fabricated
 * "success".
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { supabaseAdmin } from "@/services/supabase/queries";
import { channelIsEnabled } from "@/engines/integration-gateway/policy/gate";
import aiRegistry from "@/registry/AI_REGISTRY.json";
import aiSessions from "@/registry/AI_SESSIONS.json";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const db = supabaseAdmin();
  const { data: devLoopSessions } = await db
    .from("dev_loop_sessions")
    .select("id, owner, goal, status, started_at, closed_at")
    .order("started_at", { ascending: false })
    .limit(20);

  return NextResponse.json({
    registered_agents: aiRegistry.agents,
    static_sessions: aiSessions.sessions,
    dev_loop_sessions: devLoopSessions ?? [],
    execute_capability: {
      status: "NOT_IMPLEMENTED",
      reason: "Integration Gateway Execution Channel is closed (engines/integration-gateway/policy/gate.ts channelIsEnabled('execute') === false) — Proposal Channel must be proven across GitHub/Supabase/Vercel Observe first",
      observe_channel_enabled: channelIsEnabled("observe"),
      propose_channel_enabled: channelIsEnabled("propose"),
      execute_channel_enabled: channelIsEnabled("execute"),
    },
  });
}
