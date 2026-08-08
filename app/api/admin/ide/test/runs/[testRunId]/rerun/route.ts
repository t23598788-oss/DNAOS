/**
 * POST /api/admin/ide/test/runs/[testRunId]/rerun — re-executes a real
 * prior Test Run's real cross-references against the CURRENT working tree,
 * creating a brand new Test Run (owner, 2026-08-06, Software Factory
 * Step 8). Never mutates the original Test Run.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { rerunTestRun, TestPipelineError } from "../../../../_lib/testRuntime";
import { startTestJob, finalizeTestJob } from "../../../../_lib/queueRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code === "TEST_RUN_NOT_FOUND") return 404;
  if (code === "TEST_RUN_NOT_OWNED") return 403;
  return 500;
}

export async function POST(_req: Request, { params }: { params: Promise<{ testRunId: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { testRunId } = await params;
  const job = startTestJob("RERUN_TEST", auth.email, auth.id, testRunId);
  try {
    const testRun = await rerunTestRun(testRunId, auth.id, auth.email, job.jobId);
    finalizeTestJob(job.jobId, auth.id, { ok: true, result: `${testRun.passed}/${testRun.totals.total} passed, status ${testRun.status}`, error: null });
    return NextResponse.json({ ok: true, testRun, jobId: job.jobId });
  } catch (e) {
    const code = e instanceof TestPipelineError ? e.code : "INTERNAL_ERROR";
    finalizeTestJob(job.jobId, auth.id, { ok: false, result: null, error: code });
    return errorResponse(code, e instanceof Error ? e.message : "unexpected error", statusFor(code));
  }
}
