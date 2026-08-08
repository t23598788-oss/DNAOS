/**
 * POST /api/admin/ide/factory-workspace/sessions/[id]/approve-plan — real
 * Owner approval of the Execution Plan (owner, 2026-08-08, Software
 * Factory Step 13). Always rejects if any real step requests
 * EXTERNAL_MUTATION (forbidden this Step by design).
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getWorkspaceSession, FactoryWorkspaceError } from "../../../../_lib/factoryWorkspaceRuntime";
import { approveExecutionPlan, ExecutionPlanError } from "../../../../_lib/executionPlanRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_NOT_OWNED")) return 403;
  if (code === "EXTERNAL_MUTATION_BLOCKED") return 403;
  return 500;
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;
  try {
    const session = getWorkspaceSession(id, auth.id);
    if (!session.executionPlanId) return errorResponse("INVALID_REQUEST", "no real Execution Plan to approve yet", 400);
    const plan = approveExecutionPlan(session.executionPlanId, auth.id);
    return NextResponse.json({ ok: true, executionPlan: plan });
  } catch (e) {
    const code = e instanceof FactoryWorkspaceError ? e.code : e instanceof ExecutionPlanError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof Error ? e.message : "unexpected error";
    return errorResponse(code, message, statusFor(code));
  }
}
