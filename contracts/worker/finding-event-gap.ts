/**
 * หน้าที่: track the status of the 4173 → 8790 leg of the loop, and now
 * the 8790-internal DETECTED -> EVALUATED leg. Two updates recorded here:
 *
 * 2026-08-18a: the ingestion runtime went real — DNA-LAB-FILE-INTELLIGENCE's
 * `src/cli.ts` now generates a real `scan_id`, converts every real
 * `Warning` into a `FindingEvent`, and POSTs each to Circuit's real
 * `POST /findings` (`dna-os-circuit/runtime/server.ts` +
 * `finding-receiver.ts`) — live-proven against a real self-scan (238 real
 * findings across 2 real scan_ids, independently cross-checked across
 * both repos' own disk state). `WorkRequest` conversion is still
 * NOT_BUILT — this leg only proves DETECTED arrives, nothing routes yet.
 *
 * 2026-08-18b: `dna-os-circuit/runtime/finding-evaluator.ts` now real —
 * a deterministic classifier moves a finding from DETECTED to EVALUATED
 * with a real, evidence-traceable rule (never an AI guess). See that
 * file's own header for the rules. `TRIAGED`/`ROUTABLE` (human review,
 * routing to a capability) remain NOT_BUILT.
 *
 * Input: none (pure documentation constants).
 * Output: `FINDING_EVENT_CONTRACT_STATUS`, `FINDING_EVENT_RUNTIME_STATUS`,
 * `FINDING_EVALUATION_RUNTIME_STATUS`.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: never flip a status constant here without a real,
 * independently-verified pass backing the change — this file exists
 * specifically so status claims are checkable facts, not narration.
 *
 * NOT_YET_BUILT still: FindingEvent -> WorkRequest conversion, TRIAGED
 * (human review), ROUTABLE (capability routing), any Gateway/worker.
 */

export const FINDING_EVENT_CONTRACT_STATUS = "TYPES_DEFINED" as const;
export const FINDING_EVENT_RUNTIME_STATUS = "BUILT" as const;
export const FINDING_EVALUATION_RUNTIME_STATUS = "BUILT" as const;
export const WORK_REQUEST_CONVERSION_RUNTIME_STATUS = "NOT_BUILT" as const;
