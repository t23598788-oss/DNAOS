/**
 * GET /api/admin/ide/security/defense — real, read-only Defense summary
 * (owner, 2026-08-08, Software Factory Step 13.25, Section 7). Reuses
 * the real Monitoring/Incident/Recovery/Alert Runtimes (Step 12/12.5) —
 * never a second detection engine. SUPER_ADMIN_ONLY (real Owner tier).
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { SUPER_ADMIN_ONLY } from "@/core/auth/session";
import { computeDefenseSummary } from "../../_lib/securityDefenseRuntime";

export async function GET() {
  const auth = await requireAuth(SUPER_ADMIN_ONLY);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ ok: true, summary: computeDefenseSummary(auth.id) });
}
