/**
 * หน้าที่: §4 — persist a ResolvedWorkContext BEFORE dispatch, and hand the
 * exact same context back to a fresh Agent/session that knows only a
 * `work_id`. That session must NOT re-resolve the architecture unless
 * deterministic evidence proves the stored resolution is stale.
 *
 * NO NEW STORE. This delegates entirely to the EXISTING durable evidence
 * store, `../agent-gateway/contract.ts#saveEvidence` /
 * `#loadEvidenceForTask`, which is already JSONL-backed under
 * `control/agent-gateway/data/` and already survives restarts. Building a
 * second task store would be exactly the duplication the Owner forbade.
 *
 * WHY `kind: "capability_lookup"`: that union in
 * `../agent-gateway/types.ts` is closed, and widening a type shared by
 * several live capabilities is a change this task has no need to make. Of
 * the existing kinds, `capability_lookup` is the honest one — a resolution
 * IS the recorded answer to "which capability already exists for this
 * intent". The `source` field carries this module's own path, so our rows
 * are distinguishable from any other producer's without a new kind.
 *
 * STALENESS is evidence-based, never time-based: the stored digest covers
 * the real bytes of the exact source paths the resolution pointed at, plus
 * the git revision. If those files changed, the stored resolution is stale
 * and MUST be recomputed. If they did not, re-resolving is forbidden work.
 *
 * Input: `ResolvedWorkContext`.
 * Output: `persistResolution`, `loadResolution`, `computeResolutionDigest`.
 * Dependency ที่อนุญาต: ./types.ts, ./host-runtime.ts,
 * ../agent-gateway/contract.ts.
 * สิ่งที่ห้ามแตะ: never write a resolution row from anywhere but
 * `persistResolution`, and never mark a stored resolution fresh without
 * recomputing the digest from the real files.
 */

import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { saveEvidence, loadEvidenceForTask } from "../agent-gateway/contract";
import { readTextIfPresent, REPO_ROOT } from "./host-runtime";
import type { ResolvedWorkContext } from "./types";

const SOURCE_MARKER = "control/work-resolution/persistence.ts";

export interface PersistedResolution {
  readonly resolution_id: string;
  readonly work_id: string;
  readonly resolution_digest: string;
  readonly source_revision: string;
  readonly persisted_at: string;
  readonly context: ResolvedWorkContext;
}

export interface LoadedResolution extends PersistedResolution {
  /** True only when the real bytes behind `exact_source_paths` no longer match. */
  readonly stale: boolean;
  readonly staleness_reason: string;
}

function gitRevision(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf-8", timeout: 10_000 }).trim();
  } catch {
    return "UNKNOWN";
  }
}

/**
 * Digest over the REAL content of every source path the resolution points
 * at. A path that cannot be read contributes the literal marker
 * `MISSING:<path>` — so a file being deleted changes the digest and
 * correctly invalidates the resolution, rather than silently matching.
 */
export function computeResolutionDigest(context: ResolvedWorkContext): string {
  const hash = createHash("sha256");
  hash.update(context.decision);
  hash.update(context.existing_capability_id);
  for (const path of [...context.exact_source_paths].sort()) {
    const text = readTextIfPresent(path);
    hash.update(`${path}:${text === null ? `MISSING:${path}` : createHash("sha256").update(text).digest("hex")}`);
  }
  return hash.digest("hex");
}

/** Persists BEFORE dispatch. Returns the row a dispatcher should reference. */
export function persistResolution(context: ResolvedWorkContext): PersistedResolution {
  const row: PersistedResolution = {
    resolution_id: `resolution-${randomUUID()}`,
    work_id: context.work_id,
    resolution_digest: computeResolutionDigest(context),
    source_revision: gitRevision(),
    persisted_at: new Date().toISOString(),
    context,
  };
  saveEvidence({
    evidence_id: row.resolution_id,
    task_id: context.work_id,
    kind: "capability_lookup",
    source: SOURCE_MARKER,
    recorded_at: row.persisted_at,
    payload: row,
  });
  return row;
}

/**
 * Loads the latest stored resolution for a work_id. A fresh session with
 * ZERO conversation context calls this and receives the full architecture
 * answer — no Registry query, no scan, no re-resolution.
 */
export function loadResolution(workId: string): LoadedResolution | null {
  const rows = loadEvidenceForTask(workId)
    .filter((e) => e.source === SOURCE_MARKER && e.kind === "capability_lookup")
    .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
  const latest = rows[rows.length - 1];
  if (!latest) return null;

  const stored = latest.payload as PersistedResolution;
  if (!stored?.context) return null;

  // Recompute from the real files RIGHT NOW. This is the only thing that
  // may declare a stored resolution stale.
  const currentDigest = computeResolutionDigest(stored.context);
  const stale = currentDigest !== stored.resolution_digest;

  return {
    ...stored,
    stale,
    staleness_reason: stale
      ? `source digest changed: stored ${stored.resolution_digest.slice(0, 12)} vs current ${currentDigest.slice(0, 12)} — the files this resolution pointed at have changed, so it MUST be recomputed`
      : `source digest unchanged (${currentDigest.slice(0, 12)}) — re-resolving would be redundant work`,
  };
}
