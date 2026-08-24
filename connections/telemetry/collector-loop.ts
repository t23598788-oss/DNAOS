/**
 * หน้าที่: the periodic collector (Owner item 1, "cadence"). A thin
 * setInterval wrapper around ./collector.ts + ./store.ts — same
 * recovery-only/heartbeat shape as control/agent-gateway/supervisor.ts,
 * not a second controller. One capture on start, then one every
 * DEFAULT_CADENCE_MS, each persisted immediately.
 *
 * Input: none.
 * Output: startTelemetryCollector(): { stop(): void }.
 * Dependency ที่อนุญาต: ./collector.ts, ./store.ts.
 * สิ่งที่ห้ามแตะ: never let a failed capture throw out of the interval
 * loop — a capture failure is logged as a skipped tick, never crashes the
 * host process.
 */
import { captureTelemetrySnapshot } from "./collector";
import { saveSnapshot, pruneOldSnapshots, DEFAULT_RETENTION_COUNT } from "./store";

export const DEFAULT_CADENCE_MS = 30_000;

async function tick(): Promise<void> {
  try {
    const snapshot = await captureTelemetrySnapshot();
    saveSnapshot(snapshot);
    pruneOldSnapshots(DEFAULT_RETENTION_COUNT);
  } catch {
    // A failed capture must never crash the collector loop — the next
    // tick simply tries again; ./provenance.ts's staleness check is what
    // surfaces a run of failures to a reader, not an exception here.
  }
}

export function startTelemetryCollector(cadenceMs: number = DEFAULT_CADENCE_MS): { stop(): void } {
  void tick();
  const timer = setInterval(() => void tick(), cadenceMs);
  return { stop: () => clearInterval(timer) };
}
