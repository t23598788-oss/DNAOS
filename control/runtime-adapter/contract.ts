/**
 * หน้าที่: the public boundary of `control/runtime-adapter/` — the only
 * file another capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9. In
 * practice the ONLY real caller is `execution/run/process-gate.ts`
 * (confinement === "policy").
 *
 * Owner reconciliation (2026-08-24, "Phase 4 — Canonical
 * Reconciliation"): this folder was built concurrently by two sessions
 * and has now been merged into ONE canonical implementation per
 * primitive — see `./CANONICAL_MAP.md` for the full old-component ->
 * canonical-component -> retained-evidence -> retired-component trace.
 * `./policy.ts`/`SandboxPolicy` (the prior competing confinement
 * contract) is deleted, not just unexported — there is exactly one
 * confinement contract (`ConfinementSpec`), one renderer
 * (`buildSeatbeltProfile`), one PTY implementation (`runPtySession`),
 * and one spawn call site (`./host-runtime.ts#spawnConfined`, reached by
 * both `./adapter.ts` and `./pty.ts`).
 *
 * Input: re-exports only.
 * Output: `launchViaRuntimeAdapter`, `buildSeatbeltProfile`,
 * `runPtySession`, plus every type a caller needs.
 * Dependency ที่อนุญาต: ./adapter.ts, ./seatbelt.ts, ./pty.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never re-export `./host-runtime.ts` here — `spawnConfined`
 * must stay private, or a caller could spawn with a hand-written profile
 * and bypass profile-building entirely, the one defect this capability
 * exists to close. Never reintroduce a second confinement contract
 * alongside `ConfinementSpec`.
 */

export { launchViaRuntimeAdapter } from "./adapter";
export type { RuntimeLaunchRequest, RuntimeLaunchResult } from "./adapter";

export { buildSeatbeltProfile, escapeSbplString, MANDATORY_READ_DENY_SUBPATHS } from "./seatbelt";
export { runPtySession, ptyRequiredExecPaths, ptyRequiredExecSubpaths } from "./pty";
export { ConfinementSpecError } from "./types";
export type {
  ConfinementSpec,
  ConfinementSpecErrorCode,
  NetworkPolicy,
  PtyChunk,
  PtySessionRequest,
  PtySessionResult,
  SeatbeltProfile,
} from "./types";
