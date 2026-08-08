/**
 * POST /api/admin/ide/factory-workspace/sessions/[id]/approve-review —
 * real Owner approval of the Review (owner, 2026-08-08, Software Factory
 * Step 13, Decision Gate HIGH_RISK_CHANGE_APPROVED). Wraps the real,
 * existing changeSetRuntime.ts#recordDecision("APPROVE") — honestly
 * rejects if any real blocking finding is still OPEN.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getWorkspaceSession, decideGate, approveWorkspaceReview, FactoryWorkspaceError } from "../../../../_lib/factoryWorkspaceRuntime";
import { ChangeSetError } from "../../../../_lib/changeSetRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_NOT_OWNED")) return 403;
  if (code === "BLOCKING_FINDINGS_PRESENT" || code === "CHANGE_SET_STALE") return 409;
  return 500;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;
  let body: { reason?: unknown };
  try { body = await req.json(); } catch { body = {}; }
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason : "Owner approved real Review via Factory Workspace tab";

  try {
    getWorkspaceSession(id, auth.id);
    decideGate(id, auth.id, auth.email, "HIGH_RISK_CHANGE_APPROVED", "APPROVED", reason);
    const result = await approveWorkspaceReview(id, auth.id, auth.email, reason);
    return NextResponse.json({ ok: true, session: result.session, changeSet: result.changeSet });
  } catch (e) {
    const code = e instanceof FactoryWorkspaceError ? e.code : e instanceof ChangeSetError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof Error ? e.message : "unexpected error";
    return errorResponse(code, message, statusFor(code));
  }
}
