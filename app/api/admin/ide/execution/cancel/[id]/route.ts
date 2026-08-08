/**
 * POST /api/admin/ide/execution/cancel/[id] — cancels a real running/queued
 * run (owner, 2026-08-05, Phase 4). Sends SIGTERM to the exact child
 * process the runtime spawned for this run, waits a grace period, then
 * SIGKILL if still alive — never targets any other process, never
 * pkill/kill-by-pattern. Ownership enforced server-side.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { ExecutionError, type ExecutionErrorCode } from "../../../_lib/executionRegistry";
import { cancelRun } from "../../../_lib/executionRuntime";

function errorResponse(code: ExecutionErrorCode, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: ExecutionErrorCode): number {
  if (code === "RUN_NOT_FOUND") return 404;
  if (code === "RUN_NOT_OWNED") return 403;
  return 500;
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  try {
    const record = cancelRun(id, auth.id);
    return NextResponse.json({ ok: true, run: record });
  } catch (e) {
    const code = e instanceof ExecutionError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof ExecutionError ? e.message : "unexpected error";
    return errorResponse(code, message, statusFor(code));
  }
}
