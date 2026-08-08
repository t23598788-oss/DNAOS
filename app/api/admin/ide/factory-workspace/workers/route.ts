/**
 * GET /api/admin/ide/factory-workspace/workers — real Worker Registry
 * listing (owner, 2026-08-08, Software Factory Step 13, Section 7).
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { listWorkers } from "../../_lib/workerRegistry";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ ok: true, workers: listWorkers() });
}
