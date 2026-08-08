/**
 * POST /api/admin/ide/fs/create — { path, type: "file" | "folder" }
 * Real create for /admin/ide's Explorer (owner, 2026-08-05, Phase 3).
 * File is created empty; folder is a single (non-recursive) directory.
 * Path validated via fsSecurity.ts's resolveNewEntryPath() — same
 * exclusion/traversal/symlink checks as every read, plus PATH_CONFLICT if
 * something already exists there.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { IdeFsError, auditFsOpLog, type IdeErrorCode } from "../../_lib/fsSecurity";
import { createFile, createFolder } from "../../_lib/fsOps";

function errorResponse(code: IdeErrorCode, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: IdeErrorCode): number {
  if (code === "NOT_FOUND") return 404;
  if (code === "ACCESS_DENIED") return 403;
  if (code === "PATH_CONFLICT") return 409;
  if (code === "INVALID_PATH" || code === "INVALID_NAME" || code === "PATH_OUTSIDE_WORKSPACE") return 400;
  return 500;
}

export async function POST(req: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  let body: { path?: unknown; type?: unknown };
  try {
    body = await req.json();
  } catch {
    return errorResponse("INVALID_PATH", "invalid JSON body", 400);
  }
  const { path: clientPath, type } = body;
  if (typeof clientPath !== "string") return errorResponse("INVALID_PATH", "path is required", 400);
  if (type !== "file" && type !== "folder") return errorResponse("INVALID_PATH", "type must be 'file' or 'folder'", 400);

  try {
    const result = type === "file" ? await createFile(clientPath) : await createFolder(clientPath);
    auditFsOpLog("create", result.relPath, null, "ok");
    return NextResponse.json({ ok: true, path: result.relPath, type });
  } catch (e) {
    const code = e instanceof IdeFsError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof IdeFsError ? e.message : "unexpected error";
    auditFsOpLog("create", clientPath, null, code);
    return errorResponse(code, message, statusFor(code));
  }
}
