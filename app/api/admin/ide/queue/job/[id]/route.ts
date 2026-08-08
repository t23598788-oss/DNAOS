/**
 * GET /api/admin/ide/queue/job/[id] — a single Job's current record, plus
 * its real event history (owner, 2026-08-06). Ownership enforced
 * server-side — a job belonging to a different identity returns
 * JOB_NOT_OWNED, never its data.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getJob, getJobEvents, QueueError } from "../../../_lib/queueRuntime";

function statusFor(code: QueueError["code"]): number {
  if (code === "JOB_NOT_FOUND") return 404;
  if (code === "JOB_NOT_OWNED") return 403;
  return 500;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  try {
    const job = getJob(id, auth.id);
    const events = getJobEvents(id, auth.id);
    return NextResponse.json({ ok: true, job, events });
  } catch (e) {
    if (e instanceof QueueError) {
      return NextResponse.json({ ok: false, code: e.code, message: e.message }, { status: statusFor(e.code) });
    }
    return NextResponse.json({ ok: false, code: "INTERNAL_ERROR", message: "unexpected error" }, { status: 500 });
  }
}
