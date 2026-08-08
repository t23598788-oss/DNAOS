/**
 * POST /api/admin/ide/queue/cancel/[id] — cancels a real QUEUED/RUNNING
 * Job (owner, 2026-08-06). If the job wraps a real execution (RUN_COMMAND/
 * TYPE_CHECK), the real underlying process is cancelled too via
 * executionRuntime.ts's cancelRun() — the exact same cancellation path the
 * Terminal panel's Cancel button already uses, never a second
 * reimplementation. Ownership enforced server-side.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { cancelJob, QueueError } from "../../../_lib/queueRuntime";

function statusFor(code: QueueError["code"]): number {
  if (code === "JOB_NOT_FOUND") return 404;
  if (code === "JOB_NOT_OWNED") return 403;
  return 500;
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  try {
    const job = cancelJob(id, auth.id);
    return NextResponse.json({ ok: true, job });
  } catch (e) {
    if (e instanceof QueueError) {
      return NextResponse.json({ ok: false, code: e.code, message: e.message }, { status: statusFor(e.code) });
    }
    return NextResponse.json({ ok: false, code: "INTERNAL_ERROR", message: "unexpected error" }, { status: 500 });
  }
}
