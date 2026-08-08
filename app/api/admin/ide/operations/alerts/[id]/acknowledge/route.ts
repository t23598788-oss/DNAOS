/**
 * POST /api/admin/ide/operations/alerts/[id]/acknowledge — real,
 * owner-driven Alert acknowledgement (owner, 2026-08-08, Software
 * Factory Step 12.5).
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { acknowledgeAlert, AlertError } from "../../../../_lib/alertRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_NOT_OWNED")) return 403;
  if (code === "INVALID_REQUEST") return 400;
  return 500;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  let body: { note?: unknown };
  try { body = await req.json(); } catch { return errorResponse("INVALID_REQUEST", "invalid JSON body", 400); }
  if (typeof body.note !== "string" || body.note.trim().length === 0) return errorResponse("INVALID_REQUEST", "a real note is required to acknowledge an Alert", 400);

  try {
    const alert = acknowledgeAlert(id, auth.id, auth.email, body.note);
    return NextResponse.json({ ok: true, alert });
  } catch (e) {
    const code = e instanceof AlertError ? e.code : "INTERNAL_ERROR";
    return errorResponse(code, e instanceof Error ? e.message : "unexpected error", statusFor(code));
  }
}
