/**
 * POST /api/admin/ide/operations/recovery/plans/[planId]/approve — real,
 * deterministic Recovery Approval decision (owner, 2026-08-08, Software
 * Factory Step 12). Approval alone NEVER executes a real mutation.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { approveRecoveryPlan, RecoveryError } from "../../../../../_lib/recoveryRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_NOT_OWNED")) return 403;
  if (code === "INVALID_REQUEST") return 400;
  return 500;
}

export async function POST(req: Request, { params }: { params: Promise<{ planId: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { planId } = await params;
  let body: { approved?: unknown; reason?: unknown };
  try { body = await req.json(); } catch { return errorResponse("INVALID_REQUEST", "invalid JSON body", 400); }
  if (typeof body.approved !== "boolean") return errorResponse("INVALID_REQUEST", "approved (boolean) is required", 400);
  if (typeof body.reason !== "string" || body.reason.trim().length === 0) return errorResponse("INVALID_REQUEST", "a real reason is required for every approval decision", 400);

  try {
    const plan = approveRecoveryPlan(planId, auth.id, auth.email, body.approved, body.reason);
    return NextResponse.json({ ok: true, plan });
  } catch (e) {
    const code = e instanceof RecoveryError ? e.code : "INTERNAL_ERROR";
    return errorResponse(code, e instanceof Error ? e.message : "unexpected error", statusFor(code));
  }
}
