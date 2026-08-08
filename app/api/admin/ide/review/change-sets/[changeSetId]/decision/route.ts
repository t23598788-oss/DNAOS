/**
 * POST /api/admin/ide/review/change-sets/[changeSetId]/decision —
 * { action: "APPROVE"|"REQUEST_CHANGES"|"REJECT", reason } (owner,
 * 2026-08-06, Software Factory Step 7). Real, owner-only, real decision
 * gate: blocking findings and staleness both refuse APPROVE. Never
 * mutates Git state — "APPROVED" means only "passed review in this
 * system", never a commit/merge/push.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { recordDecision, ChangeSetError } from "../../../../_lib/changeSetRuntime";
import { startReviewJob, finalizeReviewJob } from "../../../../_lib/queueRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code === "CHANGE_SET_NOT_FOUND") return 404;
  if (code === "CHANGE_SET_NOT_OWNED") return 403;
  if (code === "CHANGE_SET_STALE" || code === "BLOCKING_FINDINGS_PRESENT" || code === "INVALID_DECISION") return 409;
  return 500;
}

export async function POST(req: Request, { params }: { params: Promise<{ changeSetId: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { changeSetId } = await params;

  let body: { action?: unknown; reason?: unknown };
  try {
    body = await req.json();
  } catch {
    return errorResponse("INVALID_DECISION", "invalid JSON body", 400);
  }
  const { action, reason } = body;
  if (action !== "APPROVE" && action !== "REQUEST_CHANGES" && action !== "REJECT") {
    return errorResponse("INVALID_DECISION", "action must be APPROVE, REQUEST_CHANGES, or REJECT", 400);
  }
  if (typeof reason !== "string" || reason.trim().length === 0) {
    return errorResponse("INVALID_DECISION", "reason is required — every review decision requires evidence", 400);
  }

  const job = startReviewJob("REVIEW_DECISION", auth.email, auth.id, changeSetId);
  try {
    const { changeSet, decision } = await recordDecision(changeSetId, auth.id, auth.email, action, reason, job.jobId);
    finalizeReviewJob(job.jobId, auth.id, { ok: true, result: `${action} by ${auth.email}`, error: null });
    return NextResponse.json({ ok: true, changeSet, decision });
  } catch (e) {
    const code = e instanceof ChangeSetError ? e.code : "INTERNAL_ERROR";
    finalizeReviewJob(job.jobId, auth.id, { ok: false, result: null, error: code });
    return errorResponse(code, e instanceof Error ? e.message : "unexpected error", statusFor(code));
  }
}
