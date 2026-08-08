/**
 * GET /api/admin/ide/git/history?path=<relative>&limit=<n> — real,
 * read-only File History for one file (owner, 2026-08-06, Software Factory
 * Step 6). Path validated through the same resolveSafeRelativePath() every
 * other /admin/ide route uses. `git log --follow`, capped, never unbounded.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getFileHistory } from "../../_lib/gitReadOnly";
import { auditLog, IdeFsError, type IdeErrorCode } from "../../_lib/fsSecurity";

function errorResponse(code: IdeErrorCode, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const clientPath = req.nextUrl.searchParams.get("path");
  const limitParam = req.nextUrl.searchParams.get("limit");
  if (clientPath === null) return errorResponse("INVALID_PATH", "path is required", 400);
  const limit = limitParam ? parseInt(limitParam, 10) : 50;

  try {
    const history = await getFileHistory(clientPath, Number.isFinite(limit) ? limit : 50);
    auditLog("ide.git.history", clientPath, "ok");
    return NextResponse.json({ ok: true, path: clientPath, history });
  } catch (e) {
    const code = e instanceof IdeFsError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof IdeFsError ? e.message : "unexpected error";
    auditLog("ide.git.history", clientPath, code);
    const status = code === "NOT_FOUND" ? 404 : code === "ACCESS_DENIED" ? 403 : code === "GIT_ERROR" ? 500 : 400;
    return errorResponse(code, message, status);
  }
}
