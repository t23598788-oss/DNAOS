/**
 * GET /api/admin/ide/factory-completion — real, live-computed Factory
 * Completion Report (owner, 2026-08-07, Software Factory Step 10.5).
 * Reuses factoryCompletionRuntime.ts only — no new Runtime/Queue/
 * Artifact/Evidence Store (Rule 103).
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { buildFactoryCompletionReport } from "../_lib/factoryCompletionRuntime";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const report = buildFactoryCompletionReport();
  return NextResponse.json({ ok: true, report });
}
