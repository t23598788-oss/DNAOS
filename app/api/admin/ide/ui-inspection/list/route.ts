/**
 * GET /api/admin/ide/ui-inspection/list — owner-scoped real UI Inspection
 * scan list (owner, 2026-08-06, Software Factory Step 6).
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { listScanRecords } from "../../_lib/browserInspectionRuntime";
import { getInspection } from "../../_lib/inspectionRuntime";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const scans = listScanRecords(auth.id).map((scan) => {
    const records = scan.inspectionIds.map((id) => {
      try { return getInspection(id, auth.id); } catch { return null; }
    }).filter((r): r is NonNullable<typeof r> => !!r);
    const findingCount = records.reduce((sum, r) => sum + r.findingCount, 0);
    const errorCount = records.reduce((sum, r) => sum + r.errorCount, 0);
    const warningCount = records.reduce((sum, r) => sum + r.warningCount, 0);
    const status = errorCount > 0 ? "FAILED" : warningCount > 0 ? "WARNING" : "PASSED";
    return { ...scan, findingCount, errorCount, warningCount, status };
  });
  return NextResponse.json({ ok: true, scans });
}
