/**
 * POST /api/admin/ide/fs/restore — { id } — restores a trashed item to its
 * exact original relative path (owner, 2026-08-05, Phase 3). Re-validates
 * path security fresh every time; refuses if something now occupies the
 * original location (PATH_CONFLICT, never overwritten) or if the trash
 * metadata/item is corrupt (CORRUPT_TRASH_ENTRY, never guessed).
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { IdeFsError, auditFsOpLog, type IdeErrorCode } from "../../_lib/fsSecurity";
import { restoreEntry } from "../../_lib/trash";

function errorResponse(code: IdeErrorCode, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: IdeErrorCode): number {
  if (code === "TRASH_ENTRY_NOT_FOUND") return 404;
  if (code === "ACCESS_DENIED") return 403;
  if (code === "PATH_CONFLICT") return 409;
  if (code === "CORRUPT_TRASH_ENTRY") return 409;
  if (code === "INVALID_PATH" || code === "PATH_OUTSIDE_WORKSPACE") return 400;
  return 500;
}

export async function POST(req: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  let body: { id?: unknown };
  try {
    body = await req.json();
  } catch {
    return errorResponse("INVALID_PATH", "invalid JSON body", 400);
  }
  const { id } = body;
  if (typeof id !== "string" || id.length === 0) return errorResponse("TRASH_ENTRY_NOT_FOUND", "id is required", 400);

  try {
    const result = await restoreEntry(id);
    auditFsOpLog("restore", id, result.relPath, "ok");
    return NextResponse.json({ ok: true, path: result.relPath });
  } catch (e) {
    const code = e instanceof IdeFsError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof IdeFsError ? e.message : "unexpected error";
    auditFsOpLog("restore", id, null, code);
    return errorResponse(code, message, statusFor(code));
  }
}
