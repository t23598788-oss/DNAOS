/**
 * GET /api/admin/ide/factory-workspace/sessions/[id]/vscode-dependency —
 * real, per-session VS Code Dependency Measurement (owner, 2026-08-08,
 * Software Factory Step 13, Section 14). Never returns FULL_EXIT — Deploy
 * and Git Push remain real, separate Owner actions this Step.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { computeVSCodeDependencyReport, FactoryWorkspaceError } from "../../../../_lib/factoryWorkspaceRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_NOT_OWNED")) return 403;
  return 500;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;
  try {
    return NextResponse.json({ ok: true, report: computeVSCodeDependencyReport(id, auth.id) });
  } catch (e) {
    const code = e instanceof FactoryWorkspaceError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof Error ? e.message : "unexpected error";
    return errorResponse(code, message, statusFor(code));
  }
}
