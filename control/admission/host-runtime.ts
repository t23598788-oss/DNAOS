/**
 * หน้าที่: the ONLY file in this capability folder allowed to touch a real
 * host ambient (`crypto.randomUUID`, `Date`) — same isolation pattern as
 * every other folder's own `host-runtime.ts` in this repo.
 *
 * Input: none.
 * Output: `newAdmissionId`, `nowIso`.
 * Dependency ที่อนุญาต: none — ambient declarations only.
 * สิ่งที่ห้ามแตะ: never widen this file to touch the filesystem, network, or
 * a child process — Admission never executes anything.
 */

import { randomUUID } from "node:crypto";

export function newAdmissionId(): string {
  return `admission-${randomUUID()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
