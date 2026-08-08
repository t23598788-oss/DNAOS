/**
 * POST /api/admin/ide/factory-workspace/sessions/[id]/generate-proposal
 * — real, programmatic CODE_WORKER invocation (owner, 2026-08-08,
 * Software Factory Step 13.5). Calls the real, provider-neutral
 * services/ai/gateway.ts (code.generate capability, real Anthropic
 * call) — never applies anything to disk. A real, hard cap of one call
 * per real Execution Step is enforced inside codeWorkerRuntime.ts.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { generateWorkerProposal, FactoryWorkspaceError } from "../../../../_lib/factoryWorkspaceRuntime";
import { CodeWorkerError } from "../../../../_lib/codeWorkerRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_NOT_OWNED")) return 403;
  if (code === "CALL_CAP_EXCEEDED") return 429;
  return 500;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;
  let body: { executionStepId?: unknown; taskDescription?: unknown; acceptanceCriteria?: unknown; ownerPreference?: unknown };
  try { body = await req.json(); } catch { body = {}; }
  const executionStepId = typeof body.executionStepId === "string" ? body.executionStepId : "";
  const taskDescription = typeof body.taskDescription === "string" ? body.taskDescription : "";
  const acceptanceCriteria = Array.isArray(body.acceptanceCriteria) ? body.acceptanceCriteria.filter((c): c is string => typeof c === "string") : [];
  const ownerPreference = Array.isArray(body.ownerPreference) ? body.ownerPreference.filter((p): p is string => typeof p === "string") : [];
  if (!executionStepId || !taskDescription) return errorResponse("INVALID_REQUEST", "real executionStepId and taskDescription are required", 400);

  try {
    const result = await generateWorkerProposal(id, auth.id, auth.email, executionStepId, taskDescription, acceptanceCriteria, ownerPreference);
    return NextResponse.json({ ok: true, session: result.session, proposal: result.proposal });
  } catch (e) {
    const code = e instanceof FactoryWorkspaceError ? e.code : e instanceof CodeWorkerError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof Error ? e.message : "unexpected error";
    return errorResponse(code, message, statusFor(code));
  }
}
