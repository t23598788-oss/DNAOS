/**
 * หน้าที่: the ONLY file in this capability folder allowed to touch a real
 * host ambient (`crypto.randomUUID`, `Date`) — same isolation pattern as
 * `../../connections/github/host-runtime.ts` and
 * `../../execution/run/host-runtime.ts`, so `./router.ts` never declares
 * an ambient itself.
 *
 * Input: none.
 * Output: `hostRandomId`, `hostNowIso`.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: never widen this file to touch the filesystem or the
 * network — id/time generation only.
 */

/**
 * PHASE 10 BUGFIX (2026-08-19): same fix as
 * `../owner-command/host-runtime.ts` — `declare const crypto` assumes a
 * global that does not exist in this repo's real tsx execution context
 * (see `../../execution/file-write/host-runtime.ts`'s header for why).
 * `routeOwnerCommand()` throws `ReferenceError: crypto is not defined`
 * at this exact line the first time anything calls it with a real
 * command, which is why it had zero real runtime callers until Phase 10.
 * Fixed to the same `require("node:crypto")` form every other
 * host-runtime.ts in this repo already uses.
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
