/**
 * POST /api/admin/ide/build/runs — real Build Request + Build Run (owner,
 * 2026-08-06, Software Factory Step 9, Build Pipeline). Accepts only real
 * buildTypeIds/sourceChangeSetId/sourceReviewId/sourceTestRunId/
 * environmentProfileId/reason — never a raw command, cwd, env value, or
 * output path from the client. Never Git Write, never Deploy.
 * GET /api/admin/ide/build/runs — owner-scoped real Build Run list.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { createBuildRequest, listBuildRuns, BuildPipelineError } from "../../_lib/buildRuntime";
import type { BuildTypeId } from "../../_lib/buildRegistry";
import type { EnvironmentProfileId } from "../../_lib/buildRegistry";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_NOT_OWNED")) return 403;
  if (code === "INVALID_REQUEST" || code === "BUILD_TYPE_NOT_IMPLEMENTED" || code === "ENVIRONMENT_PROFILE_NOT_AVAILABLE") return 400;
  return 500;
}

export async function POST(req: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  let body: {
    buildTypeIds?: unknown; sourceChangeSetId?: unknown; sourceReviewId?: unknown; sourceTestRunId?: unknown;
    environmentProfileId?: unknown; reason?: unknown; ownerConfirmation?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return errorResponse("INVALID_REQUEST", "invalid JSON body", 400);
  }
  if (!Array.isArray(body.buildTypeIds) || body.buildTypeIds.some((x) => typeof x !== "string")) {
    return errorResponse("INVALID_REQUEST", "buildTypeIds must be a real array of Build Type id strings", 400);
  }
  if (typeof body.sourceChangeSetId !== "string" || typeof body.sourceReviewId !== "string" || typeof body.sourceTestRunId !== "string") {
    return errorResponse("INVALID_REQUEST", "sourceChangeSetId/sourceReviewId/sourceTestRunId are required real ids", 400);
  }
  if (typeof body.environmentProfileId !== "string") {
    return errorResponse("INVALID_REQUEST", "environmentProfileId is required", 400);
  }
  if (typeof body.reason !== "string" || body.reason.trim().length === 0) {
    return errorResponse("INVALID_REQUEST", "reason is required for every Build Request", 400);
  }
  if (body.ownerConfirmation !== true) {
    return errorResponse("INVALID_REQUEST", "ownerConfirmation must be true — Build changes the workspace (.next output)", 400);
  }

  try {
    const { request, run } = await createBuildRequest(auth.email, auth.id, {
      buildTypeIds: body.buildTypeIds as BuildTypeId[],
      sourceChangeSetId: body.sourceChangeSetId, sourceReviewId: body.sourceReviewId, sourceTestRunId: body.sourceTestRunId,
      environmentProfileId: body.environmentProfileId as EnvironmentProfileId,
      reason: body.reason, ownerConfirmation: true,
    });
    return NextResponse.json({ ok: true, request, run });
  } catch (e) {
    const code = e instanceof BuildPipelineError ? e.code : "INTERNAL_ERROR";
    return errorResponse(code, e instanceof Error ? e.message : "unexpected error", statusFor(code));
  }
}

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ ok: true, runs: listBuildRuns(auth.id) });
}
