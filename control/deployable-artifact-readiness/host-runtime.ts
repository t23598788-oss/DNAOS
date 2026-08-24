/**
 * หน้าที่: the ONLY file in this capability folder allowed to touch a real
 * host ambient (`crypto.randomUUID`, `Date`) — same isolation pattern as
 * every other folder's own `host-runtime.ts` in this repo.
 *
 * Input: none.
 * Output: `newBuildId`, `newArtifactId`, `newReadinessId`, `nowIso`.
 * Dependency ที่อนุญาต: none — ambient declarations only.
 */

import { randomUUID } from "node:crypto";

export function newBuildId(): string {
  return `build-${randomUUID()}`;
}

export function newArtifactId(): string {
  return `artifact-${randomUUID()}`;
}

export function newReadinessId(): string {
  return `readiness-${randomUUID()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
