/**
 * POST /api/admin/ide/ui-inspection/[inspectionId]/cancel — real cancel
 * (owner, 2026-08-06, Software Factory Step 6). [inspectionId] is the
 * scanId; cancelling closes the real Playwright browser session (and
 * every real child Chromium process it owns) BEFORE the Job/Inspection
 * Records finalize — never force-finalized ahead of the real session
 * actually closing.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { cancelUiInspectionScan } from "../../../_lib/browserInspectionRuntime";

export async function POST(_req: Request, { params }: { params: Promise<{ inspectionId: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { inspectionId: scanId } = await params;
  const cancelled = cancelUiInspectionScan(scanId, auth.id);
  if (!cancelled) return NextResponse.json({ ok: false, code: "SCAN_NOT_FOUND", message: "no active scan with that id for this owner" }, { status: 404 });
  return NextResponse.json({ ok: true, cancelled: true });
}
