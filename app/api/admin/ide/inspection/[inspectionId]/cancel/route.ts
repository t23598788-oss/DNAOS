/**
 * POST /api/admin/ide/inspection/[inspectionId]/cancel — owner-only
 * (owner, 2026-08-06, Software Factory Step 4). Only meaningful for
 * TYPE_DIAGNOSTIC (the one inspection type backed by a real spawned
 * process via the Execution Runtime) — sends the SAME real cancelRun()
 * signal Step 2/3 already use and lets that run's own terminal event
 * finalize the InspectionRecord; never force-finalizes ahead of the real
 * process actually exiting.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { cancelInspection, InspectionError } from "../../../_lib/inspectionRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code === "INSPECTION_NOT_FOUND") return 404;
  if (code === "INSPECTION_NOT_OWNED") return 403;
  return 500;
}

export async function POST(_req: Request, { params }: { params: Promise<{ inspectionId: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { inspectionId } = await params;
  try {
    const record = cancelInspection(inspectionId, auth.id);
    return NextResponse.json({ ok: true, inspection: record });
  } catch (e) {
    const code = e instanceof InspectionError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof Error ? e.message : "unexpected error";
    return errorResponse(code, message, statusFor(code));
  }
}
