/**
 * GET /api/admin/ide/artifact/integrity — real Artifact Integrity findings
 * (owner, 2026-08-06, Software Factory Step 5): checksum, broken link,
 * missing parent/child, duplicate, orphan, unknown producer. Report-only —
 * never auto-fixes anything.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { checkIntegrity } from "../../_lib/artifactRuntime";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ ok: true, findings: checkIntegrity(auth.id) });
}
