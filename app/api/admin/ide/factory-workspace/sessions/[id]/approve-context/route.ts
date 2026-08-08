/**
 * POST /api/admin/ide/factory-workspace/sessions/[id]/approve-context —
 * real Owner approval of a Context Plan (owner, 2026-08-08, Software
 * Factory Step 13, Decision Gate CONTEXT_SCOPE_APPROVED). Records the
 * real gate decision, then approves the real Context Plan itself
 * (rejects with SCOPE_TOO_BROAD if the plan hit MAX_INCLUDED_FILES).
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getWorkspaceSession, decideGate, recordContextApproval, FactoryWorkspaceError } from "../../../../_lib/factoryWorkspaceRuntime";
import { approveContextPlan, ContextPlannerError } from "../../../../_lib/contextPlannerRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_NOT_OWNED")) return 403;
  if (code === "SCOPE_TOO_BROAD" || code === "GATE_NOT_DECIDED" || code === "GATE_REJECTED") return 409;
  return 500;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;
  let body: { reason?: unknown };
  try { body = await req.json(); } catch { body = {}; }
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason : "Owner reviewed real Context Plan scope";

  try {
    const session = getWorkspaceSession(id, auth.id);
    if (!session.contextPlanId) return errorResponse("INVALID_REQUEST", "no real Context Plan to approve yet", 400);
    approveContextPlan(session.contextPlanId, auth.id, auth.email);
    decideGate(id, auth.id, auth.email, "CONTEXT_SCOPE_APPROVED", "APPROVED", reason);
    const updated = recordContextApproval(id, auth.id);
    return NextResponse.json({ ok: true, session: updated });
  } catch (e) {
    const code = e instanceof FactoryWorkspaceError ? e.code : e instanceof ContextPlannerError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof Error ? e.message : "unexpected error";
    return errorResponse(code, message, statusFor(code));
  }
}
