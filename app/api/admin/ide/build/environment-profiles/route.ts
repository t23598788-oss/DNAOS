/**
 * GET /api/admin/ide/build/environment-profiles — real Environment
 * Profile Registry (owner, 2026-08-06, Software Factory Step 9),
 * auth-gated. Never returns a real secret value — profiles carry only
 * key names and policy metadata.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { listEnvironmentProfiles } from "../../_lib/buildRegistry";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ ok: true, environmentProfiles: listEnvironmentProfiles() });
}
