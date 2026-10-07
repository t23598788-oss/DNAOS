import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { dataPath } from "./host-runtime";
import type { GithubGovernanceDiscoveryV1 } from "./types";

function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  const rows: T[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line) as T); } catch { /* skip */ }
  }
  return rows;
}

let lastDiscovery: GithubGovernanceDiscoveryV1 | null = null;

export function resetGovernanceMemory(): void {
  lastDiscovery = null;
}

export function lastGithubGovernanceDiscovery(): GithubGovernanceDiscoveryV1 | null {
  if (lastDiscovery) return lastDiscovery;
  const rows = readJsonl<GithubGovernanceDiscoveryV1>(dataPath("discoveries.jsonl", "GITHUB_GOVERNANCE_DISCOVERY_LOG"));
  lastDiscovery = rows.at(-1) ?? null;
  return lastDiscovery;
}

export function persistGithubGovernanceDiscovery(row: GithubGovernanceDiscoveryV1): GithubGovernanceDiscoveryV1 {
  lastDiscovery = row;
  const file = dataPath("discoveries.jsonl", "GITHUB_GOVERNANCE_DISCOVERY_LOG");
  mkdirSync(dirname(file), { recursive: true });
  const prior = existsSync(file) ? readFileSync(file, "utf8") : "";
  writeFileSync(file, `${prior}${JSON.stringify(row)}\n`);
  return row;
}
