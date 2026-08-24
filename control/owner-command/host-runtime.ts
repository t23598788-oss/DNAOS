/**
 * หน้าที่: the ONLY file in this capability folder allowed to touch a real
 * host ambient (`crypto.randomUUID`, `Date`) — same isolation pattern as
 * `../command-router/host-runtime.ts`, `../../connections/github/host-runtime.ts`,
 * and `../../execution/run/host-runtime.ts`.
 *
 * Input: none.
 * Output: `hostRandomId`, `hostNowIso`.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: never widen this file to touch the filesystem or the
 * network — id/time generation only.
 */

/**
 * PHASE 10 BUGFIX (2026-08-19): this file used `declare const crypto`,
 * assuming a global — the exact unreliable pattern
 * `../../execution/file-write/host-runtime.ts`'s own header already
 * documents as broken in this repo's real tsx execution context (no
 * global `crypto`; only reachable via `require("node:crypto")`). Every
 * sibling host-runtime.ts (`../command-router/host-runtime.ts`,
 * `../../connections/github/host-runtime.ts`,
 * `../../execution/run/host-runtime.ts`) already uses the working
 * `require()` form — this file was the one capability that never got
 * that fix, which is why `submitOwnerCommand` had zero real runtime
 * callers until now: the first real call throws
 * `ReferenceError: crypto is not defined` at `hostRandomId()`. Fixed to
 * match the already-proven sibling pattern exactly — no new behavior.
 */
declare const require: (id: string) => unknown;
interface NodeCryptoModule {
  randomUUID(): string;
}
const nodeCrypto = require("node:crypto") as NodeCryptoModule;

export function hostRandomId(): string {
  return nodeCrypto.randomUUID();
}

export function hostNowIso(): string {
  return new Date().toISOString();
}
