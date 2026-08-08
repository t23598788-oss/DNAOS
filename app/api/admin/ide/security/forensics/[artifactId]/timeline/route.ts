/**
 * GET /api/admin/ide/security/forensics/[artifactId]/timeline — real,
 * read-only Digital Forensics timeline over the real Artifact lineage
 * (owner, 2026-08-08, Software Factory Step 13.25, Section 9).
 * SUPER_ADMIN_ONLY (real Owner tier).
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { SUPER_ADMIN_ONLY } from "@/core/auth/session";
import { buildForensicTimeline } from "../../../../_lib/digitalForensicsRuntime";
import { ArtifactError } from "../../../../_lib/artifactRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}

export async function GET(_req: Request, ctx: { params: Promise<{ artifactId: string }> }) {
  const auth = await requireAuth(SUPER_ADMIN_ONLY);
  if (auth instanceof NextResponse) return auth;
  const { artifactId } = await ctx.params;
  try {
    return NextResponse.json({ ok: true, timeline: buildForensicTimeline(artifactId, auth.id) });
  } catch (e) {
    const code = e instanceof ArtifactError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof Error ? e.message : "unexpected error";
    const status = code === "ARTIFACT_NOT_FOUND" ? 404 : code === "ARTIFACT_NOT_OWNED" ? 403 : 500;
    return errorResponse(code, message, status);
  }
}
