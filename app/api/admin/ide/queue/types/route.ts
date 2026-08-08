/**
 * GET /api/admin/ide/queue/types — lists the real Job Type Registry
 * (owner, 2026-08-06) — which job types exist and whether each is actually
 * implemented yet (BUILD/TEST/CUSTOM are registered but not runnable this
 * phase). Data, not UI — same principle as /admin/ide/classification.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { listJobTypes } from "../../_lib/queueRegistry";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  return NextResponse.json({ ok: true, types: listJobTypes() });
}
