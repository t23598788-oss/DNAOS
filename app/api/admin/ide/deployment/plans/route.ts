/**
 * POST /api/admin/ide/deployment/plans — real Deployment Plan against a
 * real, already-READY Release Run (owner, 2026-08-08, Software Factory
 * Step 11, Deployment Orchestration Runtime). Never deploys, never calls
 * Vercel/Supabase, never Git Push, never auto-fix. Accepts only a real
 * releaseRunId/targetId/reason — never a raw command, cwd, env value, or
 * output path from the client.
 * GET /api/admin/ide/deployment/plans — owner-scoped real Deployment Plan list.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { createDeploymentPlan, listDeploymentPlans, DeploymentPipelineError } from "../../_lib/deploymentRuntime";
import { ReleasePipelineError } from "../../_lib/releaseRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_NOT_OWNED")) return 403;
  if (code === "INVALID_REQUEST") return 400;
  return 500;
}

export async function POST(req: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  let body: { releaseRunId?: unknown; targetId?: unknown; reason?: unknown; ownerConfirmation?: unknown };
  try {
    body = await req.json();
  } catch {
    return errorResponse("INVALID_REQUEST", "invalid JSON body", 400);
  }
  if (typeof body.releaseRunId !== "string") return errorResponse("INVALID_REQUEST", "releaseRunId is required", 400);
  if (typeof body.targetId !== "string") return errorResponse("INVALID_REQUEST", "targetId is required", 400);
  if (typeof body.reason !== "string" || body.reason.trim().length === 0) return errorResponse("INVALID_REQUEST", "reason is required for every Deployment Plan", 400);
  if (body.ownerConfirmation !== true) return errorResponse("INVALID_REQUEST", "ownerConfirmation must be true", 400);

  try {
    const plan = await createDeploymentPlan(auth.email, auth.id, { releaseRunId: body.releaseRunId, targetId: body.targetId, reason: body.reason, ownerConfirmation: true });
    return NextResponse.json({ ok: true, plan });
  } catch (e) {
    const code = e instanceof DeploymentPipelineError ? e.code : e instanceof ReleasePipelineError ? e.code : "INTERNAL_ERROR";
    return errorResponse(code, e instanceof Error ? e.message : "unexpected error", statusFor(code));
  }
}

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ ok: true, plans: listDeploymentPlans(auth.id) });
}
