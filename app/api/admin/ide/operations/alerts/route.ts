/**
 * GET /api/admin/ide/operations/alerts — owner-scoped real Alert list
 * (owner, 2026-08-08, Software Factory Step 12.5).
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { listAlerts } from "../../_lib/alertRuntime";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ ok: true, alerts: listAlerts(auth.id) });
}
