/**
 * GET /api/admin/ide/ui-inspection/[inspectionId]/artifacts — real
 * Artifact list for one scan, via the real Artifact Pipeline lineage
 * (manifest artifact's real descendants) — owner, 2026-08-06, Software
 * Factory Step 6. Never a second artifact store.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getScanRecord } from "../../../_lib/browserInspectionRuntime";
import { computeLineage, getArtifact } from "../../../_lib/artifactRuntime";

export async function GET(_req: Request, { params }: { params: Promise<{ inspectionId: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { inspectionId: scanId } = await params;
  const scan = getScanRecord(scanId, auth.id);
  if (!scan) return NextResponse.json({ ok: false, code: "SCAN_NOT_FOUND", message: "no scan with that id" }, { status: 404 });
  try {
    const manifest = getArtifact(scan.manifestArtifactId, auth.id);
    const { descendants } = computeLineage(scan.manifestArtifactId, auth.id);
    const artifacts = [manifest, ...descendants.map((d) => { try { return getArtifact(d.artifactId, auth.id); } catch { return null; } }).filter((a): a is NonNullable<typeof a> => !!a)];
    return NextResponse.json({ ok: true, artifacts });
  } catch {
    return NextResponse.json({ ok: false, code: "ARTIFACT_NOT_FOUND", message: "scan manifest artifact not found" }, { status: 404 });
  }
}
