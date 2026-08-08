/**
 * GET /api/admin/ide/review/change-sets/[changeSetId]/artifacts — real
 * Artifact list for a Change Set's review, via real Artifact Runtime
 * lineage (owner, 2026-08-06, Software Factory Step 7), owner-only.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getChangeSet, ChangeSetError } from "../../../../_lib/changeSetRuntime";
import { getArtifact } from "../../../../_lib/artifactRuntime";

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
    const cs = getChangeSet(changeSetId, auth.id);
    const artifacts = cs.artifactIds.map((id) => { try { return getArtifact(id, auth.id); } catch { return null; } }).filter((a): a is NonNullable<typeof a> => !!a);
    return NextResponse.json({ ok: true, artifacts });
  } catch (e) {
    const code = e instanceof ChangeSetError ? e.code : "INTERNAL_ERROR";
    return errorResponse(code, e instanceof Error ? e.message : "unexpected error", statusFor(code));
  }
}
