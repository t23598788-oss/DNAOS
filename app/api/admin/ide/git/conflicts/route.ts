/**
 * GET /api/admin/ide/git/conflicts — real, read-only Conflict Detection
 * (owner, 2026-08-06, Software Factory Step 6). Cross-references real
 * porcelain "u" (unmerged) status entries with a real scan of each
 * conflicted file's bytes for `<<<<<<<` markers. Report-only — never
 * resolves, edits, or removes a conflict marker.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { listConflicts } from "../../_lib/gitReadOnly";
import { auditLog, IdeFsError, type IdeErrorCode } from "../../_lib/fsSecurity";

function errorResponse(code: IdeErrorCode, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  try {
    const conflicts = await listConflicts();
    auditLog("ide.git.conflicts", "", "ok");
    return NextResponse.json({ ok: true, conflicts });
  } catch (e) {
    const code = e instanceof IdeFsError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof IdeFsError ? e.message : "unexpected error";
    auditLog("ide.git.conflicts", "", code);
    return errorResponse(code, message, code === "GIT_ERROR" ? 500 : 400);
  }
}
