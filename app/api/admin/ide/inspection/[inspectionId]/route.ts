/**
 * GET /api/admin/ide/inspection/[inspectionId] — real Inspection Record +
 * events detail, owner-only (owner, 2026-08-06, Software Factory Step 4).
 * Includes a real `stale` flag: true when the target file's CURRENT sha256
 * differs from the hash recorded at inspection time — never shown as a
 * current result once the file has actually changed.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getInspection, getInspectionEvents, isFindingStale, InspectionError } from "../../_lib/inspectionRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code === "INSPECTION_NOT_FOUND") return 404;
  if (code === "INSPECTION_NOT_OWNED") return 403;
  return 500;
}

export async function GET(_req: Request, { params }: { params: Promise<{ inspectionId: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { inspectionId } = await params;
  try {
    const record = getInspection(inspectionId, auth.id);
    const events = getInspectionEvents(inspectionId, auth.id);
    const stale = await isFindingStale(record);
    return NextResponse.json({ ok: true, inspection: { ...record, stale }, events });
  } catch (e) {
    const code = e instanceof InspectionError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof Error ? e.message : "unexpected error";
    return errorResponse(code, message, statusFor(code));
  }
}
