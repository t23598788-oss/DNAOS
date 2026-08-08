/**
 * GET /api/admin/ide/artifact/events — real Artifact Runtime events
 * (ARTIFACT_CREATED/UPDATED/FAILED/LINKED/ARCHIVED/INVALID), owner,
 * 2026-08-06, Software Factory Step 5.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { listArtifactEvents } from "../../_lib/artifactRuntime";

export async function GET(req: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const url = new URL(req.url);
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.min(2000, Math.max(1, parseInt(limitParam, 10) || 200)) : 200;
  return NextResponse.json({ ok: true, events: listArtifactEvents(limit) });
}
