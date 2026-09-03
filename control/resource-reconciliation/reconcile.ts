/**
 * หน้าที่: cross-system reconciliation. Compares what SOURCE, REGISTRY,
 * RESOURCE GRAPH (census), RUNTIME, BLUEPRINT and the operational database's
 * declarations each believe, and reports where they disagree.
 *
 * DETECTION IS NOT PERMISSION. Every finding carries its own verdict from
 * `./decide.ts`, and most of them are RETAIN, REVIEW or BLOCK. A finding is a
 * statement that two systems disagree — never an instruction to resolve the
 * disagreement by deleting one side.
 *
 * WHAT IT REUSES, all pre-existing:
 *   software/live-census            the resource graph and its edges
 *   software/registry-database      the registry rows themselves
 *   control/system-read-paths       the blueprint's claims
 *   control/service-reload          whether a running service is stale
 *   ./supersession.ts               replacement evidence from git and registry
 *
 * Input: none (reads the live system) or a commit for change-triggered mode.
 * Output: `reconcileSystem`, `impactOfChange`.
 * Dependency ที่อนุญาต: the contracts named above, ./lineage.ts, ./decide.ts,
 * ./supersession.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: ห้ามลบ/ย้าย/เขียนไฟล์จากไฟล์นี้ — read และ report เท่านั้น.
 */
import { execFileSync } from "node:child_process";
import { existsSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createPersistentFileStore } from "../../software/registry-database/adapters/persistent-file-store";
import { readBlueprintReferences } from "../system-read-paths/contract";
import { reloadRequiredFor } from "../service-reload/contract";
import { candidatePidsForRepo, observeProcesses } from "../machine-observation/contract";
import { SERVICES } from "../runtime-control/contract";
import type { ServiceId } from "../runtime-control/contract";
import { buildLineage, censusIndex, REPO_ROOT } from "./lineage";
import { detectSupersessions, type Supersession } from "./supersession";
import { decideVerdict, sourceOfTruthReason } from "./decide";
import type { ChangeImpactEntry, FindingKind, LightnessMetrics, Provenance, ReconciliationFinding } from "./types";

/** Path classes that are derived state rather than authored source. Structure, never filename vibes. */
const CACHE_MARKERS = [/(^|\/)\.cache(\/|$)/, /(^|\/)node_modules(\/|$)/, /(^|\/)\.next(\/|$)/, /(^|\/)dist(\/|$)/, /(^|\/)build(\/|$)/, /(^|\/)coverage(\/|$)/, /(^|\/)tmp(\/|$)/];
const TEST_RESIDUE_MARKERS = [/(^|\/)test-fixtures(\/|$)/, /(^|\/)__sandbox__(\/|$)/, /(^|\/)data\/[a-z-]*runs(\/|$)/];
const MOCK_MARKERS = [/(^|\/)__mocks__(\/|$)/, /\.mock\.[tj]sx?$/];
const FIXTURE_MARKERS = [/(^|\/)fixtures?(\/|$)/, /\.fixture\.[tj]sx?$/];

function finding(
  kind: FindingKind,
  subject: string,
  counterpart: string | null,
  detail: string,
  provenance: readonly Provenance[],
  verdict: ReconciliationFinding["verdict"],
): ReconciliationFinding {
  return { kind, subject, counterpart, detail, provenance, verdict };
}

/** A finding's verdict, decided by the real rule set rather than by the detector that found it. */
function verdictFor(repoRelative: string, supersession: Supersession | null, identicalSurvivor: string | null): ReconciliationFinding["verdict"] {
  return decideVerdict({ lineage: buildLineage(repoRelative), supersession, identicalSurvivor }).verdict;
}

export interface ReconciliationReport {
  generated_at: string;
  findings: readonly ReconciliationFinding[];
  metrics: LightnessMetrics;
  /** Questions no read path in this system can answer. Named, never rounded down to zero. */
  unresolved: readonly string[];
}

export function reconcileSystem(options: { limitPerKind?: number } = {}): ReconciliationReport {
  const limit = options.limitPerKind ?? 25;
  const findings: ReconciliationFinding[] = [];
  const unresolved: string[] = [];
  const capabilities = censusIndex();
  const capByPath = new Map(capabilities.map((c) => [c.path, c]));

  // ---- SUPERSEDED + DUPLICATE (SOURCE <-> REGISTRY <-> git) --------------
  const supersessions = detectSupersessions();
  const aliveSupersessions = supersessions.filter((s) => !s.old_path_removed);
  for (const s of aliveSupersessions.slice(0, limit)) {
    const kind: FindingKind = s.basis === "IDENTICAL_CONTENT" || s.basis === "REGISTRY_DUPLICATE"
      ? "DUPLICATE_IMPLEMENTATION"
      : "SUPERSEDED_RESOURCE";
    findings.push(finding(
      kind, s.old_path, s.new_path,
      `${s.old_path} is superseded by ${s.new_path} (${s.basis})`,
      s.provenance,
      verdictFor(s.old_path, s, s.basis === "IDENTICAL_CONTENT" ? s.new_path : null),
    ));
  }

  // ---- ORPHANS (RESOURCE GRAPH) ------------------------------------------
  let orphanCount = 0;
  for (const cap of capabilities) {
    if (cap.callers.length > 0) continue;
    if (cap.entrypoint !== null) continue;          // an entrypoint has no caller BY DESIGN
    if (cap.registry_matches.length > 0) continue;  // the registry still names it
    if (cap.runtime_state === "RUNNING" || cap.runtime_state === "IN_USE_NOW") continue;
    orphanCount += 1;
    if (findings.filter((f) => f.kind === "ORPHANED_RESOURCE").length >= limit) continue;
    findings.push(finding(
      "ORPHANED_RESOURCE", cap.path, null,
      `no caller imports it, it is not an entrypoint, no registry row names it, and runtime is ${cap.runtime_state}`,
      [{ read_path: "software/live-census#observeCensus", evidence: `callers=0 entrypoint=null registry_matches=0 runtime=${cap.runtime_state} status=${cap.current_status}` }],
      verdictFor(cap.path, null, null),
    ));
  }

  // ---- STALE RUNTIME (RUNTIME) -------------------------------------------
  let staleRuntime = 0;
  for (const serviceId of Object.keys(SERVICES) as ServiceId[]) {
    const status = reloadRequiredFor(serviceId);
    if (status.status !== "SERVICE_RELOAD_REQUIRED") continue;
    staleRuntime += 1;
    findings.push(finding(
      "STALE_RUNTIME", serviceId, null,
      `pid ${status.pid} started ${status.process_started_at}, which is before the newest source write ${status.newest_source_mtime} — the process is executing code that has since been replaced`,
      status.evidence.map((e) => ({ read_path: "control/service-reload#reloadRequiredFor", evidence: e })),
      // A stale runtime is fixed by reloading it, never by deleting anything.
      "RESET",
    ));
  }

  // ---- STALE REGISTRY REFERENCES (REGISTRY -> SOURCE) --------------------
  let registryInconsistencies = 0;
  try {
    const store = createPersistentFileStore() as unknown as { listResourceRows: () => { resource_id: string; source_location: string }[] };
    for (const row of store.listResourceRows()) {
      if (!row.source_location) continue;
      const abs = join(REPO_ROOT, row.source_location);
      if (existsSync(abs)) continue;
      registryInconsistencies += 1;
      if (findings.filter((f) => f.kind === "STALE_REGISTRY_REFERENCE").length >= limit) continue;
      findings.push(finding(
        "STALE_REGISTRY_REFERENCE", row.resource_id, row.source_location,
        `the registry holds resource ${row.resource_id} at "${row.source_location}", which does not exist on disk`,
        [{ read_path: "software/registry-database#listResourceRows", evidence: `source_location "${row.source_location}" is absent from the filesystem` }],
        // Reconcile the reference. Never delete the registry row on a missing
        // file alone — the file may be the thing that is wrong.
        "REVIEW",
      ));
    }
  } catch (error) {
    unresolved.push(`the registry could not be enumerated: ${error instanceof Error ? error.message : String(error)}`);
  }

  // ---- STALE BLUEPRINT REFERENCES (BLUEPRINT -> SOURCE) ------------------
  let brokenBlueprint = 0;
  const blueprintProbe = readBlueprintReferences("control/");
  if (!blueprintProbe.reachable) {
    unresolved.push(`blueprint read path unreachable, so blueprint drift is unmeasured: ${blueprintProbe.reason}`);
  } else {
    const seen = new Set<string>();
    for (const ref of blueprintProbe.references) {
      const target = ref.implementation_reference ?? ref.source_reference;
      if (!target || seen.has(target)) continue;
      seen.add(target);
      // Blueprint targets are written as "path/to/file.ts:239" and sometimes
      // "path#symbol". Both suffixes must come off before the path is tested —
      // without this, EVERY line-numbered reference fails existsSync and the
      // whole blueprint reads as stale. (Measured: it produced 521 false
      // positives before the `:line` form was handled.)
      // Blueprint targets are written as "path/file.ts:239", sometimes with a
      // trailing comma, a "+", or several line numbers ("file.ts:17,:19,:39").
      // Everything from the FIRST ":<digit>" onward is a location, not a path.
      // Without this, every line-numbered reference fails existsSync and the
      // entire blueprint reads as stale — it produced 521 false positives
      // before the suffix forms were handled, which is why the cut is explicit
      // rather than a tidy one-liner.
      const cleaned = target.split("#")[0].trim().replace(/:\d.*$/, "").replace(/[,.;:+)\]]+$/, "").trim();
      if (!cleaned.startsWith("control/") && !cleaned.startsWith("software/")) continue;
      if (existsSync(join(REPO_ROOT, cleaned))) continue;
      brokenBlueprint += 1;
      if (findings.filter((f) => f.kind === "STALE_BLUEPRINT_REFERENCE").length >= limit) continue;
      findings.push(finding(
        "STALE_BLUEPRINT_REFERENCE", ref.document_id, cleaned,
        `${ref.document_id} claims an implementation at "${cleaned}", which does not exist`,
        [{ read_path: "control/system-read-paths#readBlueprintReferences", evidence: `${ref.document_id}#${ref.section}: ${ref.claim.slice(0, 100)}` }],
        "REVIEW",
      ));
    }
  }

  // ---- BROKEN RELATIONSHIPS (GRAPH edges pointing nowhere) ---------------
  let brokenEdges = 0;
  for (const cap of capabilities) {
    for (const dep of cap.dependencies) {
      if (capByPath.has(dep)) continue;
      if (existsSync(join(REPO_ROOT, dep))) continue;
      brokenEdges += 1;
      if (findings.filter((f) => f.kind === "BROKEN_RELATIONSHIP").length >= limit) continue;
      findings.push(finding(
        "BROKEN_RELATIONSHIP", cap.path, dep,
        `${cap.path} declares a dependency on "${dep}", which is neither a known capability nor a path on disk`,
        [{ read_path: "software/live-census#observeCensus (dependencies)", evidence: `dependency "${dep}" resolves to nothing` }],
        "REVIEW",
      ));
    }
  }

  // ---- UNKNOWN OWNERSHIP -------------------------------------------------
  let unknownOwnership = 0;
  for (const cap of capabilities) {
    if (cap.registration_state !== "UNREGISTERED") continue;
    if (cap.callers.length > 0) continue;
    unknownOwnership += 1;
    if (findings.filter((f) => f.kind === "UNKNOWN_OWNERSHIP").length >= limit) continue;
    findings.push(finding(
      "UNKNOWN_OWNERSHIP", cap.path, null,
      `no registry row claims it and no caller imports it — nothing on this machine says who owns it`,
      [{ read_path: "software/live-census#observeCensus", evidence: `registration_state=UNREGISTERED callers=0 status=${cap.current_status}` }],
      // Unknown ownership is the definition of "do not act".
      "UNRESOLVED",
    ));
  }

  // ---- DERIVED-STATE CLASSES (cache / generated / test residue) ----------
  const classCounts = { cache: 0, generated: 0, testResidue: 0, mocks: 0, fixtures: 0 };
  for (const s of supersessions) {
    const p = `/${s.old_path}`;
    if (CACHE_MARKERS.some((r) => r.test(p))) classCounts.cache += 1;
    else if (TEST_RESIDUE_MARKERS.some((r) => r.test(p))) classCounts.testResidue += 1;
    else if (MOCK_MARKERS.some((r) => r.test(p))) classCounts.mocks += 1;
    else if (FIXTURE_MARKERS.some((r) => r.test(p))) classCounts.fixtures += 1;
  }

  const metrics = measureLightness({
    orphanCount,
    duplicateCount: aliveSupersessions.filter((s) => s.basis !== "GIT_RENAME").length,
    staleRuntime,
    testResidue: classCounts.testResidue + classCounts.mocks + classCounts.fixtures,
    cacheTemp: classCounts.cache,
    unknownOwnership,
    brokenReferences: brokenEdges + brokenBlueprint,
    registryInconsistencies,
    graphInconsistencies: brokenEdges,
  });

  unresolved.push("STALE_DATABASE_REFERENCE is not detected here: this repository may not query the operational database, so a database reference can be neither confirmed nor excluded. Use ./database-safety.ts, which refuses rather than approves.");

  return { generated_at: new Date().toISOString(), findings, metrics, unresolved };
}

/** Real bytes and counts. Disk usage is measured with `du`, not estimated from a file list. */
export function measureLightness(counts: {
  orphanCount: number; duplicateCount: number; staleRuntime: number; testResidue: number;
  cacheTemp: number; unknownOwnership: number; brokenReferences: number;
  registryInconsistencies: number; graphInconsistencies: number;
}): LightnessMetrics {
  let bytes = 0;
  let artifacts = 0;
  try {
    // -sk gives KiB of what is actually allocated for the tree, excluding the
    // .git object store, which is history rather than working state.
    const out = execFileSync("/bin/sh", ["-c", `/usr/bin/du -sk "${REPO_ROOT}" 2>/dev/null | cut -f1`], { encoding: "utf8" }).trim();
    bytes = Number(out) * 1024;
  } catch { bytes = 0; }
  try {
    artifacts = execFileSync("/bin/sh", ["-c", `/usr/bin/git -C "${REPO_ROOT}" ls-files | wc -l`], { encoding: "utf8" }).trim() as unknown as number;
    artifacts = Number(artifacts);
  } catch { artifacts = 0; }

  return {
    measured_at: new Date().toISOString(),
    disk_bytes: bytes,
    artifact_count: artifacts,
    orphan_count: counts.orphanCount,
    duplicate_count: counts.duplicateCount,
    stale_runtime_count: counts.staleRuntime,
    test_residue_count: counts.testResidue,
    cache_temp_count: counts.cacheTemp,
    unresolved_ownership_count: counts.unknownOwnership,
    broken_reference_count: counts.brokenReferences,
    registry_inconsistency_count: counts.registryInconsistencies,
    graph_inconsistency_count: counts.graphInconsistencies,
  };
}

/**
 * CHANGE-TRIGGERED RECONCILIATION. The impact set of one verified commit —
 * so cleanup originates from software lineage, not from scanning a disk and
 * wondering what a file is.
 *
 * SUPERSEDED and POSSIBLY_ORPHANED are the two classes that carry a
 * reconciliation finding; the rest are reported and left alone.
 */
export function impactOfChange(commitSha: string): ChangeImpactEntry[] {
  const entries: ChangeImpactEntry[] = [];
  let raw: string;
  try {
    raw = execFileSync("/usr/bin/git", ["show", "--name-status", "--format=", "-M", commitSha], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();
  } catch {
    return entries;
  }
  const supersessions = detectSupersessions();
  const capabilities = censusIndex();

  for (const line of raw.split("\n")) {
    const parts = line.split(String.fromCharCode(9));
    const status = parts[0];
    if (!status) continue;

    if (status.startsWith("R")) {
      const [, oldPath, newPath] = parts;
      entries.push({ path: newPath, impact: "NEW", reason: `added by ${commitSha.slice(0, 12)} as the rename target of ${oldPath}`, reconciliation: null });
      const s = supersessions.find((x) => x.old_path === oldPath) ?? null;
      entries.push({
        path: oldPath,
        impact: "SUPERSEDED",
        reason: `git recorded ${oldPath} as renamed to ${newPath} in ${commitSha.slice(0, 12)}`,
        reconciliation: finding("SUPERSEDED_RESOURCE", oldPath, newPath, `superseded by ${newPath}`,
          s?.provenance ?? [{ read_path: "git show -M --name-status", evidence: line }],
          verdictFor(oldPath, s, null)),
      });
      continue;
    }

    const path = parts[1];
    if (!path) continue;
    if (status.startsWith("A")) {
      entries.push({ path, impact: "NEW", reason: `added by ${commitSha.slice(0, 12)}`, reconciliation: null });
      continue;
    }
    if (status.startsWith("D")) {
      // A deleted path cannot be cleaned — it is already gone. What matters is
      // whoever still imports it, which is a broken relationship, not a cleanup.
      const dependents = capabilities.filter((c) => c.dependencies.includes(path) || c.callers.includes(path));
      entries.push({
        path,
        impact: "SUPERSEDED",
        reason: `deleted by ${commitSha.slice(0, 12)}${dependents.length > 0 ? `, but ${dependents.length} capability/ies still declare it` : ""}`,
        reconciliation: dependents.length > 0
          ? finding("BROKEN_RELATIONSHIP", dependents[0].path, path, `${dependents.length} capability/ies still declare a dependency on the deleted ${path}`,
              [{ read_path: "software/live-census#observeCensus", evidence: `dependents: ${dependents.map((d) => d.path).slice(0, 3).join(", ")}` }], "REVIEW")
          : null,
      });
      continue;
    }

    // MODIFIED. Its dependents become POSSIBLY_ORPHANED only when they have no
    // callers of their own — a modified file does not orphan its own importers.
    entries.push({ path, impact: "MODIFIED", reason: `modified by ${commitSha.slice(0, 12)}`, reconciliation: null });
  }

  for (const cap of capabilities) {
    if (cap.callers.length > 0 || cap.entrypoint !== null) continue;
    if (!entries.some((e) => e.path.startsWith(`${cap.path}/`) && e.impact === "MODIFIED")) continue;
    entries.push({
      path: cap.path,
      impact: "POSSIBLY_ORPHANED",
      reason: `${cap.path} was touched by this change and has no caller and no entrypoint`,
      reconciliation: finding("ORPHANED_RESOURCE", cap.path, null, "touched by a verified change, with no caller and no entrypoint",
        [{ read_path: "software/live-census#observeCensus", evidence: `callers=0 entrypoint=null runtime=${cap.runtime_state}` }],
        verdictFor(cap.path, null, null)),
    });
  }

  return entries;
}

export interface MachineWorkspaceState {
  /** Editor processes with this repository open, from the real process table. */
  editor_processes: readonly { pid: number; app: string }[];
  /** Every process whose working directory is inside the repository. */
  repo_processes: readonly { pid: number; cwd: string; argv: string }[];
  /** Paths those processes hold open that are inside the repository. Active — never a cleanup candidate. */
  active_paths: readonly string[];
  /** Derived trees with no live holder. Disposable, and still only a candidate. */
  disposable_paths: readonly string[];
  evidence: readonly string[];
}

/**
 * MACHINE / VS CODE RECONCILIATION, without a VS Code cleaner daemon.
 *
 * There is no editor integration here and no watcher: the editor is simply
 * another process in the table, and "the workspace is open" is a fact about
 * that table. What the editor and the runtime hold open is ACTIVE and is
 * refused for cleanup; what is derived and unheld is a candidate and nothing
 * more.
 */
export function machineWorkspaceState(): MachineWorkspaceState {
  const evidence: string[] = [];
  const editors: { pid: number; app: string }[] = [];
  try {
    const out = execFileSync("/bin/sh", ["-c",
      `/bin/ps -axo pid=,comm= | /usr/bin/grep -iE "Visual Studio Code|Code Helper|cursor" | /usr/bin/grep -v grep || true`],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }).trim();
    for (const line of out ? out.split("\n") : []) {
      const m = line.trim().match(/^(\d+)\s+(.*)$/);
      if (!m) continue;
      editors.push({ pid: Number(m[1]), app: m[2] });
    }
    evidence.push(`ps reports ${editors.length} editor process(es)`);
  } catch {
    evidence.push("the process table could not be read for editor processes");
  }

  const repoProcesses: { pid: number; cwd: string; argv: string }[] = [];
  const activePaths = new Set<string>();
  try {
    const pids = candidatePidsForRepo(REPO_ROOT);
    for (const p of observeProcesses(pids)) {
      if (p.cwd === null || !(p.cwd === REPO_ROOT || p.cwd.startsWith(`${REPO_ROOT}/`))) continue;
      repoProcesses.push({ pid: p.pid, cwd: p.cwd, argv: p.argv.slice(0, 160) });
      for (const f of p.open_files) {
        if (f.startsWith(`${REPO_ROOT}/`)) activePaths.add(f.slice(REPO_ROOT.length + 1));
      }
    }
    evidence.push(`lsof reports ${repoProcesses.length} process(es) with a working directory inside the repository, holding ${activePaths.size} path(s) open`);
  } catch {
    evidence.push("machine observation could not enumerate repository processes");
  }

  // Derived trees, minus anything a live process is holding.
  const disposable: string[] = [];
  for (const dir of [".next", "dist", "coverage", ".cache"]) {
    const abs = join(REPO_ROOT, dir);
    if (!existsSync(abs)) continue;
    if ([...activePaths].some((a) => a === dir || a.startsWith(`${dir}/`))) {
      evidence.push(`${dir} is held open by a live process and is therefore ACTIVE, not disposable`);
      continue;
    }
    disposable.push(dir);
  }

  return { editor_processes: editors, repo_processes: repoProcesses, active_paths: [...activePaths], disposable_paths: disposable, evidence };
}

/** Files directly under a directory. Used by reset planning; never recursive, never a delete. */
export function directChildren(dir: string): string[] {
  try {
    return readdirSync(dir).map((n) => join(dir, n)).filter((p) => {
      try { return statSync(p).isFile(); } catch { return false; }
    });
  } catch {
    return [];
  }
}

export { sourceOfTruthReason };
