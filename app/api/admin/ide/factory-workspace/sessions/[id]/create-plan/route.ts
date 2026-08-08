/**
 * POST /api/admin/ide/factory-workspace/sessions/[id]/create-plan — real
 * Execution Plan construction from the real, approved Context Plan
 * (owner, 2026-08-08, Software Factory Step 13, Section 8).
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getWorkspaceSession, recordExecutionPlan, FactoryWorkspaceError } from "../../../../_lib/factoryWorkspaceRuntime";
import { buildExecutionPlan } from "../../../../_lib/executionPlanRuntime";
import { getContextPlan, ContextPlannerError } from "../../../../_lib/contextPlannerRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_NOT_OWNED")) return 403;
  return 500;
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;
  try {
    const session = getWorkspaceSession(id, auth.id);
    if (!session.contextPlanId) return errorResponse("INVALID_REQUEST", "no real, approved Context Plan yet", 400);
    const contextPlan = getContextPlan(session.contextPlanId, auth.id);
    const plan = buildExecutionPlan(id, auth.id, auth.email, contextPlan);
    const updated = recordExecutionPlan(id, auth.id, plan);
    return NextResponse.json({ ok: true, executionPlan: plan, session: updated });
  } catch (e) {
    const code = e instanceof FactoryWorkspaceError ? e.code : e instanceof ContextPlannerError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof Error ? e.message : "unexpected error";
    return errorResponse(code, message, statusFor(code));
  }
}
