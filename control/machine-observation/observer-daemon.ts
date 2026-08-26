/**
 * หน้าที่: the long-lived observation runtime — observe, resolve, append,
 * refresh (Owner, 2026-08-26).
 *
 * WHY A NEW HOST AND NOT AN EXISTING ONE. The only long-lived loop in this
 * repository is `control/circuit-breaker/daemon.ts`, and its own header states
 * that the pids from `listActiveLaunches()` are "the only source of PIDs this
 * file may ever act on" — it exists to KILL processes that break the import
 * boundary. Hosting observation inside the component whose job is enforcement
 * would put a read-only layer inside a process that has a kill switch. That is
 * the blocker that was reported before this file was written, and it is why
 * this host exists separately.
 *
 * WHAT IT MAY NOT DO, enforced by having no such code and no such import:
 * it does not kill a process, pause an agent, authorize a write, delete a file,
 * modify source, or make a policy decision. Its only writes are appends to its
 * own observation store.
 *
 * NO POLLING OF THE REPOSITORY. Filesystem events come from
 * `../realtime-change/`'s kernel-backed watcher over scopes that runtime
 * declares. The periodic tick refreshes only the runtime-consumer snapshot,
 * which is a bounded set of `lsof` calls over candidate pids — never a walk of
 * the source tree.
 *
 * Input: `startObservationRuntime(options)`.
 * Output: appended `ObservationRecord`s, and a live `status()`.
 * Dependency ที่อนุญาต: ../realtime-change/contract.ts, ./process-observer.ts,
 * ./correlation.ts, ./meaning.ts, ./observation-store.ts, ./lifecycle-bridge.ts,
 * ../../software/registry-database/ (adapter, for the resource lookup).
 * สิ่งที่ห้ามแตะ:
 * - ห้าม import agent-host/killLaunch, interrupt, หรืออะไรที่หยุด process ได้.
 * - ห้ามเขียนนอก ./data/observations.jsonl.
 * - ห้าม poll ทั้ง repository.
 */

declare const require: any;
declare const setInterval: any;
declare const clearInterval: any;

import { startObserving, stopObserving, observationStatus, currentWatchScopes, resolvePath, toRepoRelative, type ChangeEvent, type WatchScope } from "../realtime-change/contract";
import { observeProcesses, relationshipsFor } from "./process-observer";
import { correlate, strongestVerdict } from "./correlation";
import { deriveMeaning } from "./meaning";
import { appendObservation, observationStoreStatus, type ObservationRecord } from "./observation-store";
import { candidatePidsForRepo, runtimeConsumerSnapshot, buildIngestionRecord } from "./lifecycle-bridge";
import { offerHistoricalScreenshotsToLifecycle } from "../ui-render-verification/contract";
import { createPersistentFileStore } from "../../software/registry-database/adapters/persistent-file-store";
import type { RuntimeConsumerEvidence } from "./lifecycle-bridge";

export interface ObservationRuntimeOptions {
  /**
   * How many historical screenshots are retained rather than named as
   * lifecycle candidates. `undefined` disables the offer entirely — a host that
   * is not asked to do it must not start doing it silently. Note this bounds
   * what is OFFERED, not what is deleted; nothing on this path deletes.
   */
  screenshotKeepNewest?: number;
  /** Paths to watch in addition to whatever runtime already declares. */
  scopes?: readonly WatchScope[];
  /** How often the runtime-consumer snapshot is refreshed. This is NOT a repository scan. */
  refreshMs?: number;
  /** Repo-relative paths whose runtime consumers are refreshed each tick. */
  refreshPaths?: readonly string[];
  onRecord?: (record: ObservationRecord) => void;
}

export interface ScopeChange {
  at: string;
  added: readonly string[];
  removed: readonly string[];
  now_watching: readonly string[];
}

export interface ObservationRuntimeHandle {
  stop(): void;
  /** Re-derives the watch scopes from runtime and re-attaches the watcher if they changed. Called on every tick; exposed so a proof can force it without waiting. */
  refreshScopes(): ScopeChange | null;
  status(): {
    observing: ReturnType<typeof observationStatus>;
    store: ReturnType<typeof observationStoreStatus>;
    last_refresh: string | null;
    last_screenshot_offer: unknown;
    scope_changes: readonly ScopeChange[];
    runtime_consumers: readonly { path: string; state: string; consumers: number }[];
  };
}

export function startObservationRuntime(options: ObservationRuntimeOptions = {}): ObservationRuntimeHandle {
  const store = createPersistentFileStore();
  const refreshPaths = options.refreshPaths ?? [];
  let lastRefresh: string | null = null;
  let lastScreenshotOffer: unknown = null;
  let consumers: RuntimeConsumerEvidence[] = [];

  const onChange = (event: ChangeEvent): void => {
    // observe -> resolve -> append. Nothing decides anything here.
    const repoRelative = toRepoRelative(event.path);
    const resolution = resolvePath(event.path, store);
    const observed = observeProcesses(candidatePidsForRepo());
    const verdict = strongestVerdict(correlate(event, observed));
    const meanings = deriveMeaning(event, store, verdict);
    const ingestion = buildIngestionRecord({
      eventId: event.event_id,
      resourceId: resolution.resource?.resource_id ?? null,
      path: repoRelative,
      observedAt: event.observed_at,
      processes: verdict.pid !== null ? observed.filter((observation) => observation.pid === verdict.pid) : [],
      relationships: observed.filter((observation) => observation.pid === verdict.pid).flatMap(relationshipsFor),
      meanings,
    });
    const record = appendObservation(ingestion);
    options.onRecord?.(record);
  };

  const extraScopes = options.scopes ?? [];
  let watching = new Set<string>();
  const scopeChanges: ScopeChange[] = [];

  /**
   * Scopes are re-derived from runtime, not captured once at start (Owner,
   * 2026-08-26). A write lock taken after the daemon started used to be
   * invisible until a restart — the watcher held whatever `fs.watch` handles it
   * opened at boot. Now the declared scopes are recomputed each tick, and the
   * watcher is re-attached ONLY when the set actually changed, so an unchanged
   * system does not churn kernel handles every interval.
   */
  const refreshScopes = (): ScopeChange | null => {
    const derived = currentWatchScopes(extraScopes);
    const next = new Set(derived.map((scope) => scope.path));
    const added = [...next].filter((path) => !watching.has(path));
    const removed = [...watching].filter((path) => !next.has(path));
    if (added.length === 0 && removed.length === 0) return null;

    stopObserving();
    startObserving(onChange, extraScopes);
    watching = next;
    const change: ScopeChange = { at: new Date().toISOString(), added, removed, now_watching: [...next] };
    scopeChanges.push(change);
    return change;
  };

  startObserving(onChange, extraScopes);
  watching = new Set(currentWatchScopes(extraScopes).map((scope) => scope.path));

  const timer = setInterval(() => {
    refreshScopes();

    // AUTOMATIC SUBMISSION TO THE EXISTING STORAGE LIFECYCLE (Owner,
    // 2026-08-26). This host already runs on a tick, already reads
    // classifications, and already has no deletion authority of its own —
    // which is exactly what this call needs and why no second daemon was
    // created for it.
    //
    // It NAMES CANDIDATES. It does not delete.
    //
    // That sentence was aspirational when this call was written and is now
    // literally true: the function it called used to end in fs.unlinkSync via
    // ../machine-observation/'s pruneClassifiedFiles, so a daemon tick was a
    // deletion on a timer. That prune is gone (see the DELETE PATH REMOVED note
    // in ./observation-store.ts) and the call is now an offer — classification
    // protects anything still in use, the rest are named, and whether any of
    // them is reclaimed is the storage lifecycle's decision and its trash
    // adapter's action. A failure here must never take the observer down.
    if (typeof options.screenshotKeepNewest === "number") {
      try {
        lastScreenshotOffer = offerHistoricalScreenshotsToLifecycle(options.screenshotKeepNewest);
      } catch (error) {
        lastScreenshotOffer = { error: error instanceof Error ? error.message : String(error) };
      }
    }
    // A bounded lsof pass over candidate pids — the refresh that keeps
    // live-census's runtime input current without touching the source tree.
    consumers = [...runtimeConsumerSnapshot(refreshPaths).values()];
    lastRefresh = new Date().toISOString();
  }, options.refreshMs ?? 30_000);

  return {
    stop(): void {
      clearInterval(timer);
      stopObserving();
    },
    refreshScopes,
    status() {
      return {
        observing: observationStatus(),
        store: observationStoreStatus(),
        last_refresh: lastRefresh,
        last_screenshot_offer: lastScreenshotOffer,
        scope_changes: scopeChanges,
        runtime_consumers: consumers.map((evidence) => ({ path: evidence.path, state: evidence.state, consumers: evidence.consumers.length })),
      };
    },
  };
}
