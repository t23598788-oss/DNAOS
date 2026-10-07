/**
 * Ambient helpers for control/ai-client-bridge/.
 */

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

declare const process: { cwd(): string; env: Record<string, string | undefined> };

export function nowIso(): string {
  return new Date().toISOString();
}

export function repoRoot(): string {
  return resolve(join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
}

export function dataPath(fileName: string, envName: string): string {
  return process.env[envName] ?? join(repoRoot(), "control/ai-client-bridge/data", fileName);
}

export function utf8Bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export { dirname, join, resolve };
