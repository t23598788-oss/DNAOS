import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { dataPath } from "./host-runtime";

export function persistJsonl(fileName: string, envName: string, row: unknown): void {
  const file = dataPath(fileName, envName);
  mkdirSync(dirname(file), { recursive: true });
  const prior = existsSync(file) ? readFileSync(file, "utf8") : "";
  writeFileSync(file, `${prior}${JSON.stringify(row)}\n`);
}
