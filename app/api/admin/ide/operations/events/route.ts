/**
 * GET /api/admin/ide/operations/events — real, bounded Monitoring +
 * Incident + Recovery event log (owner, 2026-08-08, Software Factory
 * Step 12). Same bounded event-log pattern as every prior Step.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { listMonitoringEvents } from "../../_lib/monitoringRuntime";
import { listIncidentEvents } from "../../_lib/incidentRuntime";
import { listRecoveryEvents } from "../../_lib/recoveryRuntime";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({
    ok: true,
    monitoringEvents: listMonitoringEvents(),
    incidentEvents: listIncidentEvents(),
    recoveryEvents: listRecoveryEvents(),
  });
}
