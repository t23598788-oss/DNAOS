/**
 * หน้าที่: the Internal Control Agent — Owner, 2026-08-19: "Internal
 * Control Agent มีหน้าที่แปลงคำขอจาก AI ภายนอกเป็น structured WriteIntent
 * เท่านั้น ห้ามเป็นผู้อนุญาตการเขียนเอง". Turns a `RawWriteRequest` from an
 * `ai_agent`/`external_program` Identity into a real `WriteIntent`
 * (`contracts/write-intent/write-intent.ts`) — structural validation only,
 * never a policy/permission decision. `permissions/write-gate/` is the
 * only module ever allowed to produce an ALLOW/DENY-shaped answer.
 *
 * This is a SEPARATE capability boundary from `control/owner-command/` by
 * Owner's explicit lock (2026-08-19): "ห้ามแก้ boundary ของ
 * control/owner-command/... ห้ามขยายให้รับ ai_agent หรือ
 * external_program". `control/owner-command/` stays the human-only Owner
 * surface exactly as it was; this file is the ai_agent/external_program
 * counterpart, structurally forbidden from accepting `kind: "human"`.
 *
 * Input: `RawWriteRequest` (./types.ts) + the requesting `EnvelopeIdentity`
 * (must be `kind: "ai_agent"` or `"external_program"` — asserted by the
 * caller, same trust boundary `control/owner-command/` already uses for
 * `kind: "human"`).
 * Output: `SubmitWriteRequestOutcome` — `{ok:true, intent: WriteIntent}` or
 * `{ok:false, reason}`. Never a `WriteGateDecision`.
 * Dependency ที่อนุญาต: `../../contracts/write-intent/write-intent.ts`,
 * `../../contracts/identity/envelope-identity.ts`, ./types.ts,
 * ./host-runtime.ts.
 * สิ่งที่ห้ามแตะ: never import `../../permissions/write-gate/` here — this
 * folder produces intents, it never evaluates them. Never accept
 * `issued_by.kind === "human"` — that caller belongs in
 * `../owner-command/`, never here. Never let `submitWriteRequest` return
 * anything resembling ALLOW/DENY.
 *
 * NOT_YET_BUILT: no runtime transport (the "DNA OS Control API" from
 * Owner's architecture diagram) wires a real external AI call into
 * `submitWriteRequest` yet — see ./tests/ai-write-control.test.ts, which
 * drives this module directly by hand, same pattern as every other
 * NOT_YET_BUILT transport boundary in this repo.
 */

import type { EnvelopeIdentity } from "../../contracts/identity/envelope-identity";
import type { WriteIntent } from "../../contracts/write-intent/write-intent";
import type { RawWriteRequest } from "./types";
import { hostNowIso, hostRandomId } from "./host-runtime";

const VALID_OPERATIONS = new Set(["CREATE", "MODIFY", "DELETE", "MOVE", "RENAME"]);
const VALID_TARGET_TYPES = new Set(["FILE", "MODULE", "FUNCTION", "API", "TABLE", "CONTRACT", "CAPABILITY"]);

export type SubmitWriteRequestOutcome = { ok: true; intent: WriteIntent } | { ok: false; reason: string };

/**
 * The single public entry point. Structural validation only — never
 * evaluates whether the write should happen, only whether the REQUEST is
 * well-formed enough to become a real WriteIntent.
 */
export function submitWriteRequest(raw: RawWriteRequest, requestingIdentity: EnvelopeIdentity): SubmitWriteRequestOutcome {
  if (requestingIdentity.kind !== "ai_agent" && requestingIdentity.kind !== "external_program") {
    return {
      ok: false,
      reason: `control/ai-write-control/ only accepts identity.kind "ai_agent" or "external_program", got "${requestingIdentity.kind}" — a human Owner request must go through control/owner-command/, never this folder`,
    };
  }
  if (!VALID_OPERATIONS.has(raw.operation)) {
    return { ok: false, reason: `unknown operation "${raw.operation}" — must be one of CREATE|MODIFY|DELETE|MOVE|RENAME` };
  }
  if (!VALID_TARGET_TYPES.has(raw.target_type)) {
    return { ok: false, reason: `unknown target_type "${raw.target_type}" — must be one of FILE|MODULE|FUNCTION|API|TABLE|CONTRACT|CAPABILITY` };
  }
  if (typeof raw.capability !== "string" || raw.capability.length === 0) {
    return { ok: false, reason: "capability must be a non-empty string" };
  }
  if (typeof raw.target_path !== "string" || raw.target_path.length === 0) {
    return { ok: false, reason: "target_path must be a non-empty string" };
  }
  if (typeof raw.requested_change !== "string" || raw.requested_change.length === 0) {
    return { ok: false, reason: "requested_change must be a non-empty string" };
  }

  const correlationId = hostRandomId();
  const intent: WriteIntent = {
    intent_id: `wi_${hostRandomId()}`,
    operation: raw.operation,
    capability: raw.capability,
    target_type: raw.target_type,
    target_path: raw.target_path,
    requested_change: raw.requested_change,
    requesting_agent: {
      identity_id: requestingIdentity.identity_id,
      kind: requestingIdentity.kind,
      display_name: requestingIdentity.software_id,
    },
    evidence: raw.evidence ?? [],
    correlation_id: correlationId,
    submitted_at: hostNowIso(),
  };

  return { ok: true, intent };
}
