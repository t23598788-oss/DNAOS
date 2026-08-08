/**
 * GET /api/admin/ide/governance/factories — real Factory Governance join
 * (owner, 2026-08-06, Software Factory Step 4.5): every Factory's real
 * rules, coverage, missing rules, health, and unknown (uncited) files —
 * computed from registry/factory-registry.json + registry/factory-mapping.json
 * joined against the live Governance Runtime, never a second factory
 * registry.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { computeFactoryGovernance } from "../../_lib/governanceRuntime";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ ok: true, factories: computeFactoryGovernance() });
}
