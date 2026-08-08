/**
 * GET /api/admin/ide/test/runs/[testRunId] — real Test Run detail, owner-
 * scoped (owner, 2026-08-06, Software Factory Step 8).
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getTestRun, TestPipelineError } from "../../../_lib/testRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code === "TEST_RUN_NOT_FOUND") return 404;
  if (code === "TEST_RUN_NOT_OWNED") return 403;
  return 500;
}

export async function GET(_req: Request, { params }: { params: Promise<{ testRunId: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { testRunId } = await params;
  try {
    const testRun = getTestRun(testRunId, auth.id);
    return NextResponse.json({ ok: true, testRun });
  } catch (e) {
    const code = e instanceof TestPipelineError ? e.code : "INTERNAL_ERROR";
    return errorResponse(code, e instanceof Error ? e.message : "unexpected error", statusFor(code));
  }
}
