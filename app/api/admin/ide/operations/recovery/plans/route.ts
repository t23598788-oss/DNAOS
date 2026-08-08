/**
 * GET /api/admin/ide/operations/recovery/plans — owner-scoped real
 * Recovery Plan list (owner, 2026-08-08, Software Factory Step 12).
 * POST — creates a real Recovery Plan against a real, owned Incident.
 * Plan + Verify only — never executes a real mutation.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { createRecoveryPlan, listRecoveryPlans, RecoveryError } from "../../../_lib/recoveryRuntime";
import { IncidentError } from "../../../_lib/incidentRuntime";
import { getRecoveryTypeDefinition } from "../../../_lib/recoveryRegistry";
import type { RecoveryType } from "../../../_lib/recoveryRegistry";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_NOT_OWNED")) return 403;
  if (code === "INVALID_REQUEST") return 400;
  return 500;
}

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ ok: true, plans: listRecoveryPlans(auth.id) });
}

export async function POST(req: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  let body: { incidentId?: unknown; recoveryType?: unknown };
  try { body = await req.json(); } catch { return errorResponse("INVALID_REQUEST", "invalid JSON body", 400); }
  if (typeof body.incidentId !== "string") return errorResponse("INVALID_REQUEST", "incidentId is required", 400);
  if (typeof body.recoveryType !== "string" || !getRecoveryTypeDefinition(body.recoveryType)) return errorResponse("INVALID_REQUEST", "recoveryType must be a real, registered Recovery Type", 400);

  try {
    const plan = await createRecoveryPlan(body.incidentId, body.recoveryType as RecoveryType, auth.id, auth.email);
    return NextResponse.json({ ok: true, plan });
  } catch (e) {
    const code = e instanceof RecoveryError ? e.code : e instanceof IncidentError ? e.code : "INTERNAL_ERROR";
    return errorResponse(code, e instanceof Error ? e.message : "unexpected error", statusFor(code));
  }
}
