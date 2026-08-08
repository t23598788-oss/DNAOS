/**
 * GET/POST /api/admin/ide/execution-context — real, persisted Software
 * Factory Execution Context (owner, 2026-08-07, /admin/ide Foundation).
 * GET hydrates the current checkpoint fresh from disk (never a cached
 * in-memory value) — this is what makes it survive a dev-server restart.
 * POST writes a new, real checkpoint (append-only; never overwrites
 * history). ADMIN_TIER, matching every other Factory-state route
 * (factory-workspace/sessions, global-factory, factory-completion).
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getCurrentExecutionContext, writeExecutionContextCheckpoint, listExecutionContextHistory, type ExecutionContextPatch } from "../_lib/executionContextRuntime";

export async function GET(req: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { searchParams } = new URL(req.url);
  const historyLimit = searchParams.get("history");
  const current = getCurrentExecutionContext();
  const history = historyLimit ? listExecutionContextHistory(Math.min(Number(historyLimit) || 20, 200)) : undefined;
  return NextResponse.json({ ok: true, current, history: history ?? null });
}

const PATCHABLE_KEYS: (keyof ExecutionContextPatch)[] = [
  "current_step", "last_completed_step", "step_status", "step_report", "decisions", "owner_constraints",
  "blockers", "unresolved_findings", "dependencies", "next_allowed_action", "next_blocked_action",
  "test_baseline", "evidence_refs", "priorStepsDisclosure",
];

export async function POST(req: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { body = {}; }
  const trigger = typeof body.trigger === "string" && body.trigger.trim() ? body.trigger : "manual checkpoint via /admin/ide";
  // Real, explicit allow-list — ownerApprovals is deliberately excluded
  // here; it can only ever be set via the dedicated /approve route.
  const patch: ExecutionContextPatch = {};
  for (const k of PATCHABLE_KEYS) if (k in body) (patch as Record<string, unknown>)[k] = body[k];
  const checkpoint = await writeExecutionContextCheckpoint(patch, auth.email, auth.id, trigger);
  return NextResponse.json({ ok: true, checkpoint });
}
