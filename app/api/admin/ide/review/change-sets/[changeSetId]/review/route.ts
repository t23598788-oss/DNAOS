/**
 * POST /api/admin/ide/review/change-sets/[changeSetId]/review — runs the
 * real Review Check Registry against a real Change Set (owner, 2026-08-06,
 * Software Factory Step 7). Read-only against Source Control and against
 * every source file — never auto-fixes, never mutates Git state.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { runReview, getChangeSet, ChangeSetError } from "../../../../_lib/changeSetRuntime";
import { startReviewJob, finalizeReviewJob } from "../../../../_lib/queueRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code === "CHANGE_SET_NOT_FOUND") return 404;
  if (code === "CHANGE_SET_NOT_OWNED") return 403;
  return 500;
}

export async function POST(_req: Request, { params }: { params: Promise<{ changeSetId: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { changeSetId } = await params;
  try {
    getChangeSet(changeSetId, auth.id);
  } catch (e) {
    const code = e instanceof ChangeSetError ? e.code : "INTERNAL_ERROR";
    return errorResponse(code, e instanceof Error ? e.message : "unexpected error", statusFor(code));
  }
  const job = startReviewJob("CODE_REVIEW", auth.email, auth.id, changeSetId);
  try {
    const cs = await runReview(changeSetId, auth.id, auth.email, job.jobId);
    finalizeReviewJob(job.jobId, auth.id, { ok: true, result: `${cs.findings.length} finding(s), risk ${cs.riskSummary.level}`, error: null });
    return NextResponse.json({ ok: true, changeSet: cs });
  } catch (e) {
    const code = e instanceof ChangeSetError ? e.code : "INTERNAL_ERROR";
    finalizeReviewJob(job.jobId, auth.id, { ok: false, result: null, error: code });
    return errorResponse(code, e instanceof Error ? e.message : "unexpected error", statusFor(code));
  }
}
