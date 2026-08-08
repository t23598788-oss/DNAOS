/**
 * GET /api/admin/ide/ui-inspection/[inspectionId] — real scan detail.
 * [inspectionId] is the scanId (one scan produces multiple real
 * InspectionRecords, one per requested UI inspection type, sharing one
 * browser session) — owner, 2026-08-06, Software Factory Step 6.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getScanRecord } from "../../_lib/browserInspectionRuntime";
import { getInspection } from "../../_lib/inspectionRuntime";

export async function GET(_req: Request, { params }: { params: Promise<{ inspectionId: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { inspectionId: scanId } = await params;
  const scan = getScanRecord(scanId, auth.id);
  if (!scan) return NextResponse.json({ ok: false, code: "SCAN_NOT_FOUND", message: "no scan with that id" }, { status: 404 });
  const records = scan.inspectionIds.map((id) => {
    try { return getInspection(id, auth.id); } catch { return null; }
  }).filter((r): r is NonNullable<typeof r> => !!r);
  return NextResponse.json({ ok: true, scan, inspections: records });
}
