/**
 * POST /api/admin/ide/factory-workspace/sessions/[id]/decide — real Owner
 * Decision Gate recorder (owner, 2026-08-08, Software Factory Step 13,
 * Section 10). AI must never call this route on the Owner's behalf —
 * it is only ever invoked by a real, authenticated Owner request.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { decideGate, FactoryWorkspaceError, type DecisionGate } from "../../../../_lib/factoryWorkspaceRuntime";

const VALID_GATES: DecisionGate[] = [
  "INTENT_CONFIRMED", "CAPABILITY_SELECTION_APPROVED", "NEW_CAPABILITY_APPROVED", "CONTEXT_SCOPE_APPROVED",
  "HIGH_RISK_CHANGE_APPROVED", "FILE_DELETE_APPROVED", "EXTERNAL_MUTATION_APPROVED", "RELEASE_CANDIDATE_APPROVED",
];

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
  let body: { gate?: unknown; decision?: unknown; reason?: unknown };
  try { body = await req.json(); } catch { body = {}; }

  const gate = body.gate as DecisionGate;
  const decision = body.decision;
  const reason = typeof body.reason === "string" ? body.reason : "";
  if (!VALID_GATES.includes(gate)) return errorResponse("INVALID_REQUEST", `gate must be one of: ${VALID_GATES.join(", ")}`, 400);
  if (decision !== "APPROVED" && decision !== "REJECTED") return errorResponse("INVALID_REQUEST", "decision must be APPROVED or REJECTED", 400);
  if (!reason.trim()) return errorResponse("INVALID_REQUEST", "a real reason is required for every Owner Decision", 400);

  if (gate === "EXTERNAL_MUTATION_APPROVED" && decision === "APPROVED") {
    return errorResponse("EXTERNAL_MUTATION_BLOCKED", "EXTERNAL_MUTATION is forbidden this Step by design (Section 25) — cannot be approved", 403);
  }

  try {
    const session = decideGate(id, auth.id, auth.email, gate, decision, reason);
    return NextResponse.json({ ok: true, session });
  } catch (e) {
    const code = e instanceof FactoryWorkspaceError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof Error ? e.message : "unexpected error";
    return errorResponse(code, message, statusFor(code));
  }
}
