/**
 * GET /api/admin/ide/review/change-sets/[changeSetId] — real Change Set
 * detail, owner-only (owner, 2026-08-06, Software Factory Step 7).
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getChangeSet, ChangeSetError } from "../../../_lib/changeSetRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code === "CHANGE_SET_NOT_FOUND") return 404;
  if (code === "CHANGE_SET_NOT_OWNED") return 403;
  return 500;
}

export async function GET(_req: Request, { params }: { params: Promise<{ changeSetId: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { changeSetId } = await params;
  try {
    return NextResponse.json({ ok: true, changeSet: getChangeSet(changeSetId, auth.id) });
  } catch (e) {
    const code = e instanceof ChangeSetError ? e.code : "INTERNAL_ERROR";
    return errorResponse(code, e instanceof Error ? e.message : "unexpected error", statusFor(code));
  }
}
