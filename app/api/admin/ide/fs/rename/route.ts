/**
 * POST /api/admin/ide/fs/rename — { path, newName }
 * Real rename for /admin/ide's Explorer (owner, 2026-08-05, Phase 3) — a
 * move within the same parent directory. Uses fs.rename() (atomic);
 * refuses a destination that already exists (PATH_CONFLICT) and never
 * falls back to copy+delete on a cross-device error (OPERATION_FAILED).
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { IdeFsError, auditFsOpLog, type IdeErrorCode } from "../../_lib/fsSecurity";
import { renameEntry } from "../../_lib/fsOps";

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

  let body: { path?: unknown; newName?: unknown };
  try {
    body = await req.json();
  } catch {
    return errorResponse("INVALID_PATH", "invalid JSON body", 400);
  }
  const { path: clientPath, newName } = body;
  if (typeof clientPath !== "string") return errorResponse("INVALID_PATH", "path is required", 400);
  if (typeof newName !== "string") return errorResponse("INVALID_NAME", "newName is required", 400);

  try {
    const result = await renameEntry(clientPath, newName);
    auditFsOpLog("rename", result.sourceRelPath, result.destRelPath, "ok");
    return NextResponse.json({ ok: true, path: result.destRelPath, type: result.itemType });
  } catch (e) {
    const code = e instanceof IdeFsError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof IdeFsError ? e.message : "unexpected error";
    auditFsOpLog("rename", clientPath, null, code);
    return errorResponse(code, message, statusFor(code));
  }
}
