/**
 * GET /api/admin/ide/release/runs/[releaseRunId] — real Release Run
 * detail, owner-scoped (owner, 2026-08-07, Software Factory Step 10).
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getReleaseRun, ReleasePipelineError } from "../../../_lib/releaseRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_NOT_OWNED")) return 403;
  return 500;
}

export async function GET(_req: Request, { params }: { params: Promise<{ releaseRunId: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { releaseRunId } = await params;
  try {
    const run = getReleaseRun(releaseRunId, auth.id);
    return NextResponse.json({ ok: true, run });
  } catch (e) {
    const code = e instanceof ReleasePipelineError ? e.code : "INTERNAL_ERROR";
    return errorResponse(code, e instanceof Error ? e.message : "unexpected error", statusFor(code));
  }
}
