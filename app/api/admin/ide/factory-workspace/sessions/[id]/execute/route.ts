/**
 * POST /api/admin/ide/factory-workspace/sessions/[id]/execute — real
 * Native File Change Flow start (owner, 2026-08-08, Software Factory
 * Step 13, Section 9). Captures whatever real diff already exists in
 * the real git working tree into a real Change Set (never invents a
 * diff — the actual file edit must already have happened through the
 * real File Runtime/Editor), then runs real Review and real Test.
 * Build and Release are separate routes since a real build can take
 * real, meaningful time.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getWorkspaceSession, beginExecution, runWorkspaceReview, runWorkspaceTest, recordWorkerAssignment, FactoryWorkspaceError } from "../../../../_lib/factoryWorkspaceRuntime";
import { buildAIContextPackage, AIContextError } from "../../../../_lib/aiContextRuntime";
import { getContextPlan, ContextPlannerError } from "../../../../_lib/contextPlannerRuntime";
import { ChangeSetError } from "../../../../_lib/changeSetRuntime";
import { TestPipelineError } from "../../../../_lib/testRuntime";
import type { WorkerType } from "../../../../_lib/workerRegistry";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_NOT_OWNED")) return 403;
  if (code === "GATE_NOT_DECIDED" || code === "GATE_REJECTED" || code === "CONTEXT_NOT_APPROVED" || code === "WORKER_UNAVAILABLE") return 409;
  return 500;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;
  let body: { title?: unknown; description?: unknown; workerType?: unknown };
  try { body = await req.json(); } catch { body = {}; }
  const title = typeof body.title === "string" ? body.title : `Workspace Session ${id.slice(0, 8)}`;
  const description = typeof body.description === "string" ? body.description : "";
  const workerType = (typeof body.workerType === "string" ? body.workerType : "CODE_WORKER") as WorkerType;

  try {
    const session = getWorkspaceSession(id, auth.id);
    if (session.contextPlanId) {
      const contextPlan = getContextPlan(session.contextPlanId, auth.id);
      const pkg = buildAIContextPackage(contextPlan, workerType, auth.id, auth.email);
      recordWorkerAssignment(id, auth.id, pkg);
    }
    await beginExecution(id, auth.id, auth.email, title, description);
    const review = await runWorkspaceReview(id, auth.id, auth.email);
    const test = await runWorkspaceTest(id, auth.id, auth.email);
    return NextResponse.json({ ok: true, session: test.session, changeSet: review.changeSet, testRun: test.testRun });
  } catch (e) {
    const code =
      e instanceof FactoryWorkspaceError ? e.code
      : e instanceof AIContextError ? e.code
      : e instanceof ContextPlannerError ? e.code
      : e instanceof ChangeSetError ? e.code
      : e instanceof TestPipelineError ? e.code
      : "INTERNAL_ERROR";
    const message = e instanceof Error ? e.message : "unexpected error";
    return errorResponse(code, message, statusFor(code));
  }
}
