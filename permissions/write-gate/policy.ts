/**
 * หน้าที่: `evaluateWriteIntent()` — the single public entrypoint, same
 * pattern as `../execution-policy/policy.ts`. Runs ./rules.ts in fixed
 * order, stops at the first terminal outcome, always returns a fully
 * evidenced `WriteGateDecision` — never throws. Owner, 2026-08-19:
 * "UNKNOWN ต้อง fail-closed และห้ามเข้าสู่ write execution" — enforced here
 * by `execution/file-write/executor.ts` only ever proceeding on
 * `ALLOW_CREATE`/`ALLOW_MODIFY`, never `UNKNOWN`/`DENY`/`REUSE_EXISTING`.
 *
 * Input: `WriteIntent`, `WriteGateContext`, optional `nowIso`.
 * Output: `WriteGateDecision` — always, even on internal error (fail-closed:
 * a caught exception becomes DENY, never an unhandled throw a caller might
 * mistake for "unknown, so allow").
 * Dependency ที่อนุญาต: ./rules.ts, ./evidence.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never let a rule other than `ruleRegistryLookup` decide
 * ALLOW_CREATE/ALLOW_MODIFY/REUSE_EXISTING. Never call this from
 * `control/ai-write-control/` or `execution/file-write/`'s own module —
 * the caller (a future transport) resolves `WriteGateContext` and calls
 * this directly.
 *
 * NOT_YET_BUILT: no runtime caller yet — see ./tests/policy.test.ts.
 */

import { fail } from "./evidence";
import { ruleRegistryLookup, ruleWellFormedIntent } from "./rules";
import type { WriteGateContext, WriteGateDecision, WriteGateDecisionValue, WriteIntent } from "./types";

declare const require: (id: string) => unknown;
interface NodeCryptoModule {
  randomUUID(): string;
}
const nodeCrypto = require("crypto") as NodeCryptoModule;

function nowIsoDefault(): string {
  return new Date().toISOString();
}

function terminal(
  intent: WriteIntent,
  decision: WriteGateDecisionValue,
  reasonCode: string,
  evidenceTrail: WriteGateDecision["evidence"][number][],
  canonical: WriteGateDecision["canonical"],
): WriteGateDecision {
  return {
    decision,
    intent_id: intent.intent_id,
    reason_codes: [reasonCode],
    evidence: evidenceTrail,
    canonical,
    decision_id: nodeCrypto.randomUUID(),
    correlation_id: intent.correlation_id,
    decided_at: nowIsoDefault(),
  };
}

export function evaluateWriteIntent(intent: WriteIntent, context: WriteGateContext): WriteGateDecision {
  const evidenceTrail: WriteGateDecision["evidence"][number][] = [];

  try {
    const step1 = ruleWellFormedIntent(intent);
    evidenceTrail.push(step1.evidence);
    if (step1.kind !== "continue") return terminal(intent, step1.kind, step1.reason_code, evidenceTrail, step1.canonical);

    const step2 = ruleRegistryLookup(intent, context);
    evidenceTrail.push(step2.evidence);
    if (step2.kind === "continue") {
      return terminal(intent, "ALLOW_CREATE", "NO_EXISTING_OVERLAP", evidenceTrail, null);
    }
    return terminal(intent, step2.kind, step2.reason_code, evidenceTrail, step2.canonical);
  } catch (error) {
    evidenceTrail.push(fail("policy_evaluation", "internal", "no exception", error instanceof Error ? error.message : String(error)));
    // Fail-closed, same discipline as permissions/execution-policy/policy.ts — an internal
    // error is never treated as UNKNOWN-so-maybe-allow; it is DENY.
    return terminal(intent, "DENY", "POLICY_EVALUATION_ERROR", evidenceTrail, null);
  }
}
