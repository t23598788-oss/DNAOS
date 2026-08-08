/**
 * GET /api/admin/ide/classification?path=<dir> — real semantic
 * classification for every FILE entry directly inside a directory (owner,
 * 2026-08-05). Mirrors app/api/admin/ide/tree's lazy, one-level-at-a-time
 * shape so the Explorer can request classification for exactly the
 * directory it just expanded, not the whole workspace at once. Read-only,
 * same auth gate as every other /admin/ide route.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { IdeFsError, type IdeErrorCode } from "../_lib/fsSecurity";
import { listDirectory } from "../_lib/tree";
import { classifyFile, CATEGORY_LABELS } from "../_lib/classification";

function errorResponse(code: IdeErrorCode, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const clientPath = req.nextUrl.searchParams.get("path") ?? "";

  try {
    const { entries } = await listDirectory(clientPath);
    const classified = entries
      .filter((e) => e.type === "file")
      .map((e) => {
        const result = classifyFile(e.path);
        return {
          path: e.path,
          category: result.category,
          categoryLabel: CATEGORY_LABELS[result.category],
          capability: result.capability,
          riskLevel: result.riskLevel,
          registered: result.registered,
        };
      });
    return NextResponse.json({ ok: true, entries: classified });
  } catch (e) {
    if (e instanceof IdeFsError) {
      const status = e.code === "NOT_FOUND" ? 404 : e.code === "ACCESS_DENIED" ? 403 : 400;
      return errorResponse(e.code, e.message, status);
    }
    return errorResponse("INTERNAL_ERROR", "unexpected error", 500);
  }
}
