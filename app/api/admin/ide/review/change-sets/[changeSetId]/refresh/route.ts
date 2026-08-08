/**
 * POST /api/admin/ide/review/change-sets/[changeSetId]/refresh — real
 * fingerprint recompute (owner, 2026-08-06, Software Factory Step 7).
 * Read-only against Source Control.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { refreshChangeSet, getChangeSet, ChangeSetError } from "../../../../_lib/changeSetRuntime";
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
    getChangeSet(changeSetId, auth.id); // real ownership check first
  } catch (e) {
    const code = e instanceof ChangeSetError ? e.code : "INTERNAL_ERROR";
    return errorResponse(code, e instanceof Error ? e.message : "unexpected error", statusFor(code));
  }
  const job = startReviewJob("CHANGE_SET_REFRESH", auth.email, auth.id, changeSetId);
  try {
    const changeSet = await refreshChangeSet(changeSetId, auth.id, auth.email, job.jobId);
    finalizeReviewJob(job.jobId, auth.id, { ok: true, result: `status ${changeSet.status}`, error: null });
    return NextResponse.json({ ok: true, changeSet });
  } catch (e) {
    const code = e instanceof ChangeSetError ? e.code : "INTERNAL_ERROR";
    finalizeReviewJob(job.jobId, auth.id, { ok: false, result: null, error: code });
    return errorResponse(code, e instanceof Error ? e.message : "unexpected error", statusFor(code));
  }
}
