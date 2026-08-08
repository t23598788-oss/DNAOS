/**
 * GET /api/admin/ide/operations/loop/runs — owner-scoped real Operations
 * Loop run list (owner, 2026-08-08, Software Factory Step 12.5).
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { listLoopRuns } from "../../../_lib/continuousOperationsRuntime";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ ok: true, runs: listLoopRuns(auth.id) });
}
