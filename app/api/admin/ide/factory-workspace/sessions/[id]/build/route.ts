/**
 * POST /api/admin/ide/factory-workspace/sessions/[id]/build — real Build
 * against the real, applied Change Set (owner, 2026-08-08, Software
 * Factory Step 13). Uses the real, production createBuildRequest() —
 * never a test-only bypass. Honestly reports BLOCKED if real
 * preconditions (e.g. open blocking Review findings) are not met.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { runWorkspaceBuild, FactoryWorkspaceError } from "../../../../_lib/factoryWorkspaceRuntime";
import type { BuildTypeId, EnvironmentProfileId } from "../../../../_lib/buildRegistry";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_NOT_OWNED")) return 403;
  return 500;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;
  let body: { buildTypeIds?: unknown; environmentProfileId?: unknown; reason?: unknown };
  try { body = await req.json(); } catch { body = {}; }
  const buildTypeIds = (Array.isArray(body.buildTypeIds) && body.buildTypeIds.length > 0 ? body.buildTypeIds : ["NEXT_PRODUCTION_BUILD"]) as unknown as BuildTypeId[];
  const environmentProfileId = (typeof body.environmentProfileId === "string" ? body.environmentProfileId : "LOCAL_PRODUCTION_BUILD") as EnvironmentProfileId;
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason : `Factory Workspace Session ${id} native build`;

  try {
    const result = await runWorkspaceBuild(id, auth.id, auth.email, buildTypeIds, environmentProfileId, reason);
    if ("blocked" in result) return NextResponse.json({ ok: false, blocked: true, reasons: result.reasons, session: result.session }, { status: 409 });
    return NextResponse.json({ ok: true, session: result.session, buildRun: result.buildRun });
  } catch (e) {
    const code = e instanceof FactoryWorkspaceError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof Error ? e.message : "unexpected error";
    return errorResponse(code, message, statusFor(code));
  }
}
