/**
 * GET /api/admin/ide/git/status — real, read-only git status for
 * /admin/ide's Source Control panel (owner, 2026-08-05, Phase 1). Calls
 * only `git status --porcelain=v2 --branch --untracked-files=all` and
 * `git log -1` via app/api/admin/ide/_lib/gitReadOnly.ts's fixed argv
 * allowlist — no other git subcommand reachable from this route, no
 * client input reaches the git process at all.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getGitStatus } from "../../_lib/gitReadOnly";
import { auditLog, IdeFsError, type IdeErrorCode } from "../../_lib/fsSecurity";

function errorResponse(code: IdeErrorCode, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  try {
    const status = await getGitStatus();
    auditLog("ide.git.status", "", "ok");
    return NextResponse.json({ ok: true, ...status });
  } catch (e) {
    const code = e instanceof IdeFsError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof IdeFsError ? e.message : "unexpected error";
    auditLog("ide.git.status", "", code);
    return errorResponse(code, message, code === "GIT_ERROR" ? 500 : 400);
  }
}
