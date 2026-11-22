/**
 * GET /api/admin/ide/security/capabilities — real Restricted Capability
 * Registry listing (owner, 2026-08-08, Software Factory Step 13.25).
 * DISABLED_ROLE_TIER (real Owner tier) — never exposed to admin/employee
 * tiers, never a public route.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { DISABLED_ROLE_TIER } from "@/core/auth/session";
import { listRestrictedCapabilities } from "../../_lib/restrictedCapabilityRegistry";

export async function GET() {
  const auth = await requireAuth(DISABLED_ROLE_TIER);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ ok: true, capabilities: listRestrictedCapabilities() });
}
