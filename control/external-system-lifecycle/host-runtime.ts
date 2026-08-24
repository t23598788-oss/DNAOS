/**
 * หน้าที่: the ONLY file in this capability folder allowed to touch a real
 * host ambient (filesystem, clock, crypto) — same isolation pattern as
 * every other folder's own host-runtime.ts in this repo.
 *
 * Input: none.
 * Output: `newEventId`, `nowIso`, `appendLine`, `readLines`, `ensureDir`,
 * `fileExistsOnDisk`.
 * Dependency ที่อนุญาต: none — ambient declarations only.
 * สิ่งที่ห้ามแตะ: never widen this file to touch the network.
 */

import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export function fileExistsOnDisk(path: string): boolean {
  return existsSync(path);
}

export function newEventId(): string {
  return `lifecycle-event-${randomUUID()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function appendLine(path: string, line: string): void {
  ensureDir(dirname(path));
  appendFileSync(path, `${line}\n`, { encoding: "utf8" });
}

export function readLines(path: string): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter((line) => line.trim().length > 0);
}
