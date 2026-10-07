/**
 * หน้าที่: the realtime filesystem event producer (Owner, 2026-08-26).
 *
 * NO POLLING, NO REPOSITORY-WIDE SCAN. This uses Node's `fs.watch`, which on
 * macOS is backed by the kernel's FSEvents — the OS tells us, we do not ask it
 * repeatedly. Nothing walks the repository, and no model is anywhere near this
 * file: detecting that a byte changed is not a question anyone should be asked
 * to interpret.
 *
 * IT WATCHES WHAT WORK IS ACTUALLY HAPPENING IN. The scope comes from the
 * runtime registries that already exist — `control/work-coordination/`'s held
 * write locks and `control/agent-host/`'s active launches — never from a
 * hard-coded folder list. When nothing is being worked on, nothing is watched,
 * and that is the honest state rather than a reason to watch everything.
 *
 * IT REPORTS WHAT THE OS SAID. `ChangeEvent.filesystem_evidence` is a real
 * `stat` at observation time; `source` names the observing mechanism, not a
 * guess about which process did the writing. Which process wrote a file is an
 * OS-evidence question, and where this repo has no such evidence it says so
 * instead of inventing an author.
 *
 * Input: `startObserving(onChange, extraScopes?)`.
 * Output: `ChangeEvent`s to the callback; `observationStatus()`.
 * Dependency ที่อนุญาต: ./types.ts, ../work-coordination/contract.ts,
 * ../agent-host/contract.ts, node built-ins.
 * สิ่งที่ห้ามแตะ:
 * - ห้าม poll, ห้าม walk ทั้งเรโป.
 * - ห้ามสร้าง event เมื่อ observer ใช้งานไม่ได้ — `OBSERVATION_UNAVAILABLE`
 *   ต้องเป็นสถานะที่รายงานตรงๆ.
 * - ห้ามเดาว่า process ไหนเป็นคนเขียน.
 */

declare const require: any;
declare const process: { env: Record<string, string | undefined> };

import type { ChangeEvent, ObservationStatus, WatchScope } from "./types";
import { listWriteLocks } from "../work-coordination/contract";
import { listActiveLaunches } from "../agent-host/contract";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const OBSERVER_SOURCE = "control/realtime-change/observer.ts#fs.watch (macOS FSEvents-backed)";

interface Watcher { close(): void }

let watchers: { watcher: Watcher; scope: WatchScope }[] = [];
let startedAt: string | null = null;
let unavailableReason: string | null = null;

/**
 * The scopes to watch, derived from what the system is really doing right now.
 * A write lock is the strongest signal (someone declared a boundary they are
 * writing inside); an active launch's workspace is the second.
 */
export function currentWatchScopes(extra: readonly WatchScope[] = []): readonly WatchScope[] {
  const scopes: WatchScope[] = [];
  for (const lock of listWriteLocks()) {
    const record = lock as unknown as Record<string, unknown>;
    const scopePath = String(record.scope_path ?? record.path ?? "");
    if (scopePath.length > 0) scopes.push({ path: scopePath, origin: "WRITE_LOCK", origin_ref: String(record.holder_id ?? record.holder ?? record.claim_id ?? "unknown-holder") });
  }
  for (const launch of listActiveLaunches()) {
    scopes.push({ path: launch.allowedWorkspaceDir, origin: "ACTIVE_LAUNCH", origin_ref: launch.launchId });
  }
  scopes.push(...extra);

  // De-duplicate by path; the first origin that claimed it wins, so the
  // strongest justification is the one recorded on the event.
  const seen = new Set<string>();
  return scopes.filter((scope) => (seen.has(scope.path) ? false : (seen.add(scope.path), true)));
}

function statEvidence(fullPath: string): ChangeEvent["filesystem_evidence"] {
  try {
    const stat = fs.statSync(fullPath);
    return { exists: true, size_bytes: stat.size, mtime: new Date(stat.mtimeMs).toISOString(), inode: stat.ino, note: null };
  } catch (error) {
    return { exists: false, size_bytes: null, mtime: null, inode: null, note: `stat failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * Starts watching. Returns the status it actually achieved — a caller must
 * never assume observation is running because this was called.
 */
export function startObserving(onChange: (event: ChangeEvent) => void, extraScopes: readonly WatchScope[] = []): ObservationStatus {
  stopObserving();
  const scopes = currentWatchScopes(extraScopes);
  if (scopes.length === 0) {
    unavailableReason = "no write lock and no active launch — there is no work in progress to observe";
    return { observing: false, reason: "OBSERVATION_UNAVAILABLE", detail: unavailableReason };
  }

  const started: { watcher: Watcher; scope: WatchScope }[] = [];
  const failures: string[] = [];
  for (const scope of scopes) {
    try {
      const watcher = fs.watch(scope.path, { recursive: true }, (eventType: string, filename: string | null) => {
        if (!filename) return;
        const fullPath = path.join(scope.path, filename);
        onChange({
          event_id: crypto.randomUUID(),
          path: fullPath,
          event_type: eventType === "rename" ? "rename" : "change",
          observed_at: new Date().toISOString(),
          source: OBSERVER_SOURCE,
          filesystem_evidence: statEvidence(fullPath),
          watch_scope: scope,
        });
      });
      started.push({ watcher, scope });
    } catch (error) {
      failures.push(`${scope.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (started.length === 0) {
    unavailableReason = `every watch failed — ${failures.join("; ")}`;
    return { observing: false, reason: "OBSERVATION_UNAVAILABLE", detail: unavailableReason };
  }

  watchers = started;
  startedAt = new Date().toISOString();
  unavailableReason = failures.length > 0 ? `partial: ${failures.join("; ")}` : null;
  return { observing: true, scopes: started.map((entry) => entry.scope), since: startedAt };
}

export function observationStatus(): ObservationStatus {
  if (watchers.length === 0) {
    return { observing: false, reason: "OBSERVATION_UNAVAILABLE", detail: unavailableReason ?? "the observer has not been started" };
  }
  return { observing: true, scopes: watchers.map((entry) => entry.scope), since: startedAt ?? "unknown" };
}

export function stopObserving(): void {
  for (const entry of watchers) {
    try { entry.watcher.close(); } catch { /* a watcher already closed by the OS must not break shutdown */ }
  }
  watchers = [];
  startedAt = null;
}
