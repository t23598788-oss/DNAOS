/**
 * GET /api/admin/ide/execution/run/[id] — a single run's current record
 * (owner, 2026-08-05, Phase 4). Ownership enforced server-side — a run
 * belonging to a different identity returns RUN_NOT_OWNED, never its data.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { ExecutionError, type ExecutionErrorCode } from "../../../_lib/executionRegistry";
import { getRun } from "../../../_lib/executionRuntime";

function errorResponse(code: ExecutionErrorCode, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: ExecutionErrorCode): number {
  if (code === "RUN_NOT_FOUND") return 404;
  if (code === "RUN_NOT_OWNED") return 403;
  return 500;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  try {
    const record = getRun(id, auth.id);
    return NextResponse.json({ ok: true, run: record });
  } catch (e) {
    const code = e instanceof ExecutionError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof ExecutionError ? e.message : "unexpected error";
    return errorResponse(code, message, statusFor(code));
  }
}
