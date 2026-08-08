/**
 * GET /api/admin/ide/security/knowledge — real, read-only Security
 * Knowledge Category taxonomy (owner, 2026-08-08, Software Factory Step
 * 13.25). SUPER_ADMIN_ONLY (real Owner tier) — never ADMIN_TIER, never
 * a public route. No Public UI/Workspace/Marketplace ever surfaces this.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { SUPER_ADMIN_ONLY } from "@/core/auth/session";
import { queryKnowledge } from "../../_lib/securityKnowledgeRuntime";

export async function GET(req: Request) {
  const auth = await requireAuth(SUPER_ADMIN_ONLY);
  if (auth instanceof NextResponse) return auth;
  const url = new URL(req.url);
  const category = url.searchParams.get("category") ?? undefined;
  return NextResponse.json({ ok: true, categories: queryKnowledge(category) });
}
