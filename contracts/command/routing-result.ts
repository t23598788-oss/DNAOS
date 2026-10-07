/**
 * หน้าที่: the result of authorizing + routing a CommandEnvelope. Never a
 * bare boolean — a denial always carries a reason, matching this
 * codebase's own no-silent-failure discipline. Split out 2026-08-14 from
 * command-envelope.ts (they are two distinct responsibilities: the
 * request shape vs. the outcome of processing it) per Owner's
 * consistency instruction.
 *
 * Input: none (pure type definition).
 * Output: `RoutingResult`.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: never collapse the ok:false branch back into a plain
 * boolean — `reason` and `denied_at_stage` are required precisely so a
 * denial is always explainable.
 *
 * NOT_YET_BUILT: produced by ../../control/command-router/ once it
 * exists; stored as part of ../../control/command-status/'s lifecycle
 * state.
 */

export type RoutingResult =
  | { ok: true; routed_to_adapter: string }
  | { ok: false; reason: string; denied_at_stage: "authenticate" | "authorize" | "classify" | "route" };
