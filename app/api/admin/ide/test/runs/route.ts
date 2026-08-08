/**
 * POST /api/admin/ide/test/runs — real Test Run creation, running every
 * real IMPLEMENTED Test Type from testRegistry.ts against the current
 * working tree (owner, 2026-08-06, Software Factory Step 8, Test
 * Pipeline). Never Build, never Git Write, never auto-fixes, never edits
 * source.
 * GET /api/admin/ide/test/runs — owner-scoped real Test Run list.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { createTestRun, listTestRuns, TestPipelineError } from "../../_lib/testRuntime";
import { startTestJob, finalizeTestJob } from "../../_lib/queueRuntime";
import { ChangeSetError } from "../../_lib/changeSetRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code === "TEST_RUN_NOT_FOUND" || code === "CHANGE_SET_NOT_FOUND") return 404;
  if (code === "TEST_RUN_NOT_OWNED" || code === "CHANGE_SET_NOT_OWNED") return 403;
  return 500;
}

export async function POST(req: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  let body: { sourceChangeSet?: unknown; reviewId?: unknown; queueJobId?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const sourceChangeSet = typeof body.sourceChangeSet === "string" ? body.sourceChangeSet : null;
  const reviewId = typeof body.reviewId === "string" ? body.reviewId : null;
  const queueJobId = typeof body.queueJobId === "string" ? body.queueJobId : null;

  const job = startTestJob("RUN_TEST", auth.email, auth.id, sourceChangeSet ?? "working tree");
  try {
    const testRun = await createTestRun(auth.email, auth.id, { sourceChangeSet, reviewId, queueJobId }, job.jobId);
    finalizeTestJob(job.jobId, auth.id, { ok: true, result: `${testRun.passed}/${testRun.totals.total} passed, status ${testRun.status}`, error: null });
    return NextResponse.json({ ok: true, testRun, jobId: job.jobId });
  } catch (e) {
    const code = e instanceof TestPipelineError ? e.code : e instanceof ChangeSetError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof Error ? e.message : "unexpected error";
    finalizeTestJob(job.jobId, auth.id, { ok: false, result: null, error: code });
    return errorResponse(code, message, statusFor(code));
  }
}

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ ok: true, testRuns: listTestRuns(auth.id) });
}
