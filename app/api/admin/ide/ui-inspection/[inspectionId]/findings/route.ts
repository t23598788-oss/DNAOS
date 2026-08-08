/**
 * GET /api/admin/ide/ui-inspection/[inspectionId]/findings — real, real
 * findings aggregated across every InspectionRecord this scan produced
 * (owner, 2026-08-06, Software Factory Step 6). Reuses the SAME Finding
 * contract the Inspection Pipeline already stores — never a second store.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getScanRecord } from "../../../_lib/browserInspectionRuntime";
import { getInspection } from "../../../_lib/inspectionRuntime";

export async function GET(_req: Request, { params }: { params: Promise<{ inspectionId: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { inspectionId: scanId } = await params;
  const scan = getScanRecord(scanId, auth.id);
  if (!scan) return NextResponse.json({ ok: false, code: "SCAN_NOT_FOUND", message: "no scan with that id" }, { status: 404 });
  const findings = scan.inspectionIds.flatMap((id) => {
    try { return getInspection(id, auth.id).findings; } catch { return []; }
  });
  return NextResponse.json({ ok: true, findings });
}
