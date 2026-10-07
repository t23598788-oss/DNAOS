/**
 * หน้าที่: type contracts for `control/circuit-breaker/` — pure types,
 * no behavior.
 *
 * Input: none (pure type definitions).
 * Output: `CircuitBreakerOptions`, `CircuitBreakerHandle`, `PollResult`.
 * Dependency ที่อนุญาต: `../agent-host/types.ts` (type only — `ActiveLaunch`).
 * สิ่งที่ห้ามแตะ: never add a field letting a caller pre-supply a
 * violation/kill decision — every field here is only ever produced by
 * `./daemon.ts` actually polling real state.
 */

import type { ActiveLaunch } from "../agent-host/types";

export interface CircuitBreakerOptions {
  /** Poll interval in ms. Default 2000 — see ./daemon.ts. */
  pollIntervalMs?: number;
  /** Mirrors process.env.CIRCUIT_BREAKER_ENFORCE — when false (the default), violations are always reported but never kill a real process (dry-run). */
  enforce?: boolean;
}

export interface CircuitBreakerHandle {
  stop(): void;
}

/** One poll cycle's real result — returned only for tests/diagnostics, never required by a caller. */
export interface PollResult {
  checked_launches: readonly ActiveLaunch[];
  violations_found: number;
  launches_killed: readonly string[];
}
