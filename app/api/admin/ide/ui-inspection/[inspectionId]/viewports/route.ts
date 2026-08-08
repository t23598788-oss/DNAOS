/**
 * GET /api/admin/ide/ui-inspection/[inspectionId]/viewports — real
 * viewport profiles this scan actually ran (owner, 2026-08-06, Software
 * Factory Step 6), resolved against the real Viewport Profile Registry.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getScanRecord } from "../../../_lib/browserInspectionRuntime";
import { getViewportProfile } from "../../../_lib/viewportRegistry";

export async function GET(_req: Request, { params }: { params: Promise<{ inspectionId: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { inspectionId: scanId } = await params;
  const scan = getScanRecord(scanId, auth.id);
  if (!scan) return NextResponse.json({ ok: false, code: "SCAN_NOT_FOUND", message: "no scan with that id" }, { status: 404 });
  const viewports = scan.viewportsRun.map((id) => getViewportProfile(id)).filter((v): v is NonNullable<typeof v> => !!v);
  return NextResponse.json({ ok: true, viewports });
}
