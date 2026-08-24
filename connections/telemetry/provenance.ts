/**
 * หน้าที่: machine-readable provenance + freshness — the exact gap
 * `reports/phase16-world-evidence/pipeline.mjs` named and left open
 * (`expires_at` null for every record, freshness "UNRATED"). Every
 * TelemetrySnapshot carries a real `expires_at` (see ./collector.ts);
 * this file is the ONE place that timestamp is ever compared to "now".
 *
 * Input: TelemetrySnapshot | null.
 * Output: FreshnessResult.
 * Dependency ที่อนุญาต: ./contract.ts (types only).
 * สิ่งที่ห้ามแตะ: never classify a snapshot FRESH without comparing
 * expires_at to a real current timestamp.
 */
import type { FreshnessResult, TelemetrySnapshot } from "./contract";

export function classifyFreshness(snapshot: TelemetrySnapshot | null, now: Date = new Date()): FreshnessResult {
  if (!snapshot) return { status: "UNKNOWN", reason: "no snapshot exists — missing source, never inferred as fresh or stale" };
  if (snapshot.provenance === "UNKNOWN") return { status: "UNKNOWN", reason: "snapshot provenance is UNKNOWN — freshness cannot be claimed for data of unverified origin" };
  const expiresAt = new Date(snapshot.expires_at);
  if (Number.isNaN(expiresAt.getTime())) return { status: "UNKNOWN", reason: "expires_at is not a parseable timestamp" };
  if (now.getTime() > expiresAt.getTime()) return { status: "STALE", reason: `now (${now.toISOString()}) is after expires_at (${snapshot.expires_at})` };
  return { status: "FRESH", reason: `now (${now.toISOString()}) is before expires_at (${snapshot.expires_at})` };
}
