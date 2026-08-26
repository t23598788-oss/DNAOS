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
 * Output: `classifyRenderEvidence()`, `screenshotLineage()`.
 * Dependency ที่อนุญาต: ./render-verify.ts, ../agent-gateway/contract.ts,
 * ../realtime-change/contract.ts, ../../software/registry-database/.
 * สิ่งที่ห้ามแตะ:
 * - ห้ามลบ/prune ไฟล์จากไฟล์นี้.
 * - ห้ามสร้าง resource_id ให้ screenshot เอง.
 * - ห้ามใช้ AI จำแนก.
 */

import { readRenderEvidence } from "./render-verify";
import type { RenderEvidence } from "./types";
import { getTask } from "../agent-gateway/contract";
import { pruneClassifiedFiles } from "../machine-observation/contract";
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

/**
 * Hands the HISTORICAL screenshots to the prune mechanism that already exists
 * in `../machine-observation/` — the same one that bounds the observation
 * archive. This capability classifies; it does not delete, and it has no
 * unlink of its own.
 *
 * Protected evidence never reaches the call: anything whose execution is still
 * open is filtered out here, before the mechanism is asked to do anything.
 */
export function submitHistoricalScreenshotsToLifecycle(keepNewest: number): {
  classified_current: number;
  classified_historical: number;
  result: ReturnType<typeof pruneClassifiedFiles>;
} {
  const all = classifyRenderEvidence();
  const current = all.filter((lineage) => lineage.lifecycle_state === "CURRENT_RENDER_EVIDENCE");
  const historical = all.filter((lineage) => lineage.lifecycle_state === "HISTORICAL_RENDER_EVIDENCE" && lineage.exists_on_disk);
  const result = pruneClassifiedFiles({
    candidates: historical.map((lineage) => lineage.screenshot_path),
    keep_newest: keepNewest,
    classified_by: "control/ui-render-verification/screenshot-lifecycle.ts#classifyRenderEvidence (execution state from control/agent-gateway)",
  });
  return { classified_current: current.length, classified_historical: historical.length, result };
}
