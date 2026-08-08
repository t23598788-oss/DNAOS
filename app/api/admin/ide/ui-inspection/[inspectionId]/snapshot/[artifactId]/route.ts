/**
 * GET /api/admin/ide/ui-inspection/[inspectionId]/snapshot/[artifactId] —
 * real, owner-scoped raw artifact body (JSON snapshot or PNG screenshot)
 * — owner, 2026-08-06, Software Factory Step 6. The [inspectionId] (scan)
 * segment is verified but the real content comes from the Artifact
 * Runtime's own owner-scoped accessor — never a raw filesystem path from
 * the client.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getScanRecord } from "../../../../_lib/browserInspectionRuntime";
import { getArtifact, getArtifactBody, ArtifactError } from "../../../../_lib/artifactRuntime";

export async function GET(_req: Request, { params }: { params: Promise<{ inspectionId: string; artifactId: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { inspectionId: scanId, artifactId } = await params;
  const scan = getScanRecord(scanId, auth.id);
  if (!scan) return NextResponse.json({ ok: false, code: "SCAN_NOT_FOUND", message: "no scan with that id" }, { status: 404 });
  try {
    const artifact = getArtifact(artifactId, auth.id);
    const { buf, mimeType } = getArtifactBody(artifactId, auth.id);
    return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": mimeType, "Content-Length": String(buf.byteLength), "X-Artifact-Checksum": artifact.checksum } });
  } catch (e) {
    const code = e instanceof ArtifactError ? e.code : "INTERNAL_ERROR";
    const status = code === "ARTIFACT_NOT_FOUND" ? 404 : code === "ARTIFACT_NOT_OWNED" ? 403 : 500;
    return NextResponse.json({ ok: false, code, message: e instanceof Error ? e.message : "unexpected error" }, { status });
  }
}
