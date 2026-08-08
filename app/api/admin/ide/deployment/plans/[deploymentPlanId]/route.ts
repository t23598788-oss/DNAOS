/**
 * GET /api/admin/ide/deployment/plans/[deploymentPlanId] — real
 * Deployment Plan detail, owner-scoped (owner, 2026-08-08, Software
 * Factory Step 11).
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getDeploymentPlan, DeploymentPipelineError } from "../../../_lib/deploymentRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_NOT_OWNED")) return 403;
  return 500;
}

export async function GET(_req: Request, { params }: { params: Promise<{ deploymentPlanId: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { deploymentPlanId } = await params;
  try {
    const plan = getDeploymentPlan(deploymentPlanId, auth.id);
    return NextResponse.json({ ok: true, plan });
  } catch (e) {
    const code = e instanceof DeploymentPipelineError ? e.code : "INTERNAL_ERROR";
    return errorResponse(code, e instanceof Error ? e.message : "unexpected error", statusFor(code));
  }
}
