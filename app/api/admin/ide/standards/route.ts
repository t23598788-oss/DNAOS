/**
 * GET /api/admin/ide/standards — lists the real External Standards Registry
 * (registry/standards.json) so any consumer (not just this IDE — AI,
 * Documentation, future Accessibility checks) can look up what a citation
 * id like "WCAG" or "DNA_Constitution" actually points to (owner,
 * 2026-08-05). Data, not UI — same principle as /admin/ide/classification.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { listStandards } from "../_lib/standards";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  return NextResponse.json({ ok: true, standards: listStandards() });
}
