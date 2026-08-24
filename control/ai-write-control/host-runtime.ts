/**
 * หน้าที่: the ONLY file in this capability folder allowed to touch a real
 * host ambient — same isolation pattern as
 * `../command-router/host-runtime.ts` and `../owner-command/host-runtime.ts`.
 *
 * Input: none.
 * Output: `hostRandomId`, `hostNowIso`.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: never widen this file to touch the filesystem or the
 * network — id/time generation only.
 */

/**
 * `declare const crypto` (ambient global) is unreliable under this repo's
 * real tsx/CJS execution context — reproduced and fixed once already in
 * dna-os-circuit/runtime/host-runtime.ts (throws "crypto is not defined"
 * even though the exact same pattern works in some other test files).
 * `require("crypto")` is the reliable fix used there; replicated here.
 */
declare const require: (id: string) => unknown;
interface NodeCryptoModule {
  randomUUID(): string;
}
const nodeCrypto = require("crypto") as NodeCryptoModule;

export function hostRandomId(): string {
  return nodeCrypto.randomUUID();
}

export function hostNowIso(): string {
  return new Date().toISOString();
}
