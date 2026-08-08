/**
 * POST /api/admin/ide/operations/loop/run — real, manual-trigger
 * Operations Loop run (owner, 2026-08-08, Software Factory Step 12.5).
 * Never a real scheduled/continuous claim — this is the MANUAL_TRIGGER_ONLY
 * path; the real Vercel Cron adapter is /api/cron/operations-loop.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { runOperationsLoop } from "../../../_lib/continuousOperationsRuntime";

export async function POST() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const run = await runOperationsLoop(auth.id, auth.email, "MANUAL");
  return NextResponse.json({ ok: true, run });
}
