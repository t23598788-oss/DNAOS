/**
 * POST /api/admin/ide/fs/trash — { path } — moves a real file/folder into
 * the workspace trash (see ../../_lib/trash.ts). Never a permanent delete.
 * GET  /api/admin/ide/fs/trash — lists current trash entries (metadata
 * only: original path, timestamp, item type — never an absolute path,
 * never content).
 * (owner, 2026-08-05, Phase 3)
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { IdeFsError, auditFsOpLog, type IdeErrorCode } from "../../_lib/fsSecurity";
import { trashEntry, listTrash } from "../../_lib/trash";

function errorResponse(code: IdeErrorCode, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: IdeErrorCode): number {
  if (code === "NOT_FOUND") return 404;
  if (code === "ACCESS_DENIED") return 403;
  if (code === "PATH_CONFLICT") return 409;
  if (code === "INVALID_PATH" || code === "PATH_OUTSIDE_WORKSPACE") return 400;
  return 500;
}

export async function POST(req: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  let body: { path?: unknown };
  try {
    body = await req.json();
  } catch {
    return errorResponse("INVALID_PATH", "invalid JSON body", 400);
  }
  const { path: clientPath } = body;
  if (typeof clientPath !== "string") return errorResponse("INVALID_PATH", "path is required", 400);

  try {
    const entry = await trashEntry(clientPath);
    auditFsOpLog("trash", entry.originalRelPath, entry.trashedRelPath, "ok");
    return NextResponse.json({ ok: true, id: entry.id, originalPath: entry.originalRelPath, itemType: entry.itemType, trashedAt: entry.trashedAt });
  } catch (e) {
    const code = e instanceof IdeFsError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof IdeFsError ? e.message : "unexpected error";
    auditFsOpLog("trash", clientPath, null, code);
    return errorResponse(code, message, statusFor(code));
  }
}

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const { entries, corruptCount } = await listTrash();
  return NextResponse.json({
    ok: true,
    entries: entries.map((e) => ({ id: e.id, originalPath: e.originalRelPath, itemType: e.itemType, trashedAt: e.trashedAt })),
    corrupt_count: corruptCount,
  });
}
