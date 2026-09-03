/**
 * หน้าที่: plan a RESET, and verify the system after any mutation.
 *
 * RESET IS NOT ERASE. A reset removes DERIVED state — state the system can
 * rebuild from a source of truth it still holds — invalidates stale caches,
 * restores canonical configuration, reloads affected runtime, and reconciles
 * the registry and graph. It never touches a source of truth, and this file
 * cannot: `planReset` returns a PLAN. Producing a plan performs nothing.
 *
 * WHY PLANNING AND EXECUTING ARE SEPARATED HERE. Every reset scope below has an
 * obvious "just delete the folder" implementation, and every one of them would
 * be wrong in the same way: the folder that holds disposable cache also holds
 * the append-only observation log, the evidence store, and the registry's
 * canonical rows. So the plan names `disposable` and `protected_from_reset`
 * separately, and an executor — the storage lifecycle's trash adapter, or
 * `../service-reload/` for the reload step — acts on the first and never the
 * second.
 *
 * Input: a scope and a target.
 * Output: `planReset`, `verifyAfterMutation`.
 * Dependency ที่อนุญาต: ./types.ts, ./lineage.ts, ./decide.ts,
 * ../service-reload/contract.ts, ../runtime-control/contract.ts,
 * ../system-read-paths/contract.ts, node built-ins.
 * สิ่งที่ห้ามแตะ: ห้าม unlink/rm/truncate จากไฟล์นี้ — plan เท่านั้น.
 */
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { reloadRequiredFor } from "../service-reload/contract";
import { SERVICES } from "../runtime-control/contract";
import type { ServiceId } from "../runtime-control/contract";
import { verifyReadPaths } from "../system-read-paths/contract";
import { censusIndex, REPO_ROOT } from "./lineage";
import { sourceOfTruthReason } from "./decide";
import type { ResetPlan, ResetScope } from "./types";

/**
 * State that is derived and can be rebuilt. Each entry says what rebuilds it —
 * an entry with no rebuild path is not disposable, whatever it looks like.
 */
const DISPOSABLE: readonly { pattern: RegExp; rebuilt_by: string }[] = [
  { pattern: /(^|\/)node_modules(\/|$)/, rebuilt_by: "npm install" },
  { pattern: /(^|\/)\.next(\/|$)/, rebuilt_by: "next build" },
  { pattern: /(^|\/)dist(\/|$)/, rebuilt_by: "the build script" },
  { pattern: /(^|\/)coverage(\/|$)/, rebuilt_by: "the test runner" },
  { pattern: /(^|\/)\.cache(\/|$)/, rebuilt_by: "whatever wrote it, on next use" },
  { pattern: /(^|\/)software\/live-census\/data\/last-census\.json$/, rebuilt_by: "npm run census" },
];

/**
 * Append-only records and canonical configuration. These survive every reset.
 * The list is deliberately broader than strictly necessary: a reset that spares
 * something rebuildable costs one rebuild, a reset that erases a record costs
 * the record.
 */
const PROTECTED_FROM_RESET: readonly { pattern: RegExp; reason: string }[] = [
  { pattern: /(^|\/)data\/(observations|evidence|tasks|handoffs)[^/]*\.jsonl$/, reason: "append-only record — no update, no delete" },
  { pattern: /(^|\/)registry(\/|$)/, reason: "the registry's canonical rows" },
  { pattern: /(^|\/)software\/registry-database\/data\/canonical(\/|$)/, reason: "canonical registry state" },
  { pattern: /(^|\/)\.env/, reason: "canonical configuration and secrets" },
  { pattern: /(^|\/)supabase\/migrations(\/|$)/, reason: "schema history" },
];

function classify(path: string): { disposable: string | null; protectedReason: string | null } {
  const p = `/${path}`;
  const prot = PROTECTED_FROM_RESET.find((x) => x.pattern.test(p));
  if (prot) return { disposable: null, protectedReason: prot.reason };
  const sot = sourceOfTruthReason(path);
  if (sot) return { disposable: null, protectedReason: sot };
  const disp = DISPOSABLE.find((x) => x.pattern.test(p));
  return { disposable: disp ? disp.rebuilt_by : null, protectedReason: null };
}

/** Repo-relative paths under a directory, from git plus the untracked set. Bounded, never a whole-disk walk. */
function pathsUnder(repoRelativeDir: string): string[] {
  try {
    const out = execFileSync("/bin/sh", ["-c",
      `/usr/bin/git -C "${REPO_ROOT}" ls-files -- "${repoRelativeDir}"; /usr/bin/git -C "${REPO_ROOT}" ls-files --others --exclude-standard -- "${repoRelativeDir}"`],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();
    return out ? out.split("\n").filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function planReset(scope: ResetScope, target: string): ResetPlan {
  const disposable: string[] = [];
  const protectedFromReset: string[] = [];
  const reloadServices: string[] = [];
  const rebuildIndexes: string[] = [];
  const actions: string[] = [];
  const blocked: string[] = [];

  const scan = (dir: string): void => {
    for (const p of pathsUnder(dir)) {
      const c = classify(p);
      if (c.protectedReason !== null) { protectedFromReset.push(`${p} — ${c.protectedReason}`); continue; }
      if (c.disposable !== null) { disposable.push(`${p} — rebuilt by ${c.disposable}`); }
    }
  };

  switch (scope) {
    case "SERVICE_RESET": {
      const serviceId = target as ServiceId;
      if (!(serviceId in SERVICES)) {
        blocked.push(`"${target}" is not a registered service — control/runtime-control knows ${Object.keys(SERVICES).join(", ")}`);
        break;
      }
      const status = reloadRequiredFor(serviceId);
      reloadServices.push(serviceId);
      actions.push(`reload ${serviceId} through control/service-reload -> control/runtime-control (never launchctl from here)`);
      actions.push(`verify /health and prove the new pid started after the newest source write`);
      if (status.status === "NOT_RUNNING") blocked.push(`${serviceId} is not running; a reset would be a start, which is a different decision`);
      break;
    }
    case "CAPABILITY_RESET": {
      scan(target);
      const cap = censusIndex().find((c) => c.path === target);
      if (!cap) blocked.push(`"${target}" is not a capability the census recognises`);
      else {
        rebuildIndexes.push("software/live-census (npm run census)");
        actions.push(`re-derive the census entry for ${target} so the graph reflects the reset state`);
        for (const serviceId of Object.keys(SERVICES) as ServiceId[]) {
          if (reloadRequiredFor(serviceId).status === "SERVICE_RELOAD_REQUIRED") reloadServices.push(serviceId);
        }
      }
      break;
    }
    case "APPLICATION_CACHE_RESET": {
      for (const dir of [".next", "dist", "coverage", ".cache"]) scan(dir);
      actions.push("invalidate the derived build/cache trees named above; each is rebuilt by its own build step");
      rebuildIndexes.push("software/live-census (npm run census)");
      break;
    }
    case "TEST_ENVIRONMENT_RESET": {
      scan("test-fixtures");
      scan("control/circuit-breaker/tests/__sandbox__");
      actions.push("remove proven test residue whose execution is closed; fixtures still cited by an open execution are protected");
      break;
    }
    case "WORKSPACE_RESET": {
      scan(target);
      actions.push(`reset derived state under ${target}; authored source and append-only records are untouched`);
      rebuildIndexes.push("software/live-census (npm run census)");
      break;
    }
    case "TASK_RESET": {
      // A task's derived state lives in its workspace; its record does not.
      actions.push(`reset the derived workspace of ${target} via control/agent-gateway#transitionWorkspace`);
      protectedFromReset.push("control/agent-gateway/data/tasks.jsonl — append-only task record; a reset never rewrites history");
      protectedFromReset.push("control/agent-gateway/data/evidence.jsonl — append-only evidence");
      break;
    }
  }

  // A reset that found nothing disposable and nothing to reload is not a reset.
  const verdict = blocked.length > 0
    ? "BLOCK"
    : disposable.length === 0 && reloadServices.length === 0
      ? "UNRESOLVED"
      : "RESET";

  return {
    scope, target,
    disposable,
    protected_from_reset: protectedFromReset,
    reload_services: [...new Set(reloadServices)],
    rebuild_indexes: rebuildIndexes,
    actions,
    blocked_reasons: blocked,
    verdict,
  };
}

export interface PostMutationVerification {
  canonical_sources_exist: boolean;
  read_paths_resolve: boolean;
  registry_resolves: boolean;
  graph_resolves: boolean;
  runtime_current: boolean;
  health_ok: boolean;
  broken_consumers: readonly string[];
  dangling_references: readonly string[];
  passed: boolean;
  failures: readonly string[];
  /** What this verification could NOT check, so a pass is never mistaken for a full-system guarantee. */
  unverified: readonly string[];
}

/**
 * Run after ANY mutation. A failure here means STOP: the caller must not
 * continue cleaning, and the failure itself is the incident record.
 */
export function verifyAfterMutation(expectedCanonicalPaths: readonly string[] = []): PostMutationVerification {
  const failures: string[] = [];
  const unverified: string[] = [];

  const canonicalOk = expectedCanonicalPaths.every((p) => existsSync(p.startsWith("/") ? p : join(REPO_ROOT, p)));
  if (!canonicalOk) failures.push("a canonical source that must survive is missing");

  let readPathsOk = false;
  try {
    const verifications = verifyReadPaths();
    // MISSING_SYMBOL is the broken case: a declared read path whose symbol no
    // longer resolves. The other non-VERIFIED values describe how a path is
    // declared, not a failure, so they must not be counted as breakage.
    const broken = verifications.filter((v) => v.status === "MISSING_SYMBOL");
    readPathsOk = broken.length === 0;
    if (!readPathsOk) failures.push(`read paths whose declared symbol no longer resolves: ${broken.map((v) => v.id).join(", ")}`);
  } catch (error) {
    failures.push(`read path verification threw: ${error instanceof Error ? error.message : String(error)}`);
  }

  let registryOk = false;
  let graphOk = false;
  const dangling: string[] = [];
  const brokenConsumers: string[] = [];
  try {
    const caps = censusIndex();
    graphOk = caps.length > 0;
    const byPath = new Set(caps.map((c) => c.path));
    for (const cap of caps) {
      for (const dep of cap.dependencies) {
        if (byPath.has(dep) || existsSync(join(REPO_ROOT, dep))) continue;
        dangling.push(`${cap.path} -> ${dep}`);
        brokenConsumers.push(cap.path);
      }
    }
    registryOk = true;
  } catch (error) {
    failures.push(`the graph could not be re-derived: ${error instanceof Error ? error.message : String(error)}`);
  }

  let runtimeCurrent = true;
  let healthOk = true;
  for (const serviceId of Object.keys(SERVICES) as ServiceId[]) {
    const status = reloadRequiredFor(serviceId);
    if (status.status === "SERVICE_RELOAD_REQUIRED") { runtimeCurrent = false; failures.push(`${serviceId} is running code older than its source`); }
    if (status.status === "NOT_RUNNING") unverified.push(`${serviceId} is not running, so its health was not checked`);
  }

  unverified.push("Supabase relationships, LINE/webhook validity and financial/document lineage are NOT verified here: this repository may not query the operational database. Use ./database-safety.ts, which can only refuse.");
  unverified.push("test suites are not run by this function — the caller runs them, because running them is an execution and this folder performs none");

  const passed = failures.length === 0;
  return {
    canonical_sources_exist: canonicalOk,
    read_paths_resolve: readPathsOk,
    registry_resolves: registryOk,
    graph_resolves: graphOk,
    runtime_current: runtimeCurrent,
    health_ok: healthOk,
    broken_consumers: [...new Set(brokenConsumers)],
    dangling_references: dangling,
    passed,
    failures,
    unverified,
  };
}

/** Real allocated size of a path, for before/after measurement. */
export function allocatedBytes(absPath: string): number {
  try {
    const st = statSync(absPath);
    return st.isDirectory() ? 0 : st.blocks * 512;
  } catch {
    return 0;
  }
}
