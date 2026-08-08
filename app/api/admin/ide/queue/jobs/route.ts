/**
 * GET /api/admin/ide/queue/jobs — lists this session's own real Jobs
 * (owner, 2026-08-06, Software Factory Step 3). Owner-only — never
 * another identity's jobs.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { listJobs } from "../../_lib/queueRuntime";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  return NextResponse.json({ ok: true, jobs: listJobs(auth.id) });
}
