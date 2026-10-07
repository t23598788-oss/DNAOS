/**
 * หน้าที่: the ONLY file in this capability folder allowed to touch a real
 * host ambient (filesystem, clock) — same isolation pattern as every
 * other folder's own host-runtime.ts in this repo.
 *
 * Input: none.
 * Output: `fileExistsOnDisk`, `nowIso`.
 * Dependency ที่อนุญาต: none — ambient declarations only.
 * สิ่งที่ห้ามแตะ: never widen this file to read file contents or touch
 * the network — existence checks only.
 */

import { existsSync } from "node:fs";

export function fileExistsOnDisk(path: string): boolean {
  return existsSync(path);
}

export function nowIso(): string {
  return new Date().toISOString();
}
