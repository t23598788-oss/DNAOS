/**
 * POST /api/admin/ide/build/runs/[buildRunId]/rerun — re-executes a real
 * prior Build Run's real cross-references against the CURRENT working
 * tree, creating a brand new Build Run (owner, 2026-08-06, Software
 * Factory Step 9). Never mutates the original.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { rerunBuildRun, BuildPipelineError } from "../../../../_lib/buildRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_NOT_OWNED")) return 403;
  return 500;
}

export async function POST(_req: Request, { params }: { params: Promise<{ buildRunId: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { buildRunId } = await params;
  try {
    const { request, run } = await rerunBuildRun(buildRunId, auth.id, auth.email);
    return NextResponse.json({ ok: true, request, run });
  } catch (e) {
    const code = e instanceof BuildPipelineError ? e.code : "INTERNAL_ERROR";
    return errorResponse(code, e instanceof Error ? e.message : "unexpected error", statusFor(code));
  }
}
