/**
 * POST /api/admin/ide/factory-workspace/sessions/[id]/prepare-context —
 * real, minimal-scope Context Plan construction (owner, 2026-08-08,
 * Software Factory Step 13, Section 5). Never sends the whole repo.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getWorkspaceSession, recordContextPlan, FactoryWorkspaceError } from "../../../../_lib/factoryWorkspaceRuntime";
import { buildContextPlan } from "../../../../_lib/contextPlannerRuntime";

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
  let body: { changedFiles?: unknown };
  try { body = await req.json(); } catch { body = {}; }
  const changedFiles = Array.isArray(body.changedFiles) ? body.changedFiles.filter((f): f is string => typeof f === "string") : [];

  try {
    const session = getWorkspaceSession(id, auth.id);
    if (!session.capabilityResolution) return errorResponse("INVALID_REQUEST", "run resolve-capabilities before preparing Context", 400);
    const plan = buildContextPlan(id, auth.id, auth.email, session.capabilityResolution, changedFiles);
    const updated = recordContextPlan(id, auth.id, plan);
    return NextResponse.json({ ok: true, contextPlan: plan, session: updated });
  } catch (e) {
    const code = e instanceof FactoryWorkspaceError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof Error ? e.message : "unexpected error";
    return errorResponse(code, message, statusFor(code));
  }
}
