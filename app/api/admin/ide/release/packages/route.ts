/**
 * GET /api/admin/ide/release/packages — real, standalone Capability
 * Packaging preview (owner, 2026-08-07, Software Factory Step 10),
 * auth-gated. Built ONLY from registry/capability-registry.json's real,
 * frozen capabilities — never a fabricated or duplicated capability.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { packageCapabilities, checkPackageIntegrity } from "../../_lib/releaseRuntime";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const packages = packageCapabilities();
  const integrity = checkPackageIntegrity(packages);
  return NextResponse.json({ ok: true, packages, integrity });
}
