/**
 * GET /api/admin/ide/git/diff?path=<relative>&staged=true|false — real,
 * read-only unified diff for one file (owner, 2026-08-05, Phase 1). Path
 * validated through the same resolveSafeRelativePath() every other
 * /admin/ide route uses before it's ever passed to git — and even then,
 * only as an argv element after `--`, never shell-interpolated.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getFileDiff } from "../../_lib/gitReadOnly";
import { auditLog, IdeFsError, type IdeErrorCode } from "../../_lib/fsSecurity";

function errorResponse(code: IdeErrorCode, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const clientPath = req.nextUrl.searchParams.get("path");
  const staged = req.nextUrl.searchParams.get("staged") === "true";
  if (clientPath === null) {
    return errorResponse("INVALID_PATH", "path is required", 400);
  }

  try {
    const diff = await getFileDiff(clientPath, staged);
    auditLog("ide.git.diff", diff.path, "ok");
    return NextResponse.json({ ok: true, ...diff });
  } catch (e) {
    const code = e instanceof IdeFsError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof IdeFsError ? e.message : "unexpected error";
    auditLog("ide.git.diff", clientPath, code);
    const status = code === "NOT_FOUND" ? 404 : code === "ACCESS_DENIED" ? 403 : code === "GIT_ERROR" ? 500 : 400;
    return errorResponse(code, message, status);
  }
}
