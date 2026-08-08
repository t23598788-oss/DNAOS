/**
 * GET /api/admin/ide/operations/status — real, top-level Operations
 * aggregate: Monitoring summary + Incidents + Recovery Plans (owner,
 * 2026-08-08, Software Factory Step 12). Every field sourced from a
 * real, already-existing Runtime — never a fabricated rollup.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { computeMonitoringSummary, listSignals } from "../../_lib/monitoringRuntime";
import { listIncidents } from "../../_lib/incidentRuntime";
import { listRecoveryPlans } from "../../_lib/recoveryRuntime";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const monitoring = computeMonitoringSummary(auth.id);
  const signals = listSignals(auth.id);
  const incidents = listIncidents(auth.id);
  const recoveryPlans = listRecoveryPlans(auth.id);

  const openIncidents = incidents.filter((i) => !["RESOLVED", "FALSE_POSITIVE"].includes(i.status));
  const criticalIncidents = openIncidents.filter((i) => i.severity === "CRITICAL" || i.severity === "HIGH");
  const blockedRecovery = recoveryPlans.filter((p) => p.executionStatus === "BLOCKED");
  const unverifiedRecovery = recoveryPlans.filter((p) => p.verification && p.verification.status !== "VERIFIED");
  const staleOrMissing = signals.filter((s) => s.status === "STALE" || s.status === "MISSING");
  const ownerDecisionsRequired = [
    ...openIncidents.filter((i) => i.ownerDecisionRequired).map((i) => ({ kind: "incident", id: i.incidentId, reason: `${i.type} (${i.severity})` })),
    ...recoveryPlans.filter((p) => p.approvalStatus === "PENDING" && p.executionStatus !== "BLOCKED").map((p) => ({ kind: "recovery_plan", id: p.recoveryPlanId, reason: `${p.recoveryType} awaiting approval` })),
  ];

  return NextResponse.json({
    ok: true,
    status: {
      generatedAt: new Date().toISOString(),
      monitoring,
      incidents: { total: incidents.length, open: openIncidents.length, critical: criticalIncidents.length },
      recovery: { total: recoveryPlans.length, blocked: blockedRecovery.length, unverified: unverifiedRecovery.length },
      staleOrMissingSignals: staleOrMissing.length,
      ownerDecisionsRequired,
    },
  });
}
