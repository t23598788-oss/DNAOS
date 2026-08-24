/**
 * หน้าที่: the ONLY file in this capability folder allowed to touch a real
 * host ambient (`crypto.randomUUID`, `Date`) — same isolation pattern as
 * every other folder's own `host-runtime.ts` in this repo.
 *
 * Input: none.
 * Output: `newExplainResourceId`, `nowIso`.
 * Dependency ที่อนุญาต: none — ambient declarations only.
 * สิ่งที่ห้ามแตะ: never widen this file to touch the filesystem or network.
 */

import { randomUUID } from "node:crypto";

export function newTaskId(): string {
  return `task-${randomUUID()}`;
}

export function newEvidenceId(): string {
  return `evidence-explain-resource-${randomUUID()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
