/**
 * POST /api/admin/ide/operations/restore-tests/[id]/verify — re-runs the
 * real dry-run restore test against the SAME real backup a prior
 * Restore Test referenced (owner, 2026-08-08, Software Factory Step
 * 12.5). Never restores to Production, never a fabricated VERIFIED.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getRestoreTest, runRestoreTest, RestoreTestError } from "../../../../_lib/restoreTestRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_NOT_OWNED")) return 403;
  return 500;
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  try {
    const prior = getRestoreTest(id, auth.id);
    const run = await runRestoreTest(prior.backupId, auth.id, auth.email);
    return NextResponse.json({ ok: true, run });
  } catch (e) {
    const code = e instanceof RestoreTestError ? e.code : "INTERNAL_ERROR";
    return errorResponse(code, e instanceof Error ? e.message : "unexpected error", statusFor(code));
  }
}
