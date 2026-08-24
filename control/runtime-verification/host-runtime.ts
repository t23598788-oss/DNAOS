/**
 * หน้าที่: the ONLY file in this capability folder allowed to touch a real
 * host ambient (filesystem, clock).
 *
 * Input: none.
 * Output: `statOrNull`, `nowIso`.
 * Dependency ที่อนุญาต: none — ambient declarations only.
 * สิ่งที่ห้ามแตะ: never widen this file to read file contents, spawn a
 * process, or make a network call.
 */

import { statSync } from "node:fs";

export function statOrNull(path: string): { mtimeMs: number } | null {
  try {
    const stat = statSync(path);
    return { mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
