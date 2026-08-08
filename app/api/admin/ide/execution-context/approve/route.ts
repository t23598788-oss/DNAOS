/**
 * POST /api/admin/ide/execution-context/approve — { step, approved } —
 * the ONLY real path that can ever flip ownerApprovals[step] (owner,
 * 2026-08-07, /admin/ide Foundation). A separate, explicit, real Owner
 * action — never inferred from a Foundation looking "complete", never
 * inferred from chat text.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { recordOwnerApproval, ExecutionContextError } from "../../_lib/executionContextRuntime";

export async function POST(req: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  let body: { step?: unknown; approved?: unknown };
  try { body = await req.json(); } catch { body = {}; }
  const step = typeof body.step === "string" ? body.step : "";
  const approved = body.approved === true;
  if (!step) return NextResponse.json({ ok: false, code: "INVALID_REQUEST", message: "real step is required" }, { status: 400 });
  try {
    const checkpoint = await recordOwnerApproval(step, approved, auth.email, auth.id);
    return NextResponse.json({ ok: true, checkpoint });
  } catch (e) {
    const code = e instanceof ExecutionContextError ? e.code : "INTERNAL_ERROR";
    return NextResponse.json({ ok: false, code, message: e instanceof Error ? e.message : "unexpected error" }, { status: code === "NO_CONTEXT_YET" ? 409 : 500 });
  }
}
