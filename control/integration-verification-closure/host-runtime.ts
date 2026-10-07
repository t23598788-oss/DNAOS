import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function repoRoot(): string {
  return resolve(join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
}
