/**
 * POST /api/admin/ide/operations/recovery/plans/[planId]/verify — real
 * Recovery Verification against real, imported evidence only (owner,
 * 2026-08-08, Software Factory Step 12). Never guesses VERIFIED — the
 * real, original triggering Signal is re-collected live; dataLoss/
 * otherScope checks require explicit, real owner-supplied confirmation
 * or are honestly reported UNKNOWN.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { verifyRecovery, RecoveryError } from "../../../../../_lib/recoveryRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_NOT_OWNED")) return 403;
  return 500;
}

export async function POST(req: Request, { params }: { params: Promise<{ planId: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { planId } = await params;
  let body: { dataLossConfirmedAbsent?: unknown; otherScopeUnaffectedConfirmed?: unknown };
  try { body = await req.json(); } catch { body = {}; }

  try {
    const plan = await verifyRecovery(planId, auth.id, auth.email, {
      dataLossConfirmedAbsent: body.dataLossConfirmedAbsent === true,
      otherScopeUnaffectedConfirmed: body.otherScopeUnaffectedConfirmed === true,
    });
    return NextResponse.json({ ok: true, plan });
  } catch (e) {
    const code = e instanceof RecoveryError ? e.code : "INTERNAL_ERROR";
    return errorResponse(code, e instanceof Error ? e.message : "unexpected error", statusFor(code));
  }
}
