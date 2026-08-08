/**
 * GET /api/admin/ide/governance/summary — real, live-computed Governance
 * Coverage Summary (owner, 2026-08-06, Software Factory Step 4.5). Also
 * accepts ?status=ENFORCED|DECLARED_NOT_ENFORCED|... to list rules of one
 * status, and no query for just the summary + ghost findings.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { computeAllRules, computeCoverageSummary, findGhostFindings, type RuleStatus } from "../../_lib/governanceRuntime";

const VALID_STATUSES: RuleStatus[] = ["ENFORCED", "DECLARED_NOT_ENFORCED", "NOT_IMPLEMENTED", "DEPRECATED", "GHOST", "UNKNOWN"];

export async function GET(req: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const statusFilter = url.searchParams.get("status");
  if (statusFilter && !VALID_STATUSES.includes(statusFilter as RuleStatus)) {
    return NextResponse.json({ ok: false, code: "INVALID_STATUS", message: `status must be one of ${VALID_STATUSES.join(", ")}` }, { status: 400 });
  }

  const summary = computeCoverageSummary();
  const rules = statusFilter ? computeAllRules().filter((r) => r.status === statusFilter) : undefined;
  const ghostFindings = findGhostFindings();

  return NextResponse.json({ ok: true, summary, rules, ghostFindings });
}
