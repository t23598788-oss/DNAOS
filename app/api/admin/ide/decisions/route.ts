/**
 * GET /api/admin/ide/decisions — lists the real Decision Registry
 * (registry/decisions.json): why this system was built the way it is, not
 * just what it is (owner, 2026-08-06). Data, not UI.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { listDecisions } from "../_lib/decisions";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  return NextResponse.json({ ok: true, decisions: listDecisions() });
}
