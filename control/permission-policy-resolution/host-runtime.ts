/**
 * หน้าที่: the ONLY file in this capability folder allowed to touch a real
 * host ambient (`crypto.randomUUID`, `Date`) — same isolation pattern as
 * `../owner-command/host-runtime.ts` and
 * `../../software/registry-database/host-runtime.ts`. Plain `node:crypto`
 * ESM import, not `declare const crypto`.
 *
 * Input: none.
 * Output: `newPolicyDecisionId`, `nowIso`.
 * Dependency ที่อนุญาต: none — ambient declarations only.
 * สิ่งที่ห้ามแตะ: never widen this file to touch the filesystem or network.
 */

import { randomUUID } from "node:crypto";

export function newPolicyDecisionId(): string {
  return `policy-decision-${randomUUID()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
