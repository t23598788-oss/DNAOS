import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nodeProcess from "node:process";

export function nowIso(): string {
  return new Date().toISOString();
}

export function repoRoot(): string {
  return resolve(join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
}

export function dataPath(fileName: string, envName: string): string {
  return nodeProcess.env[envName] ?? join(repoRoot(), "control/work-production-pipeline/data", fileName);
}

export function fixtureRoot(): string {
  return join(repoRoot(), "control/work-production-pipeline/fixtures");
}

export { nodeProcess as process };
