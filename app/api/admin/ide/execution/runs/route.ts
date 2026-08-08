/**
 * GET /api/admin/ide/execution/runs — lists runs owned by the current auth
 * session only (owner, 2026-08-05, Phase 4). Never returns another
 * identity's runs — ownership comes from the server-side auth context.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { listRuns } from "../../_lib/executionRuntime";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const records = listRuns(auth.id);
  return NextResponse.json({ ok: true, runs: records });
}
