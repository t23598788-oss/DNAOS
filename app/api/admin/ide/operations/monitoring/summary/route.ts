/**
 * GET /api/admin/ide/operations/monitoring/summary — real, live-computed
 * Monitoring Summary (owner, 2026-08-08, Software Factory Step 12).
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { computeMonitoringSummary } from "../../../_lib/monitoringRuntime";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ ok: true, summary: computeMonitoringSummary(auth.id) });
}
