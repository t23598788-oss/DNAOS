/**
 * GET /api/admin/ide/search?q=<text>&path=<relative, optional>
 *
 * Real, read-only, plain-substring text search across the real workspace
 * for /admin/ide's Search panel (owner, 2026-08-05). No shell command, no
 * exec/spawn, no grep/ripgrep. Core logic lives in ../_lib/search.ts
 * (checkpoint refactor, 2026-08-05) so the regression suite exercises the
 * real function, not a re-implementation. Bounded by a result cap, a
 * file-scan cap, and a wall-clock time budget — a truncated result set is
 * reported via `truncated`/`truncation_reason`, not treated as a failure.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { IdeFsError, auditSearchLog, type IdeErrorCode } from "../_lib/fsSecurity";
import { performSearch } from "../_lib/search";

function errorResponse(code: IdeErrorCode, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const q = req.nextUrl.searchParams.get("q") ?? "";
  const clientPath = req.nextUrl.searchParams.get("path") ?? "";

  try {
    const outcome = await performSearch(q, clientPath, req.signal);
    auditSearchLog(q.length, outcome.path, outcome.results.length, outcome.durationMs, outcome.truncated ? (outcome.truncationReason ?? "SEARCH_LIMIT_REACHED") : "ok");
    return NextResponse.json({
      ok: true,
      path: outcome.path,
      results: outcome.results,
      result_count: outcome.results.length,
      files_scanned: outcome.filesScanned,
      truncated: outcome.truncated,
      truncation_reason: outcome.truncationReason,
      duration_ms: outcome.durationMs,
    });
  } catch (e) {
    const code = e instanceof IdeFsError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof IdeFsError ? e.message : "unexpected error";
    auditSearchLog(q.length, clientPath, 0, 0, code);
    const status = code === "NOT_FOUND" ? 404 : code === "ACCESS_DENIED" ? 403 : code === "INVALID_QUERY" ? 400 : 400;
    return errorResponse(code, message, status);
  }
}
