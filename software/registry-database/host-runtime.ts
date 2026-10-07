/**
 * หน้าที่: the ONLY file in this capability folder allowed to touch a real
 * host ambient (`crypto.randomUUID`, `Date`) — same isolation pattern as
 * `../../control/owner-command/host-runtime.ts`. Plain `node:crypto` ESM
 * import, not `declare const crypto` — see that file's own PHASE 10
 * BUGFIX note for why the global-assuming form is broken under this
 * repo's real `tsx` execution.
 *
 * Input: none.
 * Output: `newId`, `nowIso`, `sha256Hex`.
 * Dependency ที่อนุญาต: none — ambient declarations only.
 * สิ่งที่ห้ามแตะ: never widen this file to touch the filesystem or the
 * network — id/time/hash generation only. `adapters/local-file-store.ts`
 * owns its own filesystem access, it does not go through here.
 */

import { createHash, randomUUID } from "node:crypto";

export function newId(): string {
  return randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
