/**
 * POST /api/admin/ide/factory-workspace/sessions/[id]/intent — real Intent
 * capture for a Workspace Session (owner, 2026-08-08, Software Factory
 * Step 13). Accepts either a real, Owner-supplied structured intent
 * (source: OWNER_STRUCTURED) or raw text (source: AI_PROPOSED — a real,
 * deterministic, non-AI split — see intentRuntime.ts's header for why).
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getWorkspaceSession, attachIntent, FactoryWorkspaceError } from "../../../../_lib/factoryWorkspaceRuntime";
import { captureStructuredIntent, captureProposedIntent, confirmIntent, IntentError, type StructuredIntent } from "../../../../_lib/intentRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_NOT_OWNED")) return 403;
  if (code === "INVALID_REQUEST") return 400;
  return 500;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;
  let body: { raw?: unknown; structured?: unknown; confirm?: unknown };
  try { body = await req.json(); } catch { body = {}; }

  try {
    getWorkspaceSession(id, auth.id);
    const raw = typeof body.raw === "string" ? body.raw : "";
    const record = body.structured && typeof body.structured === "object"
      ? captureStructuredIntent(id, auth.id, auth.email, raw, body.structured as StructuredIntent)
      : captureProposedIntent(id, auth.id, auth.email, raw);
    const confirmed = body.confirm === true ? confirmIntent(record.intentId, auth.id, auth.email) : record;
    const session = attachIntent(id, auth.id, confirmed);
    return NextResponse.json({ ok: true, intent: confirmed, session });
  } catch (e) {
    const code = e instanceof FactoryWorkspaceError ? e.code : e instanceof IntentError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof Error ? e.message : "unexpected error";
    return errorResponse(code, message, statusFor(code));
  }
}
