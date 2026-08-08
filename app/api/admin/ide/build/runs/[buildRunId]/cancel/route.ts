/**
 * POST /api/admin/ide/build/runs/[buildRunId]/cancel — real cancel of an
 * in-flight Build Run's real underlying process via the Execution Runtime
 * (owner, 2026-08-06, Software Factory Step 9). Waits for the real process
 * to actually exit before the Build Run finalizes — never force-marks
 * CANCELLED ahead of the real terminal event.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { cancelBuildRun, BuildPipelineError } from "../../../../_lib/buildRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_NOT_OWNED")) return 403;
  return 500;
}

export async function POST(_req: Request, { params }: { params: Promise<{ buildRunId: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { buildRunId } = await params;
  try {
    const run = cancelBuildRun(buildRunId, auth.id, auth.email);
    return NextResponse.json({ ok: true, run });
  } catch (e) {
    const code = e instanceof BuildPipelineError ? e.code : "INTERNAL_ERROR";
    return errorResponse(code, e instanceof Error ? e.message : "unexpected error", statusFor(code));
  }
}
