/**
 * GET /api/admin/ide/build/registry — real Build Type Registry (owner,
 * 2026-08-06, Software Factory Step 9), auth-gated.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { listBuildTypes } from "../../_lib/buildRegistry";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ ok: true, buildTypes: listBuildTypes() });
}
