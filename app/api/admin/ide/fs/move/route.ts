/**
 * POST /api/admin/ide/fs/move — { path, destinationDir }
 * Real move for /admin/ide's Explorer (owner, 2026-08-05, Phase 3) — same
 * basename, different parent directory. Refuses moving a directory into
 * itself or its own descendant (INVALID_MOVE), a destination that already
 * exists (PATH_CONFLICT), and any symlink source/destination.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { IdeFsError, auditFsOpLog, type IdeErrorCode } from "../../_lib/fsSecurity";
import { moveEntryToDirectory } from "../../_lib/fsOps";

function errorResponse(code: IdeErrorCode, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: IdeErrorCode): number {
  if (code === "NOT_FOUND") return 404;
  if (code === "ACCESS_DENIED") return 403;
  if (code === "PATH_CONFLICT") return 409;
  if (code === "INVALID_PATH" || code === "INVALID_NAME" || code === "PATH_OUTSIDE_WORKSPACE" || code === "INVALID_MOVE") return 400;
  return 500;
}

export async function POST(req: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  let body: { path?: unknown; destinationDir?: unknown };
  try {
    body = await req.json();
  } catch {
    return errorResponse("INVALID_PATH", "invalid JSON body", 400);
  }
  const { path: clientPath, destinationDir } = body;
  if (typeof clientPath !== "string") return errorResponse("INVALID_PATH", "path is required", 400);
  if (typeof destinationDir !== "string") return errorResponse("INVALID_PATH", "destinationDir is required", 400);

  try {
    const result = await moveEntryToDirectory(clientPath, destinationDir);
    auditFsOpLog("move", result.sourceRelPath, result.destRelPath, "ok");
    return NextResponse.json({ ok: true, path: result.destRelPath, type: result.itemType });
  } catch (e) {
    const code = e instanceof IdeFsError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof IdeFsError ? e.message : "unexpected error";
    auditFsOpLog("move", clientPath, null, code);
    return errorResponse(code, message, statusFor(code));
  }
}
