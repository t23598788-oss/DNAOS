/**
 * GET /api/admin/ide/governance/rules/[ruleId] — real detail for one rule
 * (owner, 2026-08-06, Software Factory Step 4.5). ruleId is the Governance
 * Runtime's own real id space: plain numbers ("1".."118") from
 * registry/rule-coverage.json, "IRON-1".."IRON-15" for the unnumbered
 * CONSTITUTION.json iron_rules bullets, "RC-1".."RC-11" for the runtime
 * contract's CPU-analogy rules.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getRule } from "../../../_lib/governanceRuntime";

export async function GET(_req: Request, { params }: { params: Promise<{ ruleId: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { ruleId } = await params;
  const rule = getRule(decodeURIComponent(ruleId));
  if (!rule) {
    return NextResponse.json({ ok: false, code: "RULE_NOT_FOUND", message: `no rule with id ${ruleId}` }, { status: 404 });
  }
  return NextResponse.json({ ok: true, rule });
}
