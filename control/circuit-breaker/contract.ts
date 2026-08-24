/**
 * หน้าที่: the public boundary of `control/circuit-breaker/`.
 *
 * Input: re-exports only.
 * Output: `startCircuitBreaker`, `pollOnce` (a single deterministic poll
 * cycle, for tests), plus every type a caller needs.
 * Dependency ที่อนุญาต: ./daemon.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never re-export ./host-runtime.ts here — private implementation.
 */

export { startCircuitBreaker, pollOnce } from "./daemon";
export type { CircuitBreakerHandle, CircuitBreakerOptions, PollResult } from "./types";
