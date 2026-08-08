/**
 * GET /api/admin/ide/release/registry — real Release Stage Registry
 * (owner, 2026-08-07, Software Factory Step 10), auth-gated.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { listReleaseStages } from "../../_lib/releaseRegistry";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ ok: true, stages: listReleaseStages() });
}
