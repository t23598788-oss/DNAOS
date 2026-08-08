/**
 * GET /api/admin/ide/git/blame?path=<relative> — real, read-only Blame for
 * one file (owner, 2026-08-06, Software Factory Step 6). Path validated
 * through the same resolveSafeRelativePath() every other /admin/ide route
 * uses. `git blame --line-porcelain`, never a mutation.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getBlame } from "../../_lib/gitReadOnly";
import { auditLog, IdeFsError, type IdeErrorCode } from "../../_lib/fsSecurity";

function errorResponse(code: IdeErrorCode, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const clientPath = req.nextUrl.searchParams.get("path");
  if (clientPath === null) return errorResponse("INVALID_PATH", "path is required", 400);

  try {
    const blame = await getBlame(clientPath);
    auditLog("ide.git.blame", clientPath, "ok");
    return NextResponse.json({ ok: true, path: clientPath, blame });
  } catch (e) {
    const code = e instanceof IdeFsError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof IdeFsError ? e.message : "unexpected error";
    auditLog("ide.git.blame", clientPath, code);
    const status = code === "NOT_FOUND" ? 404 : code === "ACCESS_DENIED" ? 403 : code === "GIT_ERROR" ? 500 : 400;
    return errorResponse(code, message, status);
  }
}
