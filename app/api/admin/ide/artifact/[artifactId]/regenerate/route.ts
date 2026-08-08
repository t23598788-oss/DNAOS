/**
 * POST /api/admin/ide/artifact/[artifactId]/regenerate — owner-only
 * (owner, 2026-08-06, Software Factory Step 5). Only real for artifact
 * types whose ArtifactTypeDefinition.supportsRegenerate is true
 * (FACTORY_RESULT/ARCHITECTURE_RESULT/REGISTRY_RESULT/GOVERNANCE_RESULT)
 * — anything else is refused with REGENERATE_NOT_SUPPORTED, never silently
 * faked. The original artifact is never overwritten (Artifact Policy,
 * section 13) — this always creates a NEW, immutable version.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { regenerateArtifact, ArtifactError } from "../../../_lib/artifactRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code === "ARTIFACT_NOT_FOUND") return 404;
  if (code === "ARTIFACT_NOT_OWNED") return 403;
  if (code === "REGENERATE_NOT_SUPPORTED" || code === "NOT_IMPLEMENTED") return 400;
  return 500;
}

export async function POST(_req: Request, { params }: { params: Promise<{ artifactId: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { artifactId } = await params;
  try {
    const artifact = regenerateArtifact(artifactId, auth.email, auth.id);
    return NextResponse.json({ ok: true, artifact });
  } catch (e) {
    const code = e instanceof ArtifactError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof Error ? e.message : "unexpected error";
    return errorResponse(code, message, statusFor(code));
  }
}
