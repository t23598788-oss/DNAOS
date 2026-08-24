/**
 * หน้าที่: the single observation entry point — gathers real facts from the host
 * and returns a fully derived `LiveCensus`. Extracted from `./cli.ts` so the CLI
 * and `control/scheduler/` share ONE observation path instead of each growing
 * its own (which is how the four competing registries happened in the first
 * place).
 *
 * Input: none — it observes the real repository.
 * Output: `observeCensus`, `observeObservations`.
 * Dependency ที่อนุญาต: ./derive.ts, ./host-runtime.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never accept a caller-supplied status. Callers get what the
 * repository actually says.
 */

import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import {
  REPO_ROOT, nowIso, discoverCapabilityFolders, codeFilesIn, testFilesFor, sourceDigest, testDigest,
  headCommit, lastCommitFor, isDirty, newestMtime, importersOf, declaredDependencies,
  registryByName, readVerificationLedger, liveRepoProcesses,
} from "./host-runtime";
import { deriveCensus, type Observation } from "./derive";
import type { CapabilityRecord, LiveCensus } from "./types";

export const REPOSITORY = "dna-os-infrastructure";
const SNAPSHOT = join(REPO_ROOT, "software/live-census/data/last-census.json");

export function observeObservations(): Observation[] {
  const at = nowIso();
  const registry = registryByName();
  const runtime = liveRepoProcesses();
  return discoverCapabilityFolders().map((path) => {
    const abs = join(REPO_ROOT, path);
    const code = codeFilesIn(abs);
    return {
      repository: REPOSITORY,
      path,
      code_files: code,
      test_files: testFilesFor(path),
      source_digest: sourceDigest(path),
      test_digest: testDigest(path),
      entrypoint: code.includes("contract.ts") ? `${path}/contract.ts` : code.includes("index.ts") ? `${path}/index.ts` : null,
      last_commit: lastCommitFor(path),
      dirty: isDirty(path),
      newest_mtime: newestMtime(path),
      importers: importersOf(path),
      dependencies: declaredDependencies(path),
      registry_matches: registry.get(path.split("/").slice(1).join("/")) ?? registry.get(path.split("/").pop()!) ?? [],
      runtime_refs: runtime.filter((cmd) => cmd.includes(path)),
      observed_at: at,
    };
  });
}

/** The previous census, used ONLY as a drift baseline — never as authority. */
export function loadPreviousSnapshot(): CapabilityRecord[] {
  if (!existsSync(SNAPSHOT)) return [];
  try {
    return (JSON.parse(readFileSync(SNAPSHOT, "utf8")) as { capabilities?: CapabilityRecord[] }).capabilities ?? [];
  } catch {
    return [];
  }
}

export function observeCensus(): LiveCensus {
  return deriveCensus(REPOSITORY, headCommit(), observeObservations(), readVerificationLedger(), loadPreviousSnapshot());
}

export { SNAPSHOT };
