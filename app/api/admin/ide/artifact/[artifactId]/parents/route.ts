/**
 * GET /api/admin/ide/artifact/[artifactId]/parents — real direct parents
 * (owner, 2026-08-06, Software Factory Step 5), owner-only.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getParents, ArtifactError } from "../../../_lib/artifactRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code === "ARTIFACT_NOT_FOUND") return 404;
  if (code === "ARTIFACT_NOT_OWNED") return 403;
  return 500;
}

export async function GET(_req: Request, { params }: { params: Promise<{ artifactId: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { artifactId } = await params;
  try {
    return NextResponse.json({ ok: true, parents: getParents(artifactId, auth.id) });
  } catch (e) {
    const code = e instanceof ArtifactError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof Error ? e.message : "unexpected error";
    return errorResponse(code, message, statusFor(code));
  }
}
