/**
 * GET /api/admin/ide/artifact/list — owner-scoped real Artifact list
 * (owner, 2026-08-06, Software Factory Step 5). Optional ?type=/?status=
 * filters. No mock data — only artifacts a real producer actually created.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { listArtifacts, type ArtifactStatus } from "../../_lib/artifactRuntime";
import { type ArtifactType } from "../../_lib/artifactRegistry";

const VALID_STATUSES: ArtifactStatus[] = ["PENDING", "READY", "FAILED", "ARCHIVED", "INVALID"];

export async function GET(req: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const status = url.searchParams.get("status");
  if (status && !VALID_STATUSES.includes(status as ArtifactStatus)) {
    return NextResponse.json({ ok: false, code: "INVALID_STATUS", message: `status must be one of ${VALID_STATUSES.join(", ")}` }, { status: 400 });
  }
  const artifacts = listArtifacts(auth.id, { artifactType: (type as ArtifactType) || undefined, status: (status as ArtifactStatus) || undefined });
  return NextResponse.json({ ok: true, artifacts });
}
