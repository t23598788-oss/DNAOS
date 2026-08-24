/**
 * หน้าที่: the ONLY file in this capability folder allowed to touch a real
 * host ambient (clock, crypto, filesystem existence checks).
 *
 * Input: none.
 * Output: `newReleaseDecisionId`, `nowIso`, `fileExistsOnDisk`.
 * Dependency ที่อนุญาต: none — ambient declarations only.
 * สิ่งที่ห้ามแตะ: never widen this file to spawn a process — this
 * capability never re-runs build/test, only reads already-produced
 * evidence.
 */

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

export function newReleaseDecisionId(): string {
  return `release-decision-${randomUUID()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function fileExistsOnDisk(path: string): boolean {
  return existsSync(path);
}
