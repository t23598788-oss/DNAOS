/**
 * GET /api/admin/ide/factory-readiness — real, live Factory Readiness
 * Gate verdict (owner, 2026-08-07, Software Factory Foundation
 * full-pipeline audit). ADMIN_TIER. Pass `?record=1` to also write a
 * real FACTORY_READINESS_REPORT evidence artifact and a real Execution
 * Context checkpoint capturing this verdict — never automatic on every
 * plain GET (evidence-writing is a deliberate action, not a side effect
 * of a read).
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { computeFactoryReadinessReport, recordFactoryReadinessEvidence } from "../_lib/factoryReadinessGateRuntime";
import { writeExecutionContextCheckpoint, getCurrentExecutionContext } from "../_lib/executionContextRuntime";

export async function GET(req: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { searchParams } = new URL(req.url);

  if (searchParams.get("record") === "1") {
    const { report, artifactId } = await recordFactoryReadinessEvidence(auth.email, auth.id);
    const prev = getCurrentExecutionContext();
    const checkpoint = await writeExecutionContextCheckpoint(
      {
        evidence_refs: [...(prev?.evidence_refs ?? []), `FACTORY_READINESS_REPORT:${artifactId}`],
        unresolved_findings: report.reasons,
      },
      auth.email, auth.id,
      `Factory Readiness Gate recorded: ${report.overall}`,
    );
    return NextResponse.json({ ok: true, report, artifactId, checkpointId: checkpoint.checkpointId });
  }

  const report = await computeFactoryReadinessReport();
  return NextResponse.json({ ok: true, report });
}
