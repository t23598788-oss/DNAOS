/**
 * GET /api/admin/ide/workers/executions/[id] — real, single Worker
 * Execution (CODE_WORKER proposal) detail (owner, 2026-08-08, Software
 * Factory Step 13.6).
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getCodeWorkerProposal, CodeWorkerError } from "../../../_lib/codeWorkerRuntime";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;
  try {
    return NextResponse.json({ ok: true, execution: getCodeWorkerProposal(id, auth.id) });
  } catch (e) {
    const code = e instanceof CodeWorkerError ? e.code : "INTERNAL_ERROR";
    const status = code === "PROPOSAL_NOT_FOUND" ? 404 : code === "PROPOSAL_NOT_OWNED" ? 403 : 500;
    return NextResponse.json({ ok: false, code, message: e instanceof Error ? e.message : "unexpected error" }, { status });
  }
}
