/**
 * GET /api/admin/ide/git/tags — real, read-only Tag Information (owner,
 * 2026-08-06, Software Factory Step 6, Source Control Workspace Read
 * Only). Calls only `git for-each-ref refs/tags` — no tag create/delete
 * reachable here.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { listTags } from "../../_lib/gitReadOnly";
import { auditLog, IdeFsError, type IdeErrorCode } from "../../_lib/fsSecurity";

function errorResponse(code: IdeErrorCode, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  try {
    const tags = await listTags();
    auditLog("ide.git.tags", "", "ok");
    return NextResponse.json({ ok: true, tags });
  } catch (e) {
    const code = e instanceof IdeFsError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof IdeFsError ? e.message : "unexpected error";
    auditLog("ide.git.tags", "", code);
    return errorResponse(code, message, code === "GIT_ERROR" ? 500 : 400);
  }
}
