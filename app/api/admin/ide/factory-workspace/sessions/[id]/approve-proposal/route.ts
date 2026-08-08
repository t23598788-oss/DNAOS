/**
 * POST /api/admin/ide/factory-workspace/sessions/[id]/approve-proposal —
 * real Owner Decision Gate CODE_WORKER_OUTPUT_APPROVED (owner,
 * 2026-08-08, Software Factory Step 13.5). The ONLY real path that can
 * cause a real CODE_WORKER proposal to be written to disk — reuses the
 * exact same real, secure write path (fsSecurity.ts +
 * fileWrite.ts#writeFileAtomic) every Editor PUT already uses.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getWorkspaceSession, decideGate, approveAndApplyWorkerProposal, FactoryWorkspaceError } from "../../../../_lib/factoryWorkspaceRuntime";
import { CodeWorkerError } from "../../../../_lib/codeWorkerRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_NOT_OWNED")) return 403;
  if (code === "PROPOSAL_REJECTED" || code === "PROPOSAL_ALREADY_APPROVED" || code === "PROPOSAL_NOT_APPROVED") return 409;
  return 500;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;
  let body: { proposalId?: unknown; reason?: unknown };
  try { body = await req.json(); } catch { body = {}; }
  const proposalId = typeof body.proposalId === "string" ? body.proposalId : "";
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason : "Owner reviewed and approved real CODE_WORKER proposal via Factory Workspace tab";
  if (!proposalId) return errorResponse("INVALID_REQUEST", "real proposalId is required", 400);

  try {
    getWorkspaceSession(id, auth.id);
    decideGate(id, auth.id, auth.email, "CODE_WORKER_OUTPUT_APPROVED", "APPROVED", reason);
    const result = await approveAndApplyWorkerProposal(id, auth.id, proposalId);
    return NextResponse.json({ ok: true, session: result.session, proposal: result.proposal });
  } catch (e) {
    const code = e instanceof FactoryWorkspaceError ? e.code : e instanceof CodeWorkerError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof Error ? e.message : "unexpected error";
    return errorResponse(code, message, statusFor(code));
  }
}
