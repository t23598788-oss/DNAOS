/**
 * GET /api/admin/ide/governance/rules — real, live-computed list of every
 * rule this Governance Runtime tracks (owner, 2026-08-06, Software Factory
 * Step 4.5). Optional ?status= and ?source= filters.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { computeAllRules, type RuleStatus, type RuleSource } from "../../_lib/governanceRuntime";

const VALID_STATUSES: RuleStatus[] = ["ENFORCED", "DECLARED_NOT_ENFORCED", "NOT_IMPLEMENTED", "DEPRECATED", "GHOST", "UNKNOWN"];
const VALID_SOURCES: RuleSource[] = ["rule-coverage", "uncovered", "iron-rule", "runtime-contract"];

export async function GET(req: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const statusFilter = url.searchParams.get("status");
  const sourceFilter = url.searchParams.get("source");
  if (statusFilter && !VALID_STATUSES.includes(statusFilter as RuleStatus)) {
    return NextResponse.json({ ok: false, code: "INVALID_STATUS", message: `status must be one of ${VALID_STATUSES.join(", ")}` }, { status: 400 });
  }
  if (sourceFilter && !VALID_SOURCES.includes(sourceFilter as RuleSource)) {
    return NextResponse.json({ ok: false, code: "INVALID_SOURCE", message: `source must be one of ${VALID_SOURCES.join(", ")}` }, { status: 400 });
  }

  let rules = computeAllRules();
  if (statusFilter) rules = rules.filter((r) => r.status === statusFilter);
  if (sourceFilter) rules = rules.filter((r) => r.source === sourceFilter);

  return NextResponse.json({ ok: true, rules });
}
