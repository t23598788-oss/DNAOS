/**
 * POST /api/admin/ide/review/change-sets — real Change Set creation from
 * the real working tree (owner, 2026-08-06, Software Factory Step 7,
 * Code Review Pipeline). Read-only against Source Control — never stages,
 * commits, or otherwise mutates Git state.
 * GET /api/admin/ide/review/change-sets — owner-scoped real Change Set
 * list.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { createChangeSet, listChangeSets, ChangeSetError } from "../../_lib/changeSetRuntime";
import { startReviewJob, finalizeReviewJob } from "../../_lib/queueRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code === "CHANGE_SET_NOT_FOUND") return 404;
  if (code === "CHANGE_SET_NOT_OWNED") return 403;
  if (code === "GIT_ERROR") return 500;
  return 500;
}

export async function POST(req: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  let body: { title?: unknown; description?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const title = typeof body.title === "string" ? body.title : null;
  const description = typeof body.description === "string" ? body.description : null;

  const job = startReviewJob("CHANGE_SET_CREATE", auth.email, auth.id, title ?? "working tree");
  try {
    const changeSet = await createChangeSet(auth.email, auth.id, title, description, job.jobId);
    finalizeReviewJob(job.jobId, auth.id, { ok: true, result: `${changeSet.changedFiles.length} real changed file(s)`, error: null });
    return NextResponse.json({ ok: true, changeSet, jobId: job.jobId });
  } catch (e) {
    const code = e instanceof ChangeSetError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof Error ? e.message : "unexpected error";
    finalizeReviewJob(job.jobId, auth.id, { ok: false, result: null, error: code });
    return errorResponse(code, message, statusFor(code));
  }
}

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ ok: true, changeSets: listChangeSets(auth.id) });
}
