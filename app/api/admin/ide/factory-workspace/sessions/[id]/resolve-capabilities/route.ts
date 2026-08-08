/**
 * POST /api/admin/ide/factory-workspace/sessions/[id]/resolve-capabilities
 * — real, deterministic Capability Resolution against the real, frozen
 * 202-capability registry (owner, 2026-08-08, Software Factory Step 13,
 * Section 4). Requires the real INTENT_CONFIRMED gate to already be
 * APPROVED.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getWorkspaceSession, runCapabilityResolution, recordCapabilityResolution, FactoryWorkspaceError } from "../../../../_lib/factoryWorkspaceRuntime";
import { getIntent, IntentError } from "../../../../_lib/intentRuntime";
import { resolveCapabilities } from "../../../../_lib/capabilityResolverRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_NOT_OWNED")) return 403;
  if (code === "GATE_NOT_DECIDED" || code === "GATE_REJECTED") return 409;
  return 500;
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;
  try {
    const session = getWorkspaceSession(id, auth.id);
    if (!session.intentId) return errorResponse("INVALID_REQUEST", "no real Intent attached to this Workspace Session yet", 400);
    const intent = getIntent(session.intentId, auth.id);
    runCapabilityResolution(id, auth.id);
    const report = resolveCapabilities(intent.structured);
    const updated = recordCapabilityResolution(id, auth.id, report);
    return NextResponse.json({ ok: true, report, session: updated });
  } catch (e) {
    const code = e instanceof FactoryWorkspaceError ? e.code : e instanceof IntentError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof Error ? e.message : "unexpected error";
    return errorResponse(code, message, statusFor(code));
  }
}
