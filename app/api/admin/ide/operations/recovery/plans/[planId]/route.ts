/**
 * GET /api/admin/ide/operations/recovery/plans/[planId] — real Recovery
 * Plan detail, owner-scoped (owner, 2026-08-08, Software Factory Step 12).
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getRecoveryPlan, RecoveryError } from "../../../../_lib/recoveryRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_NOT_OWNED")) return 403;
  return 500;
}

export async function GET(_req: Request, { params }: { params: Promise<{ planId: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { planId } = await params;
  try {
    const plan = getRecoveryPlan(planId, auth.id);
    return NextResponse.json({ ok: true, plan });
  } catch (e) {
    const code = e instanceof RecoveryError ? e.code : "INTERNAL_ERROR";
    return errorResponse(code, e instanceof Error ? e.message : "unexpected error", statusFor(code));
  }
}
