/**
 * หน้าที่: the ONLY file in this capability folder allowed to touch a real
 * host ambient (`crypto.randomUUID`, `Date`) — same isolation pattern as
 * every other folder's own `host-runtime.ts` in this repo.
 *
 * Input: none.
 * Output: `newExecutionId`, `nowIso`.
 * Dependency ที่อนุญาต: none — ambient declarations only.
 * สิ่งที่ห้ามแตะ: never widen this file to touch the filesystem or network —
 * ./github-dispatch.ts owns the one real network call this capability makes.
 */

import { randomUUID } from "node:crypto";

export function newExecutionId(): string {
  return `execution-${randomUUID()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
