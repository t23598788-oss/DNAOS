/**
 * POST /api/admin/ide/queue/clear — clears this owner's own FINISHED jobs
 * from the live Queue view (owner, 2026-08-06). Never touches a real file,
 * never affects another identity's jobs, never deletes the underlying
 * Execution Runtime's own run history (executionRuntime.ts's runs are a
 * separate store — only this Job wrapper record is dropped).
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { clearFinishedJobs } from "../../_lib/queueRuntime";

export async function POST() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const cleared = clearFinishedJobs(auth.id);
  return NextResponse.json({ ok: true, cleared });
}
