/**
 * GET /api/admin/ide/tree?path=<relative path, omit for workspace root>
 *
 * Lazy, single-level real directory listing for /admin/ide's Explorer panel
 * (owner, 2026-08-05). One folder per request — the client calls this again
 * with a child's path to expand it; this never recurses the whole
 * repository. Directories sorted before files, alphabetical within each
 * group. Read-only: no write/create/delete/rename capability anywhere in
 * this route. Core logic lives in ../_lib/tree.ts (checkpoint refactor,
 * 2026-08-05) so the regression suite exercises the real function.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { IdeFsError, auditLog, type IdeErrorCode } from "../_lib/fsSecurity";
import { listDirectory } from "../_lib/tree";

function errorResponse(code: IdeErrorCode, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const clientPath = req.nextUrl.searchParams.get("path") ?? "";

  try {
    const { relPath, entries } = await listDirectory(clientPath);
    auditLog("ide.tree.read", relPath, "ok");
    return NextResponse.json({ ok: true, path: relPath, entries });
  } catch (e) {
    if (e instanceof IdeFsError) {
      auditLog("ide.tree.read", clientPath, e.code);
      const status = e.code === "NOT_FOUND" ? 404 : e.code === "ACCESS_DENIED" ? 403 : 400;
      return errorResponse(e.code, e.message, status);
    }
    auditLog("ide.tree.read", clientPath, "INTERNAL_ERROR");
    return errorResponse("INTERNAL_ERROR", "unexpected error", 500);
  }
}
