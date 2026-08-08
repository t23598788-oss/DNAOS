/**
 * GET /api/admin/ide/build/runs/[buildRunId]/evidence — real, aggregated
 * Evidence Warehouse entries across every real Artifact this Build Run
 * produced (owner, 2026-08-06, Software Factory Step 9), owner-only.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getBuildRun, BuildPipelineError } from "../../../../_lib/buildRuntime";
import { getEvidence } from "../../../../_lib/artifactRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_NOT_OWNED")) return 403;
  return 500;
}

export async function GET(_req: Request, { params }: { params: Promise<{ buildRunId: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { buildRunId } = await params;
  try {
    const run = getBuildRun(buildRunId, auth.id);
    const evidence = run.artifactIds.flatMap((id) => { try { return getEvidence(id, auth.id); } catch { return []; } });
    return NextResponse.json({ ok: true, evidence });
  } catch (e) {
    const code = e instanceof BuildPipelineError ? e.code : "INTERNAL_ERROR";
    return errorResponse(code, e instanceof Error ? e.message : "unexpected error", statusFor(code));
  }
}
