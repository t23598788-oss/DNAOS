/**
 * POST /api/admin/ide/release/runs — real Release Request against a real,
 * already-successful Build Run (owner, 2026-08-07, Software Factory
 * Step 10, Release Pipeline). Never Deploy, never Git Write, never
 * auto-fix. Accepts only a real buildRunId/reason — never a raw command,
 * cwd, env value, or output path from the client.
 * GET /api/admin/ide/release/runs — owner-scoped real Release Run list.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { createReleaseRequest, listReleaseRuns, ReleasePipelineError } from "../../_lib/releaseRuntime";
import { BuildPipelineError } from "../../_lib/buildRuntime";

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
  let body: { buildRunId?: unknown; reason?: unknown; ownerConfirmation?: unknown };
  try {
    body = await req.json();
  } catch {
    return errorResponse("INVALID_REQUEST", "invalid JSON body", 400);
  }
  if (typeof body.buildRunId !== "string") return errorResponse("INVALID_REQUEST", "buildRunId is required", 400);
  if (typeof body.reason !== "string" || body.reason.trim().length === 0) return errorResponse("INVALID_REQUEST", "reason is required for every Release Request", 400);
  if (body.ownerConfirmation !== true) return errorResponse("INVALID_REQUEST", "ownerConfirmation must be true", 400);

  try {
    const run = await createReleaseRequest(auth.email, auth.id, { buildRunId: body.buildRunId, reason: body.reason, ownerConfirmation: true });
    return NextResponse.json({ ok: true, run });
  } catch (e) {
    const code = e instanceof ReleasePipelineError ? e.code : e instanceof BuildPipelineError ? e.code : "INTERNAL_ERROR";
    return errorResponse(code, e instanceof Error ? e.message : "unexpected error", statusFor(code));
  }
}

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ ok: true, runs: listReleaseRuns(auth.id) });
}
