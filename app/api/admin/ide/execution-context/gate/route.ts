/**
 * GET /api/admin/ide/execution-context/gate?step=14 — real, deterministic
 * Step Gate evaluation (owner, 2026-08-07, /admin/ide Foundation). Never
 * starts a Step, only answers whether the real, persisted Execution
 * Context currently allows it, with real, checkable reasons when not.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { evaluateStepGate } from "../../_lib/executionContextRuntime";

export async function GET(req: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { searchParams } = new URL(req.url);
  const step = searchParams.get("step");
  if (!step) return NextResponse.json({ ok: false, code: "INVALID_REQUEST", message: "real ?step= query param is required" }, { status: 400 });
  const result = evaluateStepGate(step);
  return NextResponse.json({ ok: true, result });
}
