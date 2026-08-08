/**
 * GET /api/admin/ide/factory-workspace/capabilities/search?q=... — real,
 * deterministic ad-hoc Capability search against the real, frozen
 * 202-capability registry (owner, 2026-08-08, Software Factory Step 13,
 * Section 4). Standalone lookup — does not require a Workspace Session.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { resolveCapabilities } from "../../../_lib/capabilityResolverRuntime";
import { proposeStructuredIntentFromRaw } from "../../../_lib/intentRuntime";

export async function GET(req: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  if (!q.trim()) return NextResponse.json({ ok: false, code: "INVALID_REQUEST", message: "real query string 'q' is required" }, { status: 400 });
  const structured = proposeStructuredIntentFromRaw(q);
  const report = resolveCapabilities(structured);
  return NextResponse.json({ ok: true, report });
}
