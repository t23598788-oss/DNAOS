/**
 * GET /api/admin/ide/inspection/list — owner-scoped real Inspection Record
 * list (owner, 2026-08-06, Software Factory Step 4). No mock data — only
 * records that were actually created by createInspection().
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { listInspections, isFindingStale } from "../../_lib/inspectionRuntime";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const records = listInspections(auth.id);
  const withStale = await Promise.all(records.map(async (r) => ({ ...r, stale: await isFindingStale(r) })));
  return NextResponse.json({ ok: true, inspections: withStale });
}
