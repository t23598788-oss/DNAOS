/**
 * POST /api/admin/ide/factory-workspace/sessions — real Workspace
 * Session creation (owner, 2026-08-08, Software Factory Step 13).
 * GET — owner-scoped real Workspace Session list.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { createWorkspaceSession, listWorkspaceSessions, FactoryWorkspaceError } from "../../_lib/factoryWorkspaceRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code === "SESSION_NOT_FOUND") return 404;
  if (code === "SESSION_NOT_OWNED") return 403;
  return 500;
}

export async function POST() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  try {
    const session = createWorkspaceSession(auth.id, auth.email);
    return NextResponse.json({ ok: true, session });
  } catch (e) {
    const code = e instanceof FactoryWorkspaceError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof Error ? e.message : "unexpected error";
    return errorResponse(code, message, statusFor(code));
  }
}

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ ok: true, sessions: listWorkspaceSessions(auth.id) });
}
