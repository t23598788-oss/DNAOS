/**
 * GET /api/admin/ide/security/knowledge — real, read-only Security
 * Knowledge Category taxonomy (owner, 2026-08-08, Software Factory Step
 * 13.25). DISABLED_ROLE_TIER (real Owner tier) — never ADMIN_TIER, never
 * a public route. No Public UI/Workspace/Marketplace ever surfaces this.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { DISABLED_ROLE_TIER } from "@/core/auth/session";
import { queryKnowledge } from "../../_lib/securityKnowledgeRuntime";

export async function GET(req: Request) {
  const auth = await requireAuth(DISABLED_ROLE_TIER);
  if (auth instanceof NextResponse) return auth;
  const url = new URL(req.url);
  const category = url.searchParams.get("category") ?? undefined;
  return NextResponse.json({ ok: true, categories: queryKnowledge(category) });
}
