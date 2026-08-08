/**
 * GET /api/admin/ide/governance/events — real Governance Runtime events
 * (RULE_VERIFIED/RULE_FAILED/RULE_DECLARED/RULE_UNKNOWN/RULE_GHOST/
 * RULE_DEPRECATED), owner, 2026-08-06, Software Factory Step 4.5. Only
 * populated after a real POST /verify run — never fabricated.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { listGovernanceEvents } from "../../_lib/governanceRuntime";

export async function GET(req: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const url = new URL(req.url);
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.min(2000, Math.max(1, parseInt(limitParam, 10) || 200)) : 200;
  return NextResponse.json({ ok: true, events: listGovernanceEvents(limit) });
}
