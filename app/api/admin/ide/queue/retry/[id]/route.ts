/**
 * POST /api/admin/ide/queue/retry/[id] — creates a real NEW Job that
 * re-runs a FAILED/CANCELLED/REJECTED job's same command (owner,
 * 2026-08-06). Never resumes or mutates the original job record — retry
 * is a fresh real execution via the same Execution Runtime path
 * RUN_COMMAND jobs already use. Ownership enforced server-side.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { retryJob, QueueError } from "../../../_lib/queueRuntime";

function statusFor(code: QueueError["code"]): number {
  if (code === "JOB_NOT_FOUND") return 404;
  if (code === "JOB_NOT_OWNED") return 403;
  if (code === "JOB_NOT_RETRYABLE") return 409;
  return 500;
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  try {
    const job = retryJob(id, auth.id, auth.email);
    return NextResponse.json({ ok: true, job });
  } catch (e) {
    if (e instanceof QueueError) {
      return NextResponse.json({ ok: false, code: e.code, message: e.message }, { status: statusFor(e.code) });
    }
    return NextResponse.json({ ok: false, code: "INTERNAL_ERROR", message: "unexpected error" }, { status: 500 });
  }
}
