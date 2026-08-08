/**
 * POST /api/admin/ide/owner-command — the real Owner Command Surface
 * entry point (owner, 2026-08-08, /admin/ide gap-closing mission).
 * Never a second AI/Worker/Execution engine: this route first tries the
 * existing, tested, deterministic commandSurfaceRuntime.ts#handleOwnerCommand
 * unchanged (fast, safe path for the patterns it already recognizes —
 * test dispatch, architecture check, repository search). Only when that
 * comes back UNRECOGNIZED or MODIFY_MODULE_HINT (the two cases where the
 * existing router only "points" at another tab instead of doing real
 * work) does this route fall through to factoryWorkspaceRuntime.ts's
 * real runAutoOrchestration(), which composes the SAME existing
 * pipeline functions the manual Factory Workspace tab already uses.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { handleOwnerCommand } from "../_lib/commandSurfaceRuntime";
import { runAutoOrchestration, FactoryWorkspaceError } from "../_lib/factoryWorkspaceRuntime";
import { CodeWorkerError } from "../_lib/codeWorkerRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_NOT_OWNED")) return 403;
  if (code === "CALL_CAP_EXCEEDED") return 429;
  return 500;
}

export async function POST(req: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  let body: { text?: unknown };
  try { body = await req.json(); } catch { body = {}; }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ ok: false, code: "INVALID_REQUEST", message: "real, non-empty text is required" }, { status: 400 });
  if (text.length > 2000) return NextResponse.json({ ok: false, code: "INVALID_REQUEST", message: "text exceeds 2000 chars" }, { status: 400 });

  const fastPathResult = await handleOwnerCommand(text, auth.email, auth.id);
  if (fastPathResult.intent !== "UNRECOGNIZED" && fastPathResult.intent !== "MODIFY_MODULE_HINT") {
    return NextResponse.json({ ok: true, mode: "FAST_PATH", result: fastPathResult });
  }

  try {
    const orchestration = await runAutoOrchestration(text, auth.id, auth.email);
    return NextResponse.json({ ok: true, mode: "AUTO_ORCHESTRATION", orchestration });
  } catch (e) {
    const code = e instanceof FactoryWorkspaceError ? e.code : e instanceof CodeWorkerError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof Error ? e.message : "unexpected error";
    return errorResponse(code, message, statusFor(code));
  }
}
