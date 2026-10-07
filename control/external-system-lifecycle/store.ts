/**
 * หน้าที่: `LifecycleEventStore` — the real persistence for every
 * `LifecycleEvent`. Disk (one JSONL file, append-only) is the sole
 * source of truth; `getLifecycleRun()` always rebuilds a `LifecycleRun`
 * by replaying every event for a `candidate_id` from disk, never from an
 * in-memory cache — a process restart loses nothing, per the Owner's
 * explicit requirement that in-memory state is never the source of
 * truth. Mirrors `../../software/registry-database/adapters/
 * persistent-file-store.ts`'s exact rebuild-on-read discipline.
 *
 * Input: none at module scope; `recordEvent`/`getLifecycleRun` take their
 * own explicit args.
 * Output: `createLifecycleEventStore`, `LifecycleEventStore`.
 * Dependency ที่อนุญาต: ./types.ts, ./host-runtime.ts.
 * สิ่งที่ห้ามแตะ: never overwrite or delete a line in the JSONL file —
 * append-only, same discipline as
 * `../../software/registry-database/adapters/persistent-file-store.ts`'s
 * `relationships_removed.jsonl` tombstone log.
 */

import { join } from "node:path";
import { appendLine, newEventId, nowIso, readLines } from "./host-runtime";
import type { LifecycleEvent, LifecycleRun, LifecycleStage, LifecycleStageStatus } from "./types";

const DEFAULT_DATA_DIR = join(process.cwd(), "control/external-system-lifecycle/data");

export interface LifecycleEventStore {
  recordEvent(input: { candidate_id: string; stage: LifecycleStage; status: LifecycleStageStatus; reason: string; evidence_ref: string | null; correlation_id: string }): LifecycleEvent;
  getLifecycleRun(candidate_id: string): LifecycleRun;
}

const TERMINAL_STAGE: LifecycleStage = "COMPLETE";
const TERMINAL_STATUS: LifecycleStageStatus = "PASSED";

export function createLifecycleEventStore(options: { dataDir?: string } = {}): LifecycleEventStore {
  const dataDir = options.dataDir ?? DEFAULT_DATA_DIR;
  const logPath = join(dataDir, "lifecycle-events.jsonl");

  function readAllEvents(): LifecycleEvent[] {
    return readLines(logPath).map((line) => JSON.parse(line) as LifecycleEvent);
  }

  return {
    recordEvent(input) {
      const event: LifecycleEvent = { event_id: newEventId(), occurred_at: nowIso(), ...input };
      appendLine(logPath, JSON.stringify(event));
      return event;
    },
    getLifecycleRun(candidate_id) {
      const events = readAllEvents().filter((e) => e.candidate_id === candidate_id);
      const last = events[events.length - 1] ?? null;
      return {
        candidate_id,
        events,
        current_stage: last?.stage ?? null,
        current_status: last?.status ?? null,
        is_complete: last !== null && last.stage === TERMINAL_STAGE && last.status === TERMINAL_STATUS,
      };
    },
  };
}
