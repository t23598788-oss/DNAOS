/**
 * หน้าที่: ties a filesystem change to a process ONLY as far as the OS
 * evidence actually reaches (Owner, 2026-08-26).
 *
 * Three verdicts, and the boundary between them is the whole point:
 *   PROVEN            the process holds that exact file open (lsof fd)
 *   POSSIBLY_RELATED  the file sits under the process's observed cwd, but no
 *                     descriptor ties it to the write
 *   UNKNOWN           nothing observed connects them
 *
 * A POSSIBLY_RELATED never becomes a PROVEN by being looked at again. It is
 * promoted only if NEW OS evidence appears — a descriptor on that path. There
 * is no code path in this file that upgrades a verdict without one.
 *
 * WHAT THIS CANNOT DO, STATED: `fs.watch` gives no writer identity, and lsof is
 * a snapshot. A process that opened a file, wrote it and closed it before the
 * snapshot leaves no descriptor to find — that case is UNKNOWN, and calling it
 * anything else would be inventing the writer.
 *
 * Input: a `ChangeEvent` + observed processes.
 * Output: `CorrelationCandidate[]` — one per process considered, with reasons.
 * Dependency ที่อนุญาต: ./types.ts, ../realtime-change/contract.ts (types).
 * สิ่งที่ห้ามแตะ: ห้าม promote verdict โดยไม่มีหลักฐาน OS ใหม่.
 */

declare const require: any;

import type { CorrelationCandidate, ProcessObservation } from "./types";
import type { ChangeEvent } from "../realtime-change/contract";

const fs = require("node:fs");

/**
 * macOS resolves `/tmp` and `/var` through symlinks, and `lsof` reports the
 * RESOLVED path while a watcher reports the path it was given. Comparing the
 * two literally made a process that provably held a file look unrelated
 * (measured 2026-08-26). Both sides are resolved before comparison; a path
 * that cannot be resolved falls back to itself rather than failing the check.
 */
function realPath(candidate: string): string {
  try {
    return String(fs.realpathSync(candidate));
  } catch {
    return candidate;
  }
}

export function correlate(event: ChangeEvent, processes: readonly ProcessObservation[]): readonly CorrelationCandidate[] {
  if (processes.length === 0) {
    return [{ event_id: event.event_id, path: event.path, pid: null, verdict: "UNKNOWN", reason: "no process was observed at the time of this event", evidence: [] }];
  }

  return processes.map((observation) => {
    const eventReal = realPath(event.path);
    const holdsFile = observation.open_files.some((file) => file === event.path || realPath(file) === eventReal);
    if (holdsFile) {
      return {
        event_id: event.event_id, path: event.path, pid: observation.pid, verdict: "PROVEN" as const,
        reason: "the process holds this exact path open",
        evidence: [`lsof -p ${observation.pid} -Fpftn lists ${event.path}`, `event observed_at=${event.observed_at}`, `process started_at=${observation.started_at}`],
      };
    }
    const cwdReal = observation.cwd === null ? null : realPath(observation.cwd);
    const underCwd = cwdReal !== null && (eventReal === cwdReal || eventReal.startsWith(`${cwdReal}/`));
    if (underCwd) {
      return {
        event_id: event.event_id, path: event.path, pid: observation.pid, verdict: "POSSIBLY_RELATED" as const,
        reason: "the changed path is inside the process's working directory, but no open descriptor ties this process to the write",
        evidence: [`lsof -p ${observation.pid} -Fpftn (fcwd)=${observation.cwd}`, `event path=${event.path}`],
      };
    }
    return {
      event_id: event.event_id, path: event.path, pid: observation.pid, verdict: "UNKNOWN" as const,
      reason: "nothing observed connects this process to the changed path",
      evidence: [],
    };
  });
}

/** The strongest verdict present — used for reporting, never for promotion. */
export function strongestVerdict(candidates: readonly CorrelationCandidate[]): CorrelationCandidate {
  const proven = candidates.find((c) => c.verdict === "PROVEN");
  if (proven) return proven;
  const possible = candidates.find((c) => c.verdict === "POSSIBLY_RELATED");
  if (possible) return possible;
  return candidates[0];
}
