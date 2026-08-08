/**
 * POST /api/admin/ide/security/execution-gate — real Owner-only
 * Execution Gate request (owner, 2026-08-08, Software Factory Step
 * 13.25, Section 4). SUPER_ADMIN_ONLY (real Owner tier). Always
 * evaluates the real checklist honestly — every real Restricted
 * Capability is currently DECLARED/PARTIAL/NOT_IMPLEMENTED, so this
 * route can mechanically never return ALLOWED-and-executed; it only
 * ever records a real, honest BLOCKED (or checklist-complete ALLOWED
 * with no execution engine to act on it) SECURITY_EXECUTION_GATE_RECORD.
 * GET — owner-scoped real Gate Record history.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { SUPER_ADMIN_ONLY } from "@/core/auth/session";
import { requestSecurityExecution, listSecurityExecutionGateRecords, type SecurityExecutionGateRequest } from "../../_lib/securityExecutionRuntime";

export async function POST(req: Request) {
  const auth = await requireAuth(SUPER_ADMIN_ONLY);
  if (auth instanceof NextResponse) return auth;
  let body: Partial<SecurityExecutionGateRequest>;
  try { body = await req.json(); } catch { body = {}; }

  const request: SecurityExecutionGateRequest = {
    capabilityId: (body.capabilityId ?? "") as SecurityExecutionGateRequest["capabilityId"],
    ownerIntent: typeof body.ownerIntent === "string" ? body.ownerIntent : "",
    authorization: typeof body.authorization === "string" ? body.authorization : "",
    target: (body.target && typeof body.target === "object" ? body.target : {}) as SecurityExecutionGateRequest["target"],
    executionScope: typeof body.executionScope === "string" ? body.executionScope : "",
    riskAssessment: typeof body.riskAssessment === "string" ? body.riskAssessment : "",
    expectedEvidence: Array.isArray(body.expectedEvidence) ? body.expectedEvidence.filter((e): e is string => typeof e === "string") : [],
    rollback: typeof body.rollback === "string" ? body.rollback : "",
    stopCondition: typeof body.stopCondition === "string" ? body.stopCondition : "",
    legalNotice: typeof body.legalNotice === "string" ? body.legalNotice : "",
  };

  const record = requestSecurityExecution(request, auth.id, auth.email);
  return NextResponse.json({ ok: true, record });
}

export async function GET() {
  const auth = await requireAuth(SUPER_ADMIN_ONLY);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ ok: true, records: listSecurityExecutionGateRecords(auth.id) });
}
