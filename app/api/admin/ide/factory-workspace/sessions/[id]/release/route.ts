/**
 * POST /api/admin/ide/factory-workspace/sessions/[id]/release — real
 * Release Candidate request from the real, passing Build Run (owner,
 * 2026-08-08, Software Factory Step 13). Requires the real
 * RELEASE_CANDIDATE_APPROVED Owner Decision Gate. Never deploys —
 * Deploy remains an explicit, separate, forbidden-this-Step Owner
 * action (Section 25).
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getWorkspaceSession, decideGate, requestWorkspaceRelease, FactoryWorkspaceError } from "../../../../_lib/factoryWorkspaceRuntime";
import { ReleasePipelineError } from "../../../../_lib/releaseRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_NOT_OWNED")) return 403;
  if (code === "GATE_NOT_DECIDED" || code === "GATE_REJECTED") return 409;
  return 500;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;
  let body: { reason?: unknown };
  try { body = await req.json(); } catch { body = {}; }
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason : "Owner approved real Release Candidate for this Workspace Session";

  try {
    getWorkspaceSession(id, auth.id);
    decideGate(id, auth.id, auth.email, "RELEASE_CANDIDATE_APPROVED", "APPROVED", reason);
    const result = await requestWorkspaceRelease(id, auth.id, auth.email, reason);
    return NextResponse.json({ ok: true, session: result.session, releaseRun: result.releaseRun });
  } catch (e) {
    const code = e instanceof FactoryWorkspaceError ? e.code : e instanceof ReleasePipelineError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof Error ? e.message : "unexpected error";
    return errorResponse(code, message, statusFor(code));
  }
}
