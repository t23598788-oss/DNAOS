/**
 * หน้าที่: THE ONE CANONICAL SCHEDULER/COORDINATOR. Continuously derives all
 * READY work from current system state, dispatches independent work concurrently
 * with explicit ownership and non-overlapping write scopes, collects evidence,
 * updates the canonical registry, re-derives the Live Census, recomputes the
 * work graph, and dispatches whatever became READY — with no Owner command
 * between rounds.
 *
 * The loop this implements, per the Owner directive:
 *   EXECUTE -> COLLECT EVIDENCE -> VERIFY -> UPDATE CANONICAL REGISTRY
 *   -> RE-DERIVE LIVE CENSUS -> RECOMPUTE WORK GRAPH -> RELEASE NEW READY WORK
 *   -> DISPATCH
 *
 * PHASE 4.2 (Owner, "typed multi-worker execution system") extends this from
 * a single test-only dispatcher into TYPED dispatch by `WorkItem.worker_class`
 * (`control/work-graph/types.ts`):
 *   DETERMINISTIC_TEST            -> ./agent-worker.ts        (unchanged)
 *   REASONING_INTEGRATION         -> ./reasoning-worker.ts    (WIRE_OR_RETIRE)
 *   REPAIR_AGENT                  -> ./reasoning-worker.ts    (REPAIR)
 *   IMPLEMENTATION_AGENT          -> ./reasoning-worker.ts    (IMPLEMENT)
 *   DEPENDENCY_RESOLUTION_AGENT   -> ./reasoning-worker.ts    (RESOLVE_DEPENDENCY)
 * `./reasoning-worker.ts`'s own header states the hard rule this file
 * enforces a SECOND time at the call site (`recordEvidence` below): only a
 * DETERMINISTIC_TEST result may ever write `VERIFIED` into the ledger. A
 * worker role is temporary by construction — `dispatchByWorkerClass` starts
 * one bounded task, the pool below releases its slot the instant it settles,
 * and that capacity is immediately available to the next READY item; no
 * batch/round boundary makes anything wait.
 *
 * PHASE 4.3 (Owner, "AI เป็นชิป" — AI is compute, wired to a real Processing
 * Fabric): reasoning-class dispatch no longer takes a single, fixed
 * `reasoningWorkerKind` for the whole loop. Every reasoning-class item goes
 * through `./capability-router.ts#routeWork` against the real, discovered
 * `./provider-pool.ts` pool — the provider actually used is chosen per
 * dispatch from real availability, real historical latency, and real
 * historical success rate, never from a `WorkKind -> ProviderKind` table
 * (there is no such table anywhere in this repo). The chain this file now
 * drives, end to end, per the Owner's own diagram:
 *   Scheduler -> Capability Router -> Provider/Processing Pool
 *   -> Anthropic/OpenAI/Local real dispatch -> Result Contract (`WorkResult`)
 *   -> Evidence (the ledger) -> Verifier (the NEXT DETERMINISTIC_TEST re-run)
 *   -> Work Graph (re-derived) -> immediately redispatched, same loop below.
 *
 * REUSED, NOT REBUILT (the directive's own rule):
 *   - `software/live-census/`      — observation + the verification ledger
 *   - `control/work-graph/`        — dependency-aware state derivation
 *   - `control/work-coordination/` — real write-boundary claims (containment-aware)
 *   - `execution/process-lock/`    — the O_CREAT|O_EXCL guarantee underneath
 *   - `control/agent-gateway/`     — the real Agent Host boundary reasoning-class dispatch reuses
 * This file adds only the loop, the typed routing, and the provider pool
 * bookkeeping that join them.
 *
 * Input: CLI flags (see ./cli.ts).
 * Output: `runLoop`, `LoopReport`.
 * Dependency ที่อนุญาต: ../work-graph/contract.ts,
 * ../work-coordination/contract.ts, ../../software/live-census/contract.ts,
 * ./agent-worker.ts (as a worker entry), ./reasoning-worker.ts,
 * ./provider-pool.ts, ./capability-router.ts, node builtins.
 * สิ่งที่ห้ามแตะ: never mark a work item VERIFIED from anything but a real
 * DETERMINISTIC_TEST result recorded in the ledger. Never dispatch two items
 * with overlapping write scopes. Never let an agent's self-report bypass the
 * ledger. Never add a WorkKind-to-ProviderKind table — provider selection is
 * `./capability-router.ts`'s exclusive job, decided at dispatch time.
 */

import { Worker } from "node:worker_threads";
import { join } from "node:path";
import { appendFileSync, mkdirSync } from "node:fs";
import { deriveWorkGraph, selectDispatch, type ExternalBlocker } from "../work-graph/contract";
import type { WorkGraph, WorkItem, WorkResult } from "../work-graph/contract";
import { claimWriteScope, releaseWriteScope, listWriteLocks } from "../work-coordination/contract";
import type { WriteScopeClaim } from "../work-coordination/contract";
import { dispatchReasoningWorker } from "./reasoning-worker";
import { discoverPool, recordMetric, loadMetrics } from "./provider-pool";
import type { ProcessingUnit, ProviderKind } from "./provider-pool";
import { routeWork } from "./capability-router";
import type { CapabilityRecord } from "../../software/live-census/contract";

const REPO_ROOT = process.cwd();
const REPOSITORY = "dna-os-infrastructure";
const LOOP_LOG = join(REPO_ROOT, "control/scheduler/data/loop-events.jsonl");

export interface LoopRound {
  round: number;
  dispatch_id: string;
  dispatched: readonly string[];
  withheld: readonly { work_id: string; reason: string }[];
  results: readonly WorkResult[];
  graph_before: Readonly<Record<string, number>>;
  graph_after: Readonly<Record<string, number>>;
  newly_ready: readonly string[];
  autonomous: boolean;
}

export interface LoopReport {
  rounds: readonly LoopRound[];
  final_graph: WorkGraph;
  closed: boolean;
  stopped_because: string;
}

/** Emits a durable loop event. The loop's own behaviour is evidence too. */
function logEvent(event: Record<string, unknown>): void {
  mkdirSync(join(REPO_ROOT, "control/scheduler/data"), { recursive: true });
  appendFileSync(LOOP_LOG, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`, "utf8");
}

/**
 * Re-derives the census from the real repository. Imported dynamically with a
 * cache-buster so a re-derive after a ledger append actually re-reads the
 * ledger instead of returning a cached module's view.
 */
async function loadCensus() {
  const mod = await import(`${join(REPO_ROOT, "software/live-census/observe.ts")}?t=${Date.now()}`);
  return (mod as { observeCensus: () => ReturnType<typeof Object> }).observeCensus() as unknown as {
    capabilities: readonly CapabilityRecord[];
    head_commit: string | null;
  };
}

/** Runs one bounded Work Order in a real, concurrent DETERMINISTIC_TEST worker. */
function dispatchTestWorker(item: WorkItem, timeoutMs: number): Promise<WorkResult> {
  return new Promise((resolve) => {
    const worker = new Worker(join(REPO_ROOT, "control/scheduler/agent-worker.ts"), {
      workerData: {
        work_id: item.work_id,
        target: item.target,
        test_files: item.test_files,
        repo_root: REPO_ROOT,
        timeout_ms: timeoutMs,
      },
      // MUST inherit the parent's tsx hooks. Passing `execArgv: []` stripped
      // them, so every extensionless TypeScript import inside a test failed
      // with "Cannot find module .../contract" and every agent reported a
      // false BLOCKED.
      //
      // FIX (2026-08-24, dogfood loop — this bug was found by running the
      // loop itself, which reported every WIRE_OR_RETIRE dispatch BLOCKED
      // with "Cannot use import statement outside a module"): this repo's
      // installed tsx (v4.23.12) registers its hook as `--loader
      // <loader.mjs>`, not `--import <loader.mjs>` — the flag NAME the old
      // filter checked for never matches `"--loader"`, so it was dropped
      // while the loader.mjs VALUE (which matches the tsx regex on its own)
      // was kept, producing a malformed execArgv array (an orphaned path
      // argument with no preceding `--loader` flag) that made every worker
      // boot as plain CJS with none of tsx's ESM/TS hooks. Filtering flag+
      // value PAIRS together (rather than filtering flags and values as
      // independent list membership tests) fixes this and is also robust to
      // whichever hook name a future tsx version uses. Only the loader
      // flags are forwarded — not arbitrary parent flags — so a debug/
      // inspect flag on the parent cannot leak into agents.
      execArgv: (() => {
        const kept: string[] = [];
        const parent = process.execArgv;
        for (let i = 0; i < parent.length; i++) {
          const flag = parent[i];
          const value = parent[i + 1];
          if ((flag === "--require" || flag === "--import" || flag === "--loader" || flag === "--experimental-loader")
            && typeof value === "string" && /tsx[/\\]dist[/\\](preflight\.cjs|loader\.mjs)/.test(value)) {
            kept.push(flag, value);
            i++;
          }
        }
        return kept;
      })(),
    });
    let settled = false;
    const finish = (result: WorkResult): void => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      resolve(result);
    };
    worker.on("message", (msg: WorkResult) => finish(msg));
    worker.on("error", (error) =>
      finish({ work_id: item.work_id, target: item.target, outcome: "BLOCKED", evidence_ref: `agent error: ${error.message}`, passed: 0, failed: 0, duration_ms: 0, output_tail: "" }));
    worker.on("exit", (code) => {
      if (!settled) finish({ work_id: item.work_id, target: item.target, outcome: "BLOCKED", evidence_ref: `agent exited early with code ${code}`, passed: 0, failed: 0, duration_ms: 0, output_tail: "" });
    });
  });
}

/** THE typed routing point — the only place `worker_class` decides which real worker TYPE runs; WHICH real provider within that type is `./capability-router.ts`'s decision, already resolved by the time this is called. */
function dispatchByWorkerClass(item: WorkItem, capsByPath: ReadonlyMap<string, CapabilityRecord>, provider: ProviderKind | null, options: LoopOptions): Promise<WorkResult> {
  if (item.worker_class === "DETERMINISTIC_TEST") {
    return dispatchTestWorker(item, options.agentTimeoutMs);
  }
  return dispatchReasoningWorker(item, capsByPath.get(item.target) ?? null, provider ?? "LOCAL", REPO_ROOT, options.agentTimeoutMs);
}

/**
 * Records evidence into the canonical append-only ledger, pinned to the
 * source it was proven against.
 *
 * HARD ENFORCEMENT (Owner: "Never let an agent self-declare completion"):
 * only `DETERMINISTIC_TEST` may ever write outcome `VERIFIED`. This is
 * `./reasoning-worker.ts`'s own rule too (it structurally never returns
 * `VERIFIED`) — asserting it again here means a future bug in that file
 * still cannot let a reasoning-class result certify itself; the ledger
 * itself refuses to accept it.
 */
async function recordEvidence(result: WorkResult, workerClass: WorkItem["worker_class"], by: string): Promise<void> {
  if (result.outcome === "VERIFIED" && workerClass !== "DETERMINISTIC_TEST") {
    throw new Error(`SELF_DECLARED_COMPLETION_REFUSED: worker_class "${workerClass}" (work_id ${result.work_id}) attempted to record outcome VERIFIED — only DETERMINISTIC_TEST may ever do that.`);
  }
  const host = await import(`${join(REPO_ROOT, "software/live-census/host-runtime.ts")}`);
  const h = host as {
    sourceDigest(p: string): string;
    appendVerification(r: { capability_key: string; source_digest: string; verified_at: string; evidence_ref: string; outcome: string; verified_by: string }): void;
    nowIso(): string;
  };
  h.appendVerification({
    capability_key: `${REPOSITORY}:${result.target}`,
    source_digest: h.sourceDigest(result.target),
    verified_at: h.nowIso(),
    evidence_ref: result.evidence_ref,
    outcome: result.outcome,
    verified_by: by,
  });
}

export interface LoopOptions {
  concurrency: number;
  maxRounds: number;
  agentTimeoutMs: number;
  holderId: string;
  externalBlockers: readonly ExternalBlocker[];
  /** Restrict scheduling to these targets — used to prove the loop on a bounded slice. */
  onlyTargets?: readonly string[];
  /**
   * Concurrency CAP per real provider type (how many simultaneous real
   * `CLAUDE#N`/`CODEX#N`/`GEMINI#N` processes `./capability-router.ts` may
   * hand out at once). Defaults to 1. `LOCAL` always has exactly one unit —
   * see `./provider-pool.ts#discoverPool`.
   */
  poolSizePerProvider?: number;
  /**
   * Escape hatch, NOT a routing rule: restricts the router to only ever
   * select this ONE provider (still going through the same availability/
   * concurrency checks) — for bounded, deliberate cost control (e.g. force
   * `"LOCAL"` for a free mechanism-only proof) or focused testing. Leaving
   * this unset is the real, intended behaviour: the router picks freely
   * among every available provider based on capability/availability/
   * latency/history, per the Owner's own "AI เป็นชิป" directive.
   */
  forceProvider?: ProviderKind;
}

interface InFlight {
  item: WorkItem;
  claim: WriteScopeClaim | null;
  provider: ProviderKind | null; // null for DETERMINISTIC_TEST — it never touches the provider pool
  started_at: number;
  promise: Promise<WorkResult>;
}

export async function runLoop(options: LoopOptions): Promise<LoopReport> {
  const rounds: LoopRound[] = [];
  let stopped = "completed: no READY work remains";

  const buildGraph = async (): Promise<{ graph: WorkGraph; capsByPath: ReadonlyMap<string, CapabilityRecord> }> => {
    const { capabilities } = await loadCensus();
    const held = new Set(listWriteLocks().filter((l) => l.holder_id !== options.holderId).map((l) => l.scope_path));
    const scoped = options.onlyTargets
      ? capabilities.filter((c) => options.onlyTargets!.includes(c.path))
      : capabilities;
    return {
      graph: deriveWorkGraph(scoped, held, options.externalBlockers, new Date().toISOString()),
      capsByPath: new Map(capabilities.map((c) => [c.path, c])),
    };
  };

  let { graph, capsByPath } = await buildGraph();
  logEvent({ event: "LOOP_START", totals: graph.totals, concurrency: options.concurrency });

  // CONTINUOUS POOL (Owner, Phase 4.2 — "redispatch without waiting for the
  // whole batch"): a work_id occupies a slot only until ITS OWN result
  // settles; the moment it does, its slot is free and immediately offered to
  // whatever is READY next — never held open for siblings dispatched in the
  // same wave. `maxRounds * concurrency` bounds TOTAL dispatches (not literal
  // rounds, which this model no longer has) so a pathological loop still
  // terminates.
  const inFlight = new Map<string, InFlight>();
  const maxDispatches = options.maxRounds * options.concurrency;
  let totalDispatched = 0;
  let dispatchCounter = 0;

  // THE PROCESSING FABRIC's pool — discovered ONCE (real `resolveWorker`
  // existence checks; a provider missing on this host stays visible in the
  // pool as `available: false`, never silently absent). Metrics are
  // RE-LOADED on every routing decision so a provider's very next dispatch
  // already reflects everything recorded so far this loop, not a stale
  // snapshot from loop start.
  const pool: readonly ProcessingUnit[] = discoverPool(options.poolSizePerProvider ?? 1);
  logEvent({ event: "POOL_DISCOVERED", units: pool.map((u) => ({ unit_id: u.unit_id, available: u.available, detail: u.detail })) });

  const inFlightByProvider = (): Map<ProviderKind, number> => {
    const counts = new Map<ProviderKind, number>();
    for (const f of inFlight.values()) {
      if (f.provider) counts.set(f.provider, (counts.get(f.provider) ?? 0) + 1);
    }
    return counts;
  };

  const fillSlots = (): { filled: WorkItem[]; withheld: readonly { work_id: string; reason: string }[] } => {
    const capacity = options.concurrency - inFlight.size;
    if (capacity <= 0 || totalDispatched >= maxDispatches) return { filled: [], withheld: [] };
    const dispatch = selectDispatch(graph, capacity, `d${++dispatchCounter}`, new Date().toISOString());
    const filled: WorkItem[] = [];
    for (const item of dispatch.dispatched) {
      if (totalDispatched >= maxDispatches) break;

      // ROUTE FIRST (before claiming any boundary — a work item this loop
      // cannot currently staff should never occupy a write-scope lock while
      // it waits): DETERMINISTIC_TEST never touches the provider pool at
      // all; every reasoning-class item goes through the real Capability
      // Router against the real, discovered pool.
      let chosenProvider: ProviderKind | null = null;
      if (item.worker_class !== "DETERMINISTIC_TEST") {
        const candidatePool = options.forceProvider ? pool.filter((u) => u.provider === options.forceProvider) : pool;
        const decision = routeWork(item, candidatePool, inFlightByProvider(), loadMetrics());
        if (!decision.ok) {
          logEvent({ event: "ROUTE_REFUSED", work_id: item.work_id, worker_class: item.worker_class, reason: decision.reason });
          continue;
        }
        chosenProvider = decision.unit.provider;
        logEvent({ event: "ROUTED", work_id: item.work_id, worker_class: item.worker_class, unit_id: decision.unit.unit_id, provider: decision.unit.provider, score: decision.score, reason: decision.reason });
      }

      let claim: WriteScopeClaim | null = null;
      if (item.write_scope.length > 0) {
        const c = claimWriteScope({
          work_id: item.work_id,
          holder_agent_id: `${options.holderId}:${item.work_id}`,
          repository_id: REPOSITORY,
          write_scope: item.write_scope,
          lease_ms: options.agentTimeoutMs + 60_000,
        });
        if (!c.ok) {
          logEvent({ event: "CLAIM_REFUSED", work_id: item.work_id, reason: c.reason });
          continue;
        }
        claim = c.claim;
      }
      // Investigation-only items (e.g. an EXTERNAL RESOLVE_DEPENDENCY, which
      // declares no write boundary of its own) need no claim at all.
      totalDispatched += 1;
      const promise = dispatchByWorkerClass(item, capsByPath, chosenProvider, options);
      inFlight.set(item.work_id, { item, claim, provider: chosenProvider, started_at: Date.now(), promise });
      filled.push(item);
    }
    return { filled, withheld: dispatch.withheld };
  };

  const initial = fillSlots();
  if (initial.filled.length > 0) {
    logEvent({ event: "DISPATCH", dispatch_id: "d0", autonomous: false, items: initial.filled.map((i) => i.work_id), worker_classes: initial.filled.map((i) => i.worker_class) });
  }

  while (inFlight.size > 0) {
    const settled = await Promise.race([...inFlight.values()].map((f) => f.promise.then((result) => ({ work_id: f.item.work_id, result }))));
    const entry = inFlight.get(settled.work_id)!;
    inFlight.delete(settled.work_id);

    await recordEvidence(settled.result, entry.item.worker_class, `scheduler-${entry.item.worker_class}:${settled.work_id}`);
    logEvent({ event: "EVIDENCE", work_id: settled.work_id, worker_class: entry.item.worker_class, outcome: settled.result.outcome, evidence: settled.result.evidence_ref, ms: settled.result.duration_ms });
    if (entry.claim) releaseWriteScope(entry.claim);

    // Feed the REAL observed outcome back into the Processing Fabric's own
    // history — this is what makes the NEXT routing decision for this
    // (provider, work_kind) pair reflect reality instead of the neutral
    // prior `./capability-router.ts` uses when there is no history yet.
    if (entry.provider) {
      recordMetric({
        recorded_at: new Date().toISOString(),
        unit_id: entry.provider,
        provider: entry.provider,
        work_kind: entry.item.kind,
        outcome: settled.result.outcome,
        duration_ms: settled.result.duration_ms,
        cost: null,
      });
    }

    // RE-DERIVE from reality, then RECOMPUTE the graph. Newly READY work is
    // discovered here — this is the step that makes redispatch autonomous —
    // and it happens after EVERY single completion, not after a batch.
    const before = { ...graph.totals };
    const readyBefore = new Set(graph.items.filter((i) => i.state === "READY").map((i) => i.work_id));
    ({ graph, capsByPath } = await buildGraph());
    const newlyReady = graph.items.filter((i) => i.state === "READY" && !readyBefore.has(i.work_id)).map((i) => i.work_id);

    rounds.push({
      round: rounds.length + 1,
      dispatch_id: `settle:${settled.work_id}`,
      dispatched: [settled.work_id],
      withheld: [],
      results: [settled.result],
      graph_before: before,
      graph_after: { ...graph.totals },
      newly_ready: newlyReady,
      autonomous: rounds.length > 0,
    });
    logEvent({ event: "RECOMPUTED", totals: graph.totals, newly_ready: newlyReady });

    // Immediately offer the freed slot (and anything newly READY) to the pool
    // — no waiting for the rest of the in-flight set.
    const refill = fillSlots();
    if (refill.filled.length > 0) {
      logEvent({ event: "DISPATCH", dispatch_id: `refill:${settled.work_id}`, autonomous: true, items: refill.filled.map((i) => i.work_id), worker_classes: refill.filled.map((i) => i.worker_class) });
    }
  }

  stopped = totalDispatched >= maxDispatches
    ? `dispatch budget exhausted: ${maxDispatches} total dispatches (maxRounds ${options.maxRounds} * concurrency ${options.concurrency})`
    : graph.totals.READY > 0
    ? `no dispatchable work: ${graph.totals.READY} READY but all withheld`
    : "no READY work remains";
  logEvent({ event: "LOOP_END", completions: rounds.length, stopped });

  // CLOSED means one specific thing, and the first implementation of this check
  // was wrong in a way that mattered: it returned true merely because a second
  // completion happened, so a loop re-dispatching the SAME failing item forever
  // reported itself closed. The loop is closed ONLY if some completion
  // dispatched an item that an EARLIER completion's verification made newly
  // READY — i.e. real verification released real new work with no Owner
  // command in between.
  const closed = rounds.some((r, index) => {
    if (index === 0) return false;
    const releasedEarlier = new Set(rounds.slice(0, index).flatMap((prev) => prev.newly_ready));
    return r.dispatched.some((id) => releasedEarlier.has(id));
  });

  return { rounds, final_graph: graph, closed, stopped_because: stopped };
}
