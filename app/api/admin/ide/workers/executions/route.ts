/**
 * GET /api/admin/ide/workers/executions — real, owner-scoped Worker
 * Execution history (owner, 2026-08-08, Software Factory Step 13.6,
 * Section 20). Honestly scoped to CODE_WORKER — the only real Worker
 * type with a real, implemented execution flow this Step.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { listCodeWorkerProposals } from "../../_lib/codeWorkerRuntime";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ ok: true, executions: listCodeWorkerProposals(auth.id) });
}
