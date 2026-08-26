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

import { startObserving, stopObserving, observationStatus, resolvePath, toRepoRelative, type ChangeEvent, type WatchScope } from "../realtime-change/contract";
import { observeProcesses, relationshipsFor } from "./process-observer";
import { correlate, strongestVerdict } from "./correlation";
import { deriveMeaning } from "./meaning";
import { appendObservation, observationStoreStatus, type ObservationRecord } from "./observation-store";
import { candidatePidsForRepo, runtimeConsumerSnapshot, buildIngestionRecord } from "./lifecycle-bridge";
import { createPersistentFileStore } from "../../software/registry-database/adapters/persistent-file-store";
import type { RuntimeConsumerEvidence } from "./lifecycle-bridge";

export interface ObservationRuntimeOptions {
  /** Paths to watch in addition to whatever runtime already declares. */
  scopes?: readonly WatchScope[];
  /** How often the runtime-consumer snapshot is refreshed. This is NOT a repository scan. */
  refreshMs?: number;
  /** Repo-relative paths whose runtime consumers are refreshed each tick. */
  refreshPaths?: readonly string[];
  onRecord?: (record: ObservationRecord) => void;
}

export interface ObservationRuntimeHandle {
  stop(): void;
  status(): {
    observing: ReturnType<typeof observationStatus>;
    store: ReturnType<typeof observationStoreStatus>;
    last_refresh: string | null;
    runtime_consumers: readonly { path: string; state: string; consumers: number }[];
  };
}

export function startObservationRuntime(options: ObservationRuntimeOptions = {}): ObservationRuntimeHandle {
  const store = createPersistentFileStore();
  const refreshPaths = options.refreshPaths ?? [];
  let lastRefresh: string | null = null;
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

  startObserving(onChange, options.scopes ?? []);

  const timer = setInterval(() => {
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
    status() {
      return {
        observing: observationStatus(),
        store: observationStoreStatus(),
        last_refresh: lastRefresh,
        runtime_consumers: consumers.map((evidence) => ({ path: evidence.path, state: evidence.state, consumers: evidence.consumers.length })),
      };
    },
  };
}
