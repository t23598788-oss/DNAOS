/**
 * POST /api/admin/ide/workers/execute — real, generic Worker execution
 * entrypoint (owner, 2026-08-08, Software Factory Step 13.6, Section
 * 20). Thin wrapper — delegates to the exact same real
 * codeWorkerRuntime.ts#generateCodeWorkerProposal() the Factory
 * Workspace tab's /generate-proposal route already uses (Section 20:
 * "ลดจำนวน route ถ้า reuse route เดิมได้" — reused at the function level,
 * never a second implementation). Requires a real, already-approved
 * Context Plan.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { generateCodeWorkerProposal, CodeWorkerError } from "../../_lib/codeWorkerRuntime";
import { getContextPlan, ContextPlannerError } from "../../_lib/contextPlannerRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_NOT_OWNED")) return 403;
  if (code === "CALL_CAP_EXCEEDED") return 429;
  return 500;
}

export async function POST(req: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  let body: Partial<{ contextPlanId: string; executionStepId: string; taskDescription: string; acceptanceCriteria: string[]; ownerPreference: string[] }>;
  try { body = await req.json(); } catch { body = {}; }
  const contextPlanId = typeof body.contextPlanId === "string" ? body.contextPlanId : "";
  const executionStepId = typeof body.executionStepId === "string" ? body.executionStepId : "";
  const taskDescription = typeof body.taskDescription === "string" ? body.taskDescription : "";
  const acceptanceCriteria = Array.isArray(body.acceptanceCriteria) ? body.acceptanceCriteria.filter((c): c is string => typeof c === "string") : [];
  const ownerPreference = Array.isArray(body.ownerPreference) ? body.ownerPreference.filter((p): p is string => typeof p === "string") : [];
  if (!contextPlanId || !executionStepId || !taskDescription) return errorResponse("INVALID_REQUEST", "real contextPlanId, executionStepId, and taskDescription are required", 400);

  try {
    const contextPlan = getContextPlan(contextPlanId, auth.id);
    const proposal = await generateCodeWorkerProposal(contextPlan, executionStepId, taskDescription, acceptanceCriteria, auth.id, auth.email, ownerPreference);
    return NextResponse.json({ ok: true, proposal });
  } catch (e) {
    const code = e instanceof CodeWorkerError ? e.code : e instanceof ContextPlannerError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof Error ? e.message : "unexpected error";
    return errorResponse(code, message, statusFor(code));
  }
}
