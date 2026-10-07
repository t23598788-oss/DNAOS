/**
 * หน้าที่: build the lineage of one artifact by ASKING THE READ PATHS THAT
 * ALREADY EXIST. Every field is attributed to the read path that produced it,
 * and a field no read path answers stays null and is named in `unresolved`.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: derive a relationship from name
 * similarity, adjacent timestamps, a shared working directory, a substring
 * match, or co-occurrence in the same commit alone. Those produce plausible
 * lineage, and plausible lineage is exactly what turns into a wrong deletion.
 *
 * Read paths used (all pre-existing):
 *   software/live-census#observeCensus        capability, consumers, deps, runtime, registry matches
 *   control/realtime-change#resolvePath       resource_id / capability_id via the registry
 *   control/system-read-paths#readBlueprintReferences   architecture references
 *   control/agent-gateway#loadAllTasks        the work that cites this path
 *   control/machine-observation#findProcessesUnderPath  who holds it open right now
 *   git                                        who created it, and when
 *
 * Input: an absolute or repo-relative path.
 * Output: `buildLineage`, `censusIndex`.
 * Dependency ที่อนุญาต: the contracts named above, node built-ins.
 * สิ่งที่ห้ามแตะ: ห้ามเขียนไฟล์, ห้ามแก้ registry, ห้ามเรียก execution ใดๆ.
 */
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { observeCensus, REPOSITORY } from "../../software/live-census/contract";
import type { CapabilityRecord } from "../../software/live-census/contract";
import type { Task } from "../agent-gateway/contract";
import { resolvePath, toRepoRelative } from "../realtime-change/contract";
import { readBlueprintReferences } from "../system-read-paths/contract";
import { loadAllTasks } from "../agent-gateway/contract";
import { findProcessesUnderPath, candidatePidsForRepo } from "../machine-observation/contract";
import { createPersistentFileStore } from "../../software/registry-database/adapters/persistent-file-store";
import type { Provenance, ResourceLineage, ResourceState } from "./types";

export const REPO_ROOT = "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE";

/** Generated/derived locations. Matched on real path structure, never on a filename that "looks" generated. */
const GENERATED_MARKERS = [/\/data\//, /\/dist\//, /\/build\//, /\/\.next\//, /\/coverage\//, /\/node_modules\//];
const TEST_MARKERS = [/\/tests?\//, /\.test\.[tj]sx?$/, /\/test-fixtures\//, /\/fixtures?\//, /\/__mocks__\//, /\.mock\.[tj]sx?$/];

/*
 * PER-PROCESS CACHES.
 *
 * Every one of these is an observation of the whole machine or the whole
 * repository — one lsof pass, one blueprint scan, one task-store read, one
 * census. Re-running them per artifact turned a single lineage lookup into ~60
 * seconds and made a whole-system reconciliation impossible to finish.
 *
 * They are deliberately NOT time-based caches. A reconciliation run must
 * describe ONE instant: if the process table were re-read between artifact #1
 * and artifact #400, the report would mix two different machines and its
 * "active" answers would not be comparable. One snapshot per process is both
 * faster and more correct.
 */
let censusCache: readonly CapabilityRecord[] | null = null;
let blueprintCache: ReturnType<typeof readBlueprintReferences> | null = null;
let tasksCache: Task[] | null = null;
let holdersCache: Map<string, { pid: number; argv: string }[]> | null = null;

function taskIndex(): Task[] {
  if (tasksCache === null) {
    try { tasksCache = loadAllTasks() as Task[]; } catch { tasksCache = []; }
  }
  return tasksCache;
}

function blueprintIndex(): ReturnType<typeof readBlueprintReferences> {
  if (blueprintCache === null) blueprintCache = readBlueprintReferences("");
  return blueprintCache;
}

/** One lsof pass for the whole run: cwd -> the processes sitting in it. */
function holderIndex(): Map<string, { pid: number; argv: string }[]> {
  if (holdersCache !== null) return holdersCache;
  const map = new Map<string, { pid: number; argv: string }[]>();
  try {
    for (const p of findProcessesUnderPath(REPO_ROOT, candidatePidsForRepo(REPO_ROOT))) {
      if (p.cwd === null) continue;
      map.set(p.cwd, [...(map.get(p.cwd) ?? []), { pid: p.pid, argv: p.argv }]);
    }
  } catch { /* observation unavailable — holders stay empty and it is reported */ }
  holdersCache = map;
  return map;
}

/**
 * The census, computed once per process. It is the same derivation the census
 * CLI performs — not a copy of it — so reconciliation and `npm run census`
 * cannot disagree about who depends on what.
 */
export function censusIndex(): readonly CapabilityRecord[] {
  if (censusCache === null) censusCache = observeCensus().capabilities;
  return censusCache;
}

/** The capability whose folder contains this path — longest prefix wins, so a nested capability is not shadowed by its parent. */
function capabilityFor(repoRelative: string, capabilities: readonly CapabilityRecord[]): CapabilityRecord | null {
  let best: CapabilityRecord | null = null;
  for (const cap of capabilities) {
    if (repoRelative === cap.path || repoRelative.startsWith(`${cap.path}/`)) {
      if (best === null || cap.path.length > best.path.length) best = cap;
    }
  }
  return best;
}

/** The commit that introduced this path, from git's own history — never inferred from mtime. */
function creationCommit(repoRelative: string): { sha: string; date: string; subject: string } | null {
  try {
    const out = execFileSync("/usr/bin/git",
      ["log", "--diff-filter=A", "--follow", "--format=%H%x09%aI%x09%s", "-1", "--", repoRelative],
      { cwd: REPO_ROOT, encoding: "utf8" }).trim();
    if (!out) return null;
    const [sha, date, ...rest] = out.split("\t");
    return { sha, date, subject: rest.join("\t") };
  } catch {
    return null;
  }
}

export function buildLineage(inputPath: string): ResourceLineage {
  const abs = isAbsolute(inputPath) ? inputPath : join(REPO_ROOT, inputPath);
  const repoRelative = toRepoRelative(abs);
  const provenance: Provenance[] = [];
  const unresolved: string[] = [];

  // IDENTITY — through the registry's own path resolution, never minted here.
  const resolution = resolvePath(abs, createPersistentFileStore());
  if (resolution.resource) {
    provenance.push({ read_path: "control/realtime-change#resolvePath", evidence: `resource ${resolution.resource.resource_id} via ${resolution.resource.provenance}` });
  } else {
    unresolved.push(`no registered resource covers ${repoRelative}: ${resolution.unresolved.join("; ") || "registry returned no match"}`);
  }

  // CAPABILITY, CONSUMERS, DEPENDENCIES, RUNTIME — from the existing census.
  const capabilities = censusIndex();
  const cap = capabilityFor(repoRelative, capabilities);
  if (cap) {
    provenance.push({ read_path: "software/live-census#observeCensus", evidence: `capability ${cap.capability_key} status=${cap.current_status} runtime=${cap.runtime_state} callers=${cap.callers.length} deps=${cap.dependencies.length}` });
  } else {
    unresolved.push(`${repoRelative} is inside no capability the census recognises`);
  }

  // BLUEPRINT — the architecture documents' own claims about this path, taken
  // from one scan of the whole blueprint rather than one scan per artifact.
  const blueprint = blueprintIndex();
  const blueprintRefs: string[] = [];
  if (blueprint.reachable) {
    for (const ref of blueprint.references) {
      const target = ref.implementation_reference ?? ref.source_reference ?? "";
      if (!target.includes(repoRelative)) continue;
      blueprintRefs.push(`${ref.document_id}#${ref.section}`);
    }
    provenance.push({ read_path: "control/system-read-paths#readBlueprintReferences", evidence: `${blueprintRefs.length} of ${blueprint.references.length} blueprint reference(s) name this path, at revision ${blueprint.references[0]?.revision ?? "n/a"}` });
  } else {
    unresolved.push(`blueprint read path unreachable: ${blueprint.reason}`);
  }

  // WORK — the task that literally names this path. A literal match only; a
  // task that merely happened to run at the same time proves nothing.
  let createdByWork: string | null = null;
  try {
    const tasks = taskIndex();
    const citing = tasks.filter((t: Task) => JSON.stringify(t).includes(repoRelative));
    if (citing.length > 0) {
      createdByWork = citing[0].task_id;
      provenance.push({ read_path: "control/agent-gateway#loadAllTasks", evidence: `${citing.length} task record(s) contain the literal path; earliest is ${citing[0].task_id}` });
    } else {
      unresolved.push("no task record in control/agent-gateway names this path literally");
    }
  } catch {
    unresolved.push("the task store could not be read");
  }

  // CREATION — git's own record.
  const created = creationCommit(repoRelative);
  if (created) {
    provenance.push({ read_path: "git log --diff-filter=A --follow", evidence: `added by ${created.sha.slice(0, 12)} on ${created.date}: ${created.subject}` });
  } else {
    unresolved.push("git has no add-record for this path (untracked, or never committed)");
  }

  // RUNTIME OWNER — a real process holding it, from machine observation.
  let runtimeOwner: string | null = null;
  try {
    // One lsof pass for the whole run (see holderIndex), then a lookup.
    const holders = [...holderIndex().entries()]
      .filter(([cwd]) => cwd === abs || cwd.startsWith(`${abs}/`))
      .flatMap(([, procs]) => procs);
    if (holders.length > 0) {
      runtimeOwner = `pid ${holders[0].pid} ${holders[0].argv.slice(0, 120)}`;
      provenance.push({ read_path: "control/machine-observation#findProcessesUnderPath", evidence: `${holders.length} live process(es) with a working directory at or under this path; first is pid ${holders[0].pid}` });
    }
  } catch {
    unresolved.push("machine observation could not be queried for live holders");
  }

  // STATE — classified from the facts above and from real path structure only.
  const exists = existsSync(abs);
  let state: ResourceState = "UNKNOWN";
  if (!exists) {
    state = "UNKNOWN";
    unresolved.push("the path does not exist on disk");
  } else if (TEST_MARKERS.some((r) => r.test(`/${repoRelative}`))) {
    state = "TEST_RESIDUE";
  } else if (GENERATED_MARKERS.some((r) => r.test(`/${repoRelative}`))) {
    state = "GENERATED";
  } else if (cap && (cap.callers.length > 0 || (cap.runtime_state === "RUNNING" || cap.runtime_state === "IN_USE_NOW") || runtimeOwner !== null)) {
    state = "ACTIVE";
  } else if (cap && cap.duplicates.length > 0) {
    state = "DUPLICATE_IMPLEMENTATION";
  } else if (cap && cap.callers.length === 0 && blueprintRefs.length === 0 && cap.registry_matches.length === 0) {
    state = "ORPHAN_CANDIDATE";
  }

  // WHOSE CONSUMERS ARE THESE? A capability's callers are evidence about the
  // capability's MODULES — importing control/foo can reach any .ts inside it.
  // They are NOT evidence about a data file that happens to sit in the same
  // folder: nothing imports a JSON run-log, and attributing the folder's
  // callers to it makes every generated artifact permanently un-reclaimable for
  // a reason that was never about that artifact. So callers are attributed only
  // to source modules; for everything else the file-specific literal-reference
  // check in ./decide.ts is the protection, and it is the more accurate one.
  const isSourceModule = /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(repoRelative);
  const attributedConsumers = isSourceModule ? (cap?.callers ?? []) : [];
  if (!isSourceModule && (cap?.callers.length ?? 0) > 0) {
    provenance.push({
      read_path: "control/resource-reconciliation/lineage.ts (attribution rule)",
      evidence: `${cap?.callers.length} caller(s) of ${cap?.capability_key} were NOT attributed to this path: it is not a source module, so an import of the capability does not reach it`,
    });
  }

  return {
    path: abs,
    repo_relative_path: repoRelative,
    resource_id: resolution.resource?.resource_id ?? null,
    capability_id: resolution.capability?.capability_id ?? cap?.capability_id ?? null,
    capability_key: cap?.capability_key ?? null,
    repository: REPOSITORY,
    system: "SOURCE",
    created_by_work_id: createdByWork,
    created_by_change_id: created?.sha ?? null,
    created_at: created?.date ?? (exists ? statSync(abs).birthtime.toISOString() : null),
    runtime_owner: runtimeOwner,
    consumers: attributedConsumers,
    dependencies: cap?.dependencies ?? [],
    contracts: cap ? [...cap.input_contract, ...cap.output_contract] : [],
    // No database read path reaches business data from this repository — the
    // root boundary rule forbids it (connections/supabase/README.md). Named as
    // unresolved rather than answered "none", which would be a false negative.
    database_references: [],
    blueprint_references: blueprintRefs,
    replacement_resource: null,
    superseded_by: null,
    last_verified_use: cap?.last_verified ?? null,
    current_state: state,
    evidence_refs: cap?.evidence_references ?? [],
    provenance,
    unresolved: [...unresolved, "database_references: no read path in this repository may query the operational database (root boundary rule), so a database reference can be neither confirmed nor excluded here"],
  };
}

/** Repo-relative, for callers that hold absolute paths. */
export function toRelative(p: string): string {
  return isAbsolute(p) ? relative(REPO_ROOT, p) : p;
}
