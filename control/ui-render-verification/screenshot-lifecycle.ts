/**
 * หน้าที่: places every render screenshot inside the EXISTING resource /
 * evidence lifecycle, and says which ones are still in use (Owner,
 * 2026-08-26).
 *
 * NO SECOND IDENTITY SYSTEM. A screenshot's identity comes from the same path
 * resolver every other file goes through (`../realtime-change/`'s
 * `resolvePath` over `software/registry-database`). When no registered
 * resource covers it, the answer is `UNRESOLVED_RESOURCE` — an honest gap, not
 * a licence to mint an id of its own.
 *
 * NO SECOND RETENTION SYSTEM, AND NO DELETING HERE. This file classifies;
 * nothing in it unlinks, truncates or prunes anything, and
 * ./render-verify.ts does not either. Removal is for whatever cleanup boundary
 * the Owner points at, acting on this classification.
 *
 * CURRENT vs HISTORICAL IS DECIDED BY THE TASK STORE, NOT BY AGE OR BY A
 * MODEL. Evidence whose execution is still open (a task in a non-terminal
 * state) is in use and protected. Everything else is a lifecycle candidate —
 * a candidate, not a deletion.
 *
 * Input: none (reads the render evidence log and the gateway task store).
 * Output: `classifyRenderEvidence()`, `screenshotLineage()`,
 * `offerHistoricalScreenshotsToLifecycle()`.
 * Dependency ที่อนุญาต: ./render-verify.ts, ../agent-gateway/contract.ts,
 * ../realtime-change/contract.ts, ../../software/registry-database/.
 * NOT ../machine-observation/: it exported a delete, that delete is gone, and
 * this file must not reach for another one.
 * สิ่งที่ห้ามแตะ:
 * - ห้ามลบ/prune ไฟล์จากไฟล์นี้.
 * - ห้ามสร้าง resource_id ให้ screenshot เอง.
 * - ห้ามใช้ AI จำแนก.
 */

import { readRenderEvidence } from "./render-verify";
import type { RenderEvidence } from "./types";
import { getTask } from "../agent-gateway/contract";
import { resolvePath } from "../realtime-change/contract";
import { createPersistentFileStore } from "../../software/registry-database/adapters/persistent-file-store";

declare const require: any;
const fs = require("node:fs");

/** Task states that mean the execution is finished. Anything else is still open. */
const TERMINAL = new Set(["COMPLETED", "FAILED", "BLOCKED"]);

export type EvidenceLifecycleState = "CURRENT_RENDER_EVIDENCE" | "HISTORICAL_RENDER_EVIDENCE";

export interface ScreenshotLineage {
  screenshot_path: string;
  exists_on_disk: boolean;
  execution_id: string;
  change_id: string;
  route: string;
  source_digest: string;
  /** From the existing registry lookup, or the explicit gap. */
  resource_id: readonly string[] | "UNRESOLVED_RESOURCE";
  resolution_evidence: readonly string[];
  capability_id: readonly string[];
  lifecycle_state: EvidenceLifecycleState;
  lifecycle_reason: string;
  verdict: RenderEvidence["verdict"];
}

export function screenshotLineage(evidence: RenderEvidence): ScreenshotLineage {
  const store = createPersistentFileStore();
  // The screenshot file itself, resolved the same way any other path is.
  const resolution = evidence.screenshot_path.length > 0
    ? resolvePath(evidence.screenshot_path, store)
    : { resource: null, unresolved: ["no screenshot was produced for this evidence"] };

  // The execution decides current vs historical — read from the real task store.
  const task = getTask(evidence.execution_id);
  const open = task !== undefined && !TERMINAL.has(task.status);
  const lifecycleState: EvidenceLifecycleState = open ? "CURRENT_RENDER_EVIDENCE" : "HISTORICAL_RENDER_EVIDENCE";
  const lifecycleReason = task === undefined
    ? `no task "${evidence.execution_id}" in control/agent-gateway — the execution is not open, so this is a lifecycle candidate`
    : open
      ? `task ${task.task_id} is ${task.status}, which is not terminal — this evidence is in use and protected`
      : `task ${task.task_id} is ${task.status} — the execution is closed, so this is a lifecycle candidate`;

  return {
    screenshot_path: evidence.screenshot_path,
    exists_on_disk: evidence.screenshot_path.length > 0 && fileExists(evidence.screenshot_path),
    execution_id: evidence.execution_id,
    change_id: evidence.change_id,
    route: evidence.route,
    source_digest: evidence.source_digest,
    resource_id: resolution.resource ? [resolution.resource.resource_id] : "UNRESOLVED_RESOURCE",
    resolution_evidence: resolution.resource ? resolution.resource.evidence : resolution.unresolved,
    capability_id: evidence.capability_id,
    lifecycle_state: lifecycleState,
    lifecycle_reason: lifecycleReason,
    verdict: evidence.verdict,
  };
}

function fileExists(path: string): boolean {
  try { return fs.statSync(path).size > 0; } catch { return false; }
}

export function classifyRenderEvidence(): readonly ScreenshotLineage[] {
  return readRenderEvidence().map(screenshotLineage);
}

export interface ScreenshotLifecycleOffer {
  classified_current: number;
  classified_historical: number;
  /** Still-open executions. Filtered out before anything is offered, and named so the exclusion is visible. */
  protected_paths: readonly string[];
  /** Historical, beyond `keep_newest`. NAMED, NOT DELETED — nothing here has been touched. */
  lifecycle_candidates: readonly string[];
  /** Historical but within `keep_newest`, so not even offered. */
  retained_newest: readonly string[];
  candidate_reason: string;
  /** Where the decision to reclaim any of these actually lives. */
  decided_by: string;
  offered_at: string;
}

/**
 * Names the historical screenshots the storage lifecycle may consider. It does
 * not delete them, and after this change nothing in this repository can.
 *
 * WHAT CHANGED AND WHY (Owner, 2026-08-26). This function used to call
 * `pruneClassifiedFiles()` in ../machine-observation/, which unlinked the
 * files. That made the observation layer a second mutation boundary — the same
 * defect that had just been removed from the observation archive rotation, in
 * the same file, arriving by a different door. The classification below is
 * unchanged and was never the problem; only the deletion is gone.
 *
 * WHERE THE CANDIDATES GO, STATED HONESTLY. There is no push. The storage
 * lifecycle in ~/Desktop/dna-os-deadboard discovers these paths by scanning
 * the machine, and `engines/storage/scope.ts#resolveScope` resolves this
 * directory to MUTABLE — verified 2026-08-26, rule HOME_DEFAULT. MUTABLE is
 * not AUTO_TRASH: `runLifecycleCircuit` turns clean evidence at MUTABLE scope
 * into REVIEW, not TRASH_ELIGIBLE. So a candidate named here reaches an owner
 * decision, never an automatic deletion.
 *
 * The practical consequence, which should not be glossed: screenshots that
 * this function once removed on its own will now accumulate until an owner
 * acts. That is the intended trade — seeing a resource never granted the right
 * to delete it — and it puts render evidence in exactly the same regime as the
 * observation archives already occupy.
 */
export function offerHistoricalScreenshotsToLifecycle(keepNewest: number): ScreenshotLifecycleOffer {
  const all = classifyRenderEvidence();
  const current = all.filter((lineage) => lineage.lifecycle_state === "CURRENT_RENDER_EVIDENCE");
  const historical = all.filter((lineage) => lineage.lifecycle_state === "HISTORICAL_RENDER_EVIDENCE" && lineage.exists_on_disk);

  // Newest first, so `keep_newest` keeps the most recent evidence — the same
  // ordering the removed prune used, now deciding what is OFFERED rather than
  // what is destroyed.
  const byNewest = [...historical].sort((a, b) => mtimeOf(b.screenshot_path) - mtimeOf(a.screenshot_path));
  const retained = byNewest.slice(0, Math.max(0, keepNewest)).map((l) => l.screenshot_path);
  const candidates = byNewest.slice(Math.max(0, keepNewest)).map((l) => l.screenshot_path);

  return {
    classified_current: current.length,
    classified_historical: historical.length,
    protected_paths: current.map((l) => l.screenshot_path),
    lifecycle_candidates: candidates,
    retained_newest: retained,
    candidate_reason: candidates.length > 0
      ? `${historical.length} screenshot(s) belong to closed executions; the newest ${retained.length} are retained and the remaining ${candidates.length} are offered to the storage lifecycle as candidates. None was deleted.`
      : `${historical.length} historical screenshot(s), all within keep_newest=${keepNewest} — nothing is offered`,
    decided_by: "~/Desktop/dna-os-deadboard engines/storage/lifecycleCircuit.ts (verdict) -> adapters/trashAdapter.ts (the only mutation boundary). This capability classifies and names; it does not decide and does not act.",
    offered_at: new Date().toISOString(),
  };
}

function mtimeOf(path: string): number {
  try { return fs.statSync(path).mtimeMs; } catch { return 0; }
}
