/**
 * GET /api/admin/ide/git/branches — real, read-only Branch Information
 * (owner, 2026-08-06, Software Factory Step 6, Source Control Workspace
 * Read Only). Calls only `git for-each-ref` via gitReadOnly.ts's fixed
 * argv allowlist — no branch create/delete/checkout reachable here.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { listBranches } from "../../_lib/gitReadOnly";
import { auditLog, IdeFsError, type IdeErrorCode } from "../../_lib/fsSecurity";

function errorResponse(code: IdeErrorCode, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  try {
    const branches = await listBranches();
    auditLog("ide.git.branches", "", "ok");
    return NextResponse.json({ ok: true, branches });
  } catch (e) {
    const code = e instanceof IdeFsError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof IdeFsError ? e.message : "unexpected error";
    auditLog("ide.git.branches", "", code);
    return errorResponse(code, message, code === "GIT_ERROR" ? 500 : 400);
  }
}
