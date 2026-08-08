/**
 * GET /api/admin/ide/operations/backups/[id] — real backup detail
 * (owner, 2026-08-08, Software Factory Step 12.5).
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getBackup, BackupError } from "../../../_lib/backupRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code.endsWith("_NOT_FOUND")) return 404;
  return 500;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  try {
    const backup = getBackup(id);
    return NextResponse.json({ ok: true, backup });
  } catch (e) {
    const code = e instanceof BackupError ? e.code : "INTERNAL_ERROR";
    return errorResponse(code, e instanceof Error ? e.message : "unexpected error", statusFor(code));
  }
}
