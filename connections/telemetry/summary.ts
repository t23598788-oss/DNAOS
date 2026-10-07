/**
 * หน้าที่: the dashboard/Owner-Console/voice-summary adapter for
 * telemetry — read-only, composes ./store.ts + ./provenance.ts into one
 * structured answer. Speaking (if the caller wants it) reuses the SAME
 * gated `runUiWorkOrder({ui_action:"speak"})` path
 * `connections/os-ui/screen-summary.ts` already established — never a
 * second speech mechanism. Text spoken is deliberately restricted to
 * bounded numeric summary fields (cpu load / free-mem percent / disk
 * percent / freshness) — network interface addresses and listening ports
 * are never included in the spoken text (still available in the
 * structured `TelemetryReadResult`, e.g. for a Dashboard's own JSON view).
 *
 * Input: none.
 * Output: readTelemetry(): TelemetryReadResult; speakTelemetrySummary().
 * Dependency ที่อนุญาต: ./contract.ts, ./store.ts, ./provenance.ts,
 * ../os-ui/adapter-contract.ts (runUiWorkOrder only).
 * สิ่งที่ห้ามแตะ: never include network_interfaces/listening_ports text in
 * anything passed to runUiWorkOrder's speak action.
 */
import { loadLatestSnapshot } from "./store";
import { classifyFreshness } from "./provenance";
import type { FreshnessResult, TelemetrySnapshot } from "./contract";
import { runUiWorkOrder } from "../os-ui/adapter-contract";

export interface TelemetryReadResult {
  snapshot: TelemetrySnapshot | null;
  freshness: FreshnessResult;
  source: "STORE" | "MISSING";
}

/** The one real read path for Owner Console / a dashboard — always reads fresh from disk, always classifies freshness, never returns a snapshot silently past its expires_at without saying so. */
export function readTelemetry(): TelemetryReadResult {
  const snapshot = loadLatestSnapshot();
  return { snapshot, freshness: classifyFreshness(snapshot), source: snapshot ? "STORE" : "MISSING" };
}

function boundedSummaryText(result: TelemetryReadResult): string {
  if (!result.snapshot) return "No telemetry snapshot is available — source is missing.";
  const s = result.snapshot;
  const freeMemPercent = Math.round((s.cpu_ram.free_mem_bytes / s.cpu_ram.total_mem_bytes) * 100);
  const diskLine = s.disk.capacity_percent !== null ? `disk ${s.disk.capacity_percent} percent used` : "disk unknown";
  return `Telemetry is ${result.freshness.status.toLowerCase()}. Load ${s.cpu_ram.load_avg_1m.toFixed(2)}, ${freeMemPercent} percent memory free, ${diskLine}.`;
}

/** Caller-driven only — never auto-speaks, matching ../os-ui/screen-summary.ts's own convention. */
export async function speakTelemetrySummary(timeoutMs: number): Promise<Awaited<ReturnType<typeof runUiWorkOrder>>> {
  const result = readTelemetry();
  const text = boundedSummaryText(result);
  return runUiWorkOrder({ ui_action: "speak", target: text, scope: "telemetry-summary", timeout_ms: timeoutMs, dry_run: false, risk_confirmed: true });
}
