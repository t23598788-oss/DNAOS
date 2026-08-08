/**
 * GET /api/admin/ide/operations/restore-tests — owner-scoped real
 * Restore Test list (owner, 2026-08-08, Software Factory Step 12.5).
 * POST — real dry-run restore test against a real, existing backup.
 * Never restores to Production, never opens a real database connection.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { runRestoreTest, listRestoreTests, RestoreTestError } from "../../_lib/restoreTestRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_NOT_OWNED")) return 403;
  if (code === "PRODUCTION_TARGET_REJECTED" || code === "INVALID_REQUEST") return 400;
  return 500;
}

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ ok: true, restoreTests: listRestoreTests(auth.id) });
}

export async function POST(req: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  let body: { backupId?: unknown };
  try { body = await req.json(); } catch { return errorResponse("INVALID_REQUEST", "invalid JSON body", 400); }
  if (typeof body.backupId !== "string") return errorResponse("INVALID_REQUEST", "backupId is required", 400);

  try {
    const run = await runRestoreTest(body.backupId, auth.id, auth.email);
    return NextResponse.json({ ok: true, run });
  } catch (e) {
    const code = e instanceof RestoreTestError ? e.code : "INTERNAL_ERROR";
    return errorResponse(code, e instanceof Error ? e.message : "unexpected error", statusFor(code));
  }
}
