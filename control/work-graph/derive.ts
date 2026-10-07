/**
 * หน้าที่: derives the WORK GRAPH from a Live Census. Pure — takes census
 * records plus the set of currently-held write boundaries, returns work items
 * with their states. No I/O, so `./tests/work-graph.test.ts` can prove the
 * branch-isolation property exhaustively.
 *
 * THE PROPERTY THAT MATTERS: state is derived PER ITEM from that item's own
 * dependencies. A BLOCKED item therefore cannot block an item that does not
 * depend on it — not by convention, but because nothing in `deriveState` can
 * see unrelated items. This is what replaces sequential global phases.
 *
 * Input: `readonly CapabilityRecord[]` + held write scopes + an external
 * blocker map.
 * Output: `deriveWorkGraph`, `deriveState`, `selectDispatch`, `workIdFor`.
 * Dependency ที่อนุญาต: ./types.ts, ../../software/live-census/contract.ts
 * (types only).
 * สิ่งที่ห้ามแตะ: never let `selectDispatch` return two items whose write scopes
 * overlap — that is the one invariant protecting concurrent agents from each
 * other.
 */

import type { CapabilityRecord } from "../../software/live-census/contract";
import type { Dispatch, WorkGraph, WorkItem, WorkKind, WorkState, WorkerClass } from "./types";

/** The one place `kind` decides `worker_class` — see `WorkerClass`'s own doc comment for why this mapping is load-bearing, not cosmetic. */
export function workerClassFor(kind: WorkKind): WorkerClass {
  switch (kind) {
    case "VERIFY_CAPABILITY": return "DETERMINISTIC_TEST";
    case "WIRE_OR_RETIRE": return "REASONING_INTEGRATION";
    case "REPAIR": return "REPAIR_AGENT";
    case "IMPLEMENT": return "IMPLEMENTATION_AGENT";
    case "RESOLVE_DEPENDENCY": return "DEPENDENCY_RESOLUTION_AGENT";
    case "EXTERNAL": return "DEPENDENCY_RESOLUTION_AGENT";
  }
}

/** Work that cannot proceed for a reason outside this repository. Keyed by target. */
export interface ExternalBlocker {
  target: string;
  reason: string;
}

/**
 * How many times an order that could NOT BE EVALUATED (import error, timeout,
 * agent crash) may be retried at the same source digest before the branch is
 * declared blocked. Deliberately small: a harness fault usually clears on one
 * retry, and anything that fails twice identically needs a human to look.
 */
export const MAX_UNEVALUABLE_ATTEMPTS = 2;

export function workIdFor(kind: string, target: string): string {
  return `${kind}:${target}`;
}

/**
 * Derives one item's state. Ordering is deliberate:
 *   RETIRED   — nothing to do (no implementation, or already covered)
 *   VERIFIED  — the census already says so, against current source
 *   RUNNING   — someone holds this item's write boundary right now
 *   BLOCKED   — an own dependency is not VERIFIED, or an external cause
 *   READY     — everything this item needs is satisfied
 */
export function deriveState(
  item: Omit<WorkItem, "state" | "reason" | "blocked_by">,
  censusByPath: ReadonlyMap<string, CapabilityRecord>,
  heldScopes: ReadonlySet<string>,
  externalBlockers: readonly ExternalBlocker[],
): { state: WorkState; reason: string; blocked_by: string[] } {
  const target = censusByPath.get(item.target);

  if (item.kind === "VERIFY_CAPABILITY") {
    if (!target) return { state: "RETIRED", reason: `${item.target} is no longer in the census`, blocked_by: [] };
    if (target.current_status === "DECLARED_ONLY") {
      return { state: "RETIRED", reason: "no implementation to verify (documentation/data only)", blocked_by: [] };
    }
    if (target.current_status === "VERIFIED") {
      return { state: "VERIFIED", reason: target.status_reason, blocked_by: [] };
    }
    // A prior attempt against THIS EXACT source constrains what to do next, but
    // FAILED and BLOCKED are NOT the same fact and must not be treated alike:
    //
    //   FAILED  = the capability's own tests really ran and really failed. That
    //             IS evidence about the capability. Re-running identical code
    //             yields nothing new -> BLOCKED until the source changes.
    //
    //   BLOCKED = the attempt could not be evaluated at all (import error,
    //             timeout, agent crash). That is evidence about the HARNESS, not
    //             the capability, so a retry is legitimate — bounded, so a
    //             genuinely un-runnable target cannot be dispatched forever.
    //
    // Both cases were learned the hard way on the first two loop runs: run 1
    // re-dispatched a failing order every round, and run 2 then refused to retry
    // orders that had only failed because of a loader bug in my own scheduler.
    const attemptsAtDigest = target.lineage.filter((l) => l.endsWith(`:${target.source_digest}`)).length;
    if (target.current_status === "FAILED") {
      return {
        state: "BLOCKED",
        reason: `tests really ran and failed against the current source digest ${target.source_digest}; re-running identical code adds nothing: ${target.status_reason}`,
        blocked_by: ["PRIOR_ATTEMPT:FAILED"],
      };
    }
    if (target.current_status === "BLOCKED" && attemptsAtDigest >= MAX_UNEVALUABLE_ATTEMPTS) {
      return {
        state: "BLOCKED",
        reason: `could not be evaluated ${attemptsAtDigest} times at digest ${target.source_digest} (harness/environment, not a test failure); retry budget exhausted: ${target.status_reason}`,
        blocked_by: ["RETRY_BUDGET_EXHAUSTED"],
      };
    }
    if (item.test_files.length === 0) {
      return { state: "BLOCKED", reason: "no test file exists to produce evidence from", blocked_by: ["NO_TESTS"] };
    }
  }

  const external = externalBlockers.find((b) => b.target === item.target);
  if (external) return { state: "BLOCKED", reason: external.reason, blocked_by: [`EXTERNAL:${external.reason}`] };

  if (item.write_scope.some((s) => heldScopes.has(s))) {
    return { state: "RUNNING", reason: "an agent currently holds this item's write boundary", blocked_by: [] };
  }

  // Only this item's OWN dependencies are consulted. Unrelated blocked work is
  // invisible here, which is precisely why it cannot stall this branch.
  const unmet = item.depends_on.filter((depId) => {
    const depPath = depId.slice(depId.indexOf(":") + 1);
    const dep = censusByPath.get(depPath);
    return !dep || dep.current_status !== "VERIFIED";
  });
  if (unmet.length > 0) {
    return {
      state: "BLOCKED",
      reason: `${unmet.length} dependency/dependencies not yet VERIFIED — verifying against unverified dependencies would be weak evidence`,
      blocked_by: unmet,
    };
  }

  return { state: "READY", reason: "all dependencies VERIFIED and no boundary conflict", blocked_by: [] };
}

export function deriveWorkGraph(
  capabilities: readonly CapabilityRecord[],
  heldScopes: ReadonlySet<string> = new Set(),
  externalBlockers: readonly ExternalBlocker[] = [],
  derivedAt = "unknown",
): WorkGraph {
  const byPath = new Map(capabilities.map((c) => [c.path, c]));
  const inRepo = new Set(capabilities.map((c) => c.path));
  const items: WorkItem[] = [];

  /**
   * Shared READY/RUNNING logic for the three COMPANION kinds (REPAIR,
   * IMPLEMENT, RESOLVE_DEPENDENCY) — none of them consult census status the
   * way `deriveState` does for VERIFY_CAPABILITY (their gating condition is
   * decided by the caller before this runs); they share its held-scope/
   * external-blocker/retry-budget checks, since every dispatchable item
   * needs them.
   *
   * RETRY BUDGET (found live, Phase 4.2 — a `LOCAL`-worker reasoning
   * dispatch that honestly reports `LOCAL_WORKER_NO_REASONING_CAPABILITY`
   * was re-dispatched every single completion with no bound, because this
   * function originally had no retry-budget check at all, unlike
   * `deriveState`'s own for VERIFY_CAPABILITY). Evidence for EVERY kind
   * dispatched against a target is appended under the SAME
   * `capability_key` (`control/scheduler/coordinator.ts#recordEvidence`),
   * so `target.lineage` already aggregates attempts across kinds — reusing
   * it here needs no separate bookkeeping.
   */
  function deriveCompanionState(writeScope: readonly string[], targetPath: string, target: CapabilityRecord | undefined): { state: WorkState; reason: string; blocked_by: string[] } {
    const external = externalBlockers.find((b) => b.target === targetPath);
    if (external) return { state: "BLOCKED", reason: external.reason, blocked_by: [`EXTERNAL:${external.reason}`] };
    if (writeScope.some((s) => heldScopes.has(s))) {
      return { state: "RUNNING", reason: "an agent currently holds this item's write boundary", blocked_by: [] };
    }
    if (target) {
      const attemptsAtDigest = target.lineage.filter((l) => l.endsWith(`:${target.source_digest}`)).length;
      if (attemptsAtDigest >= MAX_UNEVALUABLE_ATTEMPTS) {
        return {
          state: "BLOCKED",
          reason: `${attemptsAtDigest} attempt(s) already recorded against digest ${target.source_digest} with no source change; retry budget exhausted`,
          blocked_by: ["RETRY_BUDGET_EXHAUSTED"],
        };
      }
    }
    return { state: "READY", reason: "gating condition met and no boundary conflict", blocked_by: [] };
  }

  for (const cap of capabilities) {
    if (cap.current_status === "DECLARED_ONLY") {
      // MISSING implementation work — a real, named capability folder with
      // no `.ts`/`.mjs` at all (see `software/live-census/derive.ts`'s own
      // DECLARED_ONLY reason string). Previously skipped outright ("nothing
      // to schedule"); now the honest work item this really is.
      const base = {
        work_id: workIdFor("IMPLEMENT", cap.path),
        kind: "IMPLEMENT" as const,
        worker_class: workerClassFor("IMPLEMENT"),
        target: cap.path,
        write_scope: [cap.path],
        test_files: cap.test_files,
        depends_on: [],
        evidence_ref: null,
      };
      items.push({ ...base, ...deriveCompanionState(base.write_scope, cap.path, cap) });
      continue;
    }

    if (cap.current_status === "UNWIRED") {
      const base = {
        work_id: workIdFor("WIRE_OR_RETIRE", cap.path),
        kind: "WIRE_OR_RETIRE" as const,
        worker_class: workerClassFor("WIRE_OR_RETIRE"),
        target: cap.path,
        write_scope: [cap.path],
        test_files: cap.test_files,
        depends_on: [],
        evidence_ref: null,
      };
      const s = deriveState(base, byPath, heldScopes, externalBlockers);
      items.push({ ...base, ...s });
      continue;
    }

    // A capability's verification depends on its own in-repo dependencies being
    // verified first. Dependencies outside the census (contracts with no code,
    // node builtins) are not schedulable and are excluded rather than treated
    // as permanently unmet.
    const deps = cap.dependencies
      .filter((d) => inRepo.has(d) && d !== cap.path)
      .filter((d) => byPath.get(d)!.current_status !== "DECLARED_ONLY")
      .map((d) => workIdFor("VERIFY_CAPABILITY", d));

    const base = {
      work_id: workIdFor("VERIFY_CAPABILITY", cap.path),
      kind: "VERIFY_CAPABILITY" as const,
      worker_class: workerClassFor("VERIFY_CAPABILITY"),
      target: cap.path,
      write_scope: [cap.path],
      test_files: cap.test_files,
      depends_on: deps,
      evidence_ref: cap.evidence_references[cap.evidence_references.length - 1] ?? null,
    };
    const s = deriveState(base, byPath, heldScopes, externalBlockers);
    items.push({ ...base, ...s });

    // REPAIR — a companion item, gated on the sibling VERIFY_CAPABILITY item
    // really having failed (never on BLOCKED-by-harness, per this file's own
    // FAILED-vs-BLOCKED distinction above). Shares the same write_scope, so
    // it can never run concurrently with its own VERIFY sibling — repairing
    // and re-verifying the same source at once would be a race, not evidence.
    if (cap.current_status === "FAILED") {
      const repairBase = {
        work_id: workIdFor("REPAIR", cap.path),
        kind: "REPAIR" as const,
        worker_class: workerClassFor("REPAIR"),
        target: cap.path,
        write_scope: [cap.path],
        test_files: cap.test_files,
        depends_on: [],
        evidence_ref: null,
      };
      items.push({ ...repairBase, ...deriveCompanionState(repairBase.write_scope, cap.path, cap) });
    }

    // RESOLVE_DEPENDENCY — a companion item, gated on this item's OWN
    // dependency chain being genuinely STUCK (a dependency whose own census
    // status is FAILED or BLOCKED, not merely "queued and not yet reached" —
    // the ordinary not-yet-verified case already self-resolves the moment
    // its own turn comes, and does not need an agent).
    const stuckDeps = deps.filter((depId) => {
      const depPath = depId.slice(depId.indexOf(":") + 1);
      const dep = byPath.get(depPath);
      return dep && (dep.current_status === "FAILED" || dep.current_status === "BLOCKED");
    });
    if (stuckDeps.length > 0) {
      const depBase = {
        work_id: workIdFor("RESOLVE_DEPENDENCY", cap.path),
        kind: "RESOLVE_DEPENDENCY" as const,
        worker_class: workerClassFor("RESOLVE_DEPENDENCY"),
        target: cap.path,
        write_scope: [cap.path],
        test_files: [] as readonly string[],
        depends_on: stuckDeps,
        evidence_ref: null,
      };
      items.push({ ...depBase, ...deriveCompanionState(depBase.write_scope, cap.path, cap) });
    }
  }

  // RESOLVE_DEPENDENCY for items EXTERNALLY blocked (env/credential/resource
  // outside the repository) — a dependency-resolution agent's real job here
  // is to check whether the blocker still genuinely holds (e.g. a credential
  // now exists) or confirm it remains an Owner-authority blocker; it is
  // NEVER authorized to remove the blocker itself.
  for (const blocker of externalBlockers) {
    if (!byPath.has(blocker.target)) continue;
    const depBase = {
      work_id: workIdFor("RESOLVE_DEPENDENCY", `external:${blocker.target}`),
      kind: "RESOLVE_DEPENDENCY" as const,
      worker_class: workerClassFor("RESOLVE_DEPENDENCY"),
      target: blocker.target,
      write_scope: [] as readonly string[], // investigates only — declares no write boundary of its own
      test_files: [] as readonly string[],
      depends_on: [],
      evidence_ref: null,
    };
    items.push({ ...depBase, state: "READY", reason: `investigates whether "${blocker.reason}" still holds`, blocked_by: [] });
  }

  const totals: Record<WorkState, number> = { READY: 0, RUNNING: 0, BLOCKED: 0, VERIFIED: 0, RETIRED: 0 };
  for (const i of items) totals[i.state] += 1;
  return { derived_at: derivedAt, items, totals };
}

/**
 * Chooses which READY items to run concurrently. Two guarantees:
 *   - no two dispatched items have overlapping write scopes (containment-aware,
 *     so a folder and a file inside it are never both dispatched);
 *   - anything withheld is reported WITH ITS REASON, never silently dropped.
 * Fewest-dependents-first is deliberate: cheap leaves clear quickly and unblock
 * their dependents sooner than a big item would.
 */
export function selectDispatch(
  graph: WorkGraph,
  concurrency: number,
  dispatchId: string,
  decidedAt: string,
): Dispatch {
  const ready = graph.items
    .filter((i) => i.state === "READY")
    .slice()
    .sort((a, b) => a.test_files.length - b.test_files.length || a.work_id.localeCompare(b.work_id));

  const dispatched: WorkItem[] = [];
  const withheld: { work_id: string; reason: string }[] = [];
  const taken: string[] = [];

  const overlaps = (a: string, b: string): boolean => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

  for (const item of ready) {
    if (dispatched.length >= concurrency) {
      withheld.push({ work_id: item.work_id, reason: `concurrency cap ${concurrency} reached` });
      continue;
    }
    const conflict = item.write_scope.find((s) => taken.some((t) => overlaps(s, t)));
    if (conflict) {
      withheld.push({ work_id: item.work_id, reason: `write scope ${conflict} overlaps an already-dispatched item` });
      continue;
    }
    dispatched.push(item);
    taken.push(...item.write_scope);
  }
  return { dispatch_id: dispatchId, decided_at: decidedAt, dispatched, withheld };
}
