/**
 * หน้าที่: THE PROCESSING FABRIC's pool — real, discovered "AI-as-chip"
 * compute units (Owner: "AI เป็นชิป" — AI is compute, never a fixed
 * identity a work kind is married to). A `ProcessingUnit` is one
 * concurrent slot of a real provider (`control/agent-host/worker-registry.ts#WorkerKind`)
 * — `CLAUDE#1`, `CLAUDE#2`, `CODEX#1`, `LOCAL#1`, etc. — discovered by the
 * SAME real `resolveWorker` existence check Agent Host itself uses, never
 * assumed present.
 *
 * This file owns exactly two things: WHAT compute exists (`discoverPool`,
 * honest — a provider with no real binary on this host gets zero units,
 * disclosed, not silently hidden), and the HISTORICAL RECORD of how each
 * unit's provider has actually performed (`recordMetric`/`loadMetrics`, an
 * append-only ledger, same durability convention as
 * `control/scheduler/data/loop-events.jsonl`). It makes no selection
 * decision itself — that is `./capability-router.ts`'s exclusive job.
 *
 * Input: none at module scope; `discoverPool` takes a pool size, `recordMetric`
 * takes one real observed dispatch outcome.
 * Output: `ProviderKind`, `ProcessingUnit`, `ProviderMetricRecord`,
 * `discoverPool`, `recordMetric`, `loadMetrics`, `REASONING_WORK_KINDS`.
 * Dependency ที่อนุญาต: ../agent-host/contract.ts (resolveWorker,
 * listWorkerKinds — read-only existence checks), ../work-graph/types.ts
 * (types only), node:fs, node:path.
 * สิ่งที่ห้ามแตะ: never fabricate a unit for a provider `resolveWorker` could
 * not find. Never invent a cost figure — no real token/cost field exists
 * anywhere in this repo's `DnaOsAgentResult` yet, so cost stays `null`
 * (UNKNOWN), never a guessed number that would silently bias routing.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveWorker, listWorkerKinds } from "../agent-host/contract";
import type { WorkerKind } from "../agent-host/contract";
import type { WorkKind } from "../work-graph/types";

export type ProviderKind = WorkerKind; // "CLAUDE" | "CODEX" | "GEMINI" | "LOCAL" — the real, existing closed set; no new identity introduced.

/** The four kinds `./capability-router.ts` ever routes to a real provider — VERIFY_CAPABILITY/EXTERNAL never reach the fabric (see their own worker_class doc in ../work-graph/types.ts). */
export const REASONING_WORK_KINDS: readonly WorkKind[] = ["WIRE_OR_RETIRE", "REPAIR", "IMPLEMENT", "RESOLVE_DEPENDENCY"];

export interface ProcessingUnit {
  unit_id: string; // e.g. "CLAUDE#1"
  provider: ProviderKind;
  /** false only when `resolveWorker` could not find a real executable on THIS host — the unit still exists in the pool (so it is visible/disclosed), it is just never selectable. */
  available: boolean;
  detail: string;
}

const REPO_ROOT = process.cwd();
const METRICS_LOG = join(REPO_ROOT, "control/scheduler/data/provider-metrics.jsonl");

/**
 * Real discovery — one `resolveWorker` call per provider kind, exactly the
 * same check `control/agent-host/host-runtime.ts` itself relies on before
 * ever launching anything. `poolSizePerProvider` is the concurrency CAP for
 * an available provider (how many real, simultaneous CLI processes of that
 * kind `./capability-router.ts` may hand out at once) — never a claim that
 * that many processes are already running.
 */
export function discoverPool(poolSizePerProvider: number): readonly ProcessingUnit[] {
  const units: ProcessingUnit[] = [];
  for (const kind of listWorkerKinds()) {
    const resolution = resolveWorker(kind);
    const size = kind === "LOCAL" ? 1 : poolSizePerProvider; // LOCAL is a single free deterministic fallback, not a real concurrent process pool
    for (let i = 1; i <= size; i += 1) {
      units.push({
        unit_id: `${kind}#${i}`,
        provider: kind,
        available: resolution.ok,
        detail: resolution.ok ? `real executable resolved` : `${(resolution as { reason: string }).reason}`,
      });
    }
  }
  return units;
}

export interface ProviderMetricRecord {
  recorded_at: string;
  unit_id: string;
  provider: ProviderKind;
  work_kind: WorkKind;
  outcome: "PARTIAL" | "BLOCKED" | "VERIFIED" | "FAILED";
  duration_ms: number;
  /** Always null today — no real token/cost field exists in `DnaOsAgentResult` yet. Present in the shape so a future real cost source needs no schema change, never populated with a guess. */
  cost: number | null;
}

export function recordMetric(record: ProviderMetricRecord): void {
  mkdirSync(join(REPO_ROOT, "control/scheduler/data"), { recursive: true });
  appendFileSync(METRICS_LOG, `${JSON.stringify(record)}\n`, "utf8");
}

/** The full, real, append-only dispatch history — the empirical basis `./capability-router.ts` scores providers from. Empty (never fabricated) if no dispatch has happened yet. */
export function loadMetrics(): readonly ProviderMetricRecord[] {
  if (!existsSync(METRICS_LOG)) return [];
  return readFileSync(METRICS_LOG, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as ProviderMetricRecord);
}
