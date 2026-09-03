/**
 * หน้าที่: the public boundary of `control/alert-correlation/` — the only
 * file another capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md`.
 *
 * Input: re-exports only.
 * Output: `runAlertCorrelation` (the one entry point), plus the pure
 * stages for callers that need them individually, and every type.
 * Dependency ที่อนุญาต: ./pipeline.ts, ./parse.ts, ./resolve.ts,
 * ./correlate.ts, ./dedup.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never re-export `./host-runtime.ts` — `probeHttp` must
 * stay private, so no caller can hand in a fabricated observation and
 * bypass the live probe that every incident state depends on.
 */

export { runAlertCorrelation } from "./pipeline";
export type { OwnerIncidentReport } from "./pipeline";

export { parseAlertEmail, resolveProvider, PROVIDER_SENDER_DOMAINS } from "./parse";
export { resolveTarget, serviceKey, KNOWN_SERVICES } from "./resolve";
export { assessIncident } from "./correlate";
export { classifyAlert, dedupIdentity, identityKey, DEFAULT_WINDOW_MS } from "./dedup";
export type { DedupDecision, OpenIncident } from "./dedup";

export { UNKNOWN, PROVIDER_UNRESOLVED } from "./types";
export type {
  AlertEvent,
  AlertField,
  AlertType,
  CurrentStateObservation,
  DedupIdentity,
  DedupVerdict,
  IncidentAssessment,
  IncidentState,
  RawAlertEmail,
  ResolvedTarget,
} from "./types";
