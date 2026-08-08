/**
 * GET/POST /api/admin/ide/workers/budget — real Execution Budget
 * inspection/initialization (owner, 2026-08-08, Software Factory Step
 * 13.6, Section 10/20).
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getBudgetRecord, initBudget, type ExecutionBudget } from "../../_lib/executionBudgetRuntime";

export async function GET(req: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const url = new URL(req.url);
  const workspaceSessionId = url.searchParams.get("workspaceSessionId");
  const stepId = url.searchParams.get("stepId");
  if (!workspaceSessionId || !stepId) return NextResponse.json({ ok: false, code: "INVALID_REQUEST", message: "real workspaceSessionId and stepId query params are required" }, { status: 400 });
  return NextResponse.json({ ok: true, budget: getBudgetRecord(workspaceSessionId, stepId) });
}

export async function POST(req: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  let body: { workspaceSessionId?: unknown; stepId?: unknown; budget?: unknown };
  try { body = await req.json(); } catch { body = {}; }
  const workspaceSessionId = typeof body.workspaceSessionId === "string" ? body.workspaceSessionId : "";
  const stepId = typeof body.stepId === "string" ? body.stepId : "";
  if (!workspaceSessionId || !stepId) return NextResponse.json({ ok: false, code: "INVALID_REQUEST", message: "real workspaceSessionId and stepId are required" }, { status: 400 });
  const budgetPatch = (body.budget && typeof body.budget === "object" ? body.budget : {}) as Partial<ExecutionBudget>;
  const record = initBudget(workspaceSessionId, stepId, budgetPatch);
  return NextResponse.json({ ok: true, budget: record });
}
