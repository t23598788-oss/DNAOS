/**
 * POST /api/admin/ide/owner-command/approve — real Owner approval of a
 * mutation the Owner Command Surface proposed (owner, 2026-08-08,
 * /admin/ide gap-closing mission). The ONLY path that can cause a real
 * write to disk from an auto-orchestrated command — reuses
 * factoryWorkspaceRuntime.ts#resumeAfterProposalApproval(), which itself
 * reuses the exact same real write/Review/Test functions the manual
 * Factory Workspace tab's approve-proposal + execute routes already
 * use. Deliberately a separate route from approve-proposal/route.ts:
 * that route's existing behavior (write only, no auto-continue) stays
 * untouched for the manual Factory Workspace UI — this route is the
 * Owner Command Surface's own, since it needs to auto-continue through
 * Review/Test in the same request.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { resumeAfterProposalApproval, FactoryWorkspaceError } from "../../_lib/factoryWorkspaceRuntime";
import { CodeWorkerError } from "../../_lib/codeWorkerRuntime";
import { ChangeSetError } from "../../_lib/changeSetRuntime";
import { TestPipelineError } from "../../_lib/testRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_NOT_OWNED")) return 403;
  if (code === "PROPOSAL_REJECTED" || code === "PROPOSAL_ALREADY_APPROVED" || code === "PROPOSAL_NOT_APPROVED") return 409;
  return 500;
}

export async function POST(req: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  let body: { workspaceSessionId?: unknown; proposalId?: unknown };
  try { body = await req.json(); } catch { body = {}; }
  const workspaceSessionId = typeof body.workspaceSessionId === "string" ? body.workspaceSessionId : "";
  const proposalId = typeof body.proposalId === "string" ? body.proposalId : "";
  if (!workspaceSessionId || !proposalId) return errorResponse("INVALID_REQUEST", "real workspaceSessionId and proposalId are required", 400);

  try {
    const result = await resumeAfterProposalApproval(workspaceSessionId, auth.id, auth.email, proposalId);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const code =
      e instanceof FactoryWorkspaceError ? e.code
      : e instanceof CodeWorkerError ? e.code
      : e instanceof ChangeSetError ? e.code
      : e instanceof TestPipelineError ? e.code
      : "INTERNAL_ERROR";
    const message = e instanceof Error ? e.message : "unexpected error";
    return errorResponse(code, message, statusFor(code));
  }
}
