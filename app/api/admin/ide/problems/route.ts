/**
 * GET /api/admin/ide/problems — lists the real Problem Registry
 * (registry/problems.json): the problem each capability exists to solve,
 * not a feature list (owner, 2026-08-06). Data, not UI.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { listProblems } from "../_lib/problems";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  return NextResponse.json({ ok: true, problems: listProblems() });
}
