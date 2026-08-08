/**
 * GET /api/admin/ide/operations/readiness — real, live-computed
 * Operations Readiness Report — Monitoring/Incident/Recovery/Backup/
 * Alerting gates (owner, 2026-08-08, Software Factory Step 12.5). Every
 * field sourced from a real, already-existing Runtime — never inferred
 * by AI.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { computeCompletionGates } from "../../_lib/factoryCompletionRuntime";
import { computeGlobalFactoryReport } from "../../_lib/globalFactoryRuntime";
import { getSchedulerContractStatus } from "../../_lib/continuousOperationsRegistry";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const gates = computeCompletionGates();
  const global = computeGlobalFactoryReport();
  const relevantGates = gates.filter((g) => ["MONITORING_READY", "INCIDENT_RECOVERY_READY", "BACKUP_READY", "DEPLOYMENT_READY", "VS_CODE_EXIT_READY"].includes(g.id));

  return NextResponse.json({
    ok: true,
    readiness: {
      generatedAt: new Date().toISOString(),
      gates: relevantGates,
      domains: global.domains.filter((d) => ["Monitoring", "Incident", "Recovery", "Backup", "Alerting", "Deployment"].includes(d.domain)),
      schedulerContract: getSchedulerContractStatus(),
    },
  });
}
