/**
 * หน้าที่: the EVENT ADAPTER — turns deterministic evidence that ALREADY EXISTS
 * into the existing `DependencyEvent` contract. This is the missing production
 * layer: the evaluator was proven but nothing fed it real facts.
 *
 * IT OBSERVES NOTHING ITSELF. Every fact below is read from a producer that
 * already exists and is already the authority for that fact:
 *   `software/live-census`      capability status, registration state, runtime state
 *   verification ledger         VERIFIED/PARTIAL/FAILED/BLOCKED outcomes
 *   `software/registry-database` resource_id / capability_id issuance
 *   `control/machine-observation` (via the census `runtime_evidence` field)
 * No new observer, no new registry, no polling loop, no repository scan.
 *
 * THE UNKNOWN RULE, which is the whole safety property here: a fact that is not
 * deterministically true produces NO EVENT. There is no "probably available"
 * and no default-satisfied. `deriveEvents` emits an event only for a state it
 * can name from real recorded evidence, so an UNKNOWN can never wake work.
 *
 * Input: a `LiveCensus` (already derived elsewhere) + the verification ledger.
 * Output: `deriveEvents`, `eventsFromCapability`.
 * Dependency ที่อนุญาต: ./key.ts, ./types.ts,
 * ../../software/live-census/contract.ts (types only).
 * สิ่งที่ห้ามแตะ: never emit an event for a status this file had to guess at.
 * Every emitted event carries the real `evidence_ref` it came from, so a wake
 * can always be traced back to the fact that caused it.
 */

import { dependencyKey } from "./key";
import type { DependencyEvent } from "./types";
import type { CapabilityRecord, LiveCensus } from "../../software/live-census/contract";

/** Statuses that are deterministic enough to emit a satisfaction event for. */
const VERIFIED_STATES = new Set(["VERIFIED"]);
const RUNTIME_LIVE_STATES = new Set(["IN_USE_NOW", "RUNNING"]);

/**
 * Every dependency event a single capability record justifies RIGHT NOW.
 * Deliberately narrow: one fact, one event, one evidence_ref. A capability that
 * is merely present produces nothing — presence is not a satisfied dependency.
 */
export function eventsFromCapability(record: CapabilityRecord, observedAt: string): DependencyEvent[] {
  const out: DependencyEvent[] = [];
  const path = record.path;

  // REGISTRATION — the Registry has really issued an id for this capability.
  // `REGISTERED_STALE` is deliberately included: the id exists, which is what a
  // `registry:` blocker is waiting for. Whether the registration's evidence is
  // current is a different question, and the census already reports it
  // separately — conflating them here would make a real id look absent.
  if (record.registration_state === "REGISTERED" || record.registration_state === "REGISTERED_STALE") {
    const id = record.capability_id ?? record.registry_matches?.[0] ?? "registered";
    out.push({ key: dependencyKey("registry", path), value: record.registration_state, source: "registry",
      evidence_ref: `registry:${id}`, occurred_at: observedAt });
    if (record.resource_id) {
      out.push({ key: dependencyKey("resource", record.resource_id), value: "RESOLVED", source: "registry",
        evidence_ref: `resource_id:${record.resource_id}`, occurred_at: observedAt });
    }
  }

  // CAPABILITY EXISTS AND HAS A PUBLIC CONTRACT — what an INPUT/OUTPUT/ROUTING
  // blocker is waiting for. A DECLARED_ONLY folder has no contract and emits
  // nothing, which is correct: there is nothing to connect to yet.
  if (record.entrypoint && record.current_status !== "DECLARED_ONLY") {
    out.push({ key: dependencyKey("capability", path), value: record.current_status, source: "live-census",
      evidence_ref: `entrypoint:${record.entrypoint}@${record.source_digest}`, occurred_at: observedAt });
    out.push({ key: dependencyKey("path", record.entrypoint), value: "EXISTS", source: "live-census",
      evidence_ref: `entrypoint:${record.entrypoint}@${record.source_digest}`, occurred_at: observedAt });
  }

  // VERIFICATION — only a real VERIFIED outcome. PARTIAL/FAILED/BLOCKED emit
  // nothing: a failed verification is evidence, but it is not the evidence a
  // `verification:` blocker is waiting for, and treating it as satisfaction is
  // exactly the false wake this whole design exists to prevent.
  if (VERIFIED_STATES.has(record.current_status)) {
    out.push({ key: dependencyKey("verification", path), value: "VERIFIED", source: "verification",
      evidence_ref: record.evidence_references?.[record.evidence_references.length - 1] ?? `census:${record.source_digest}`,
      occurred_at: observedAt });
  }

  // RUNTIME — only when the census reports a state backed by real observation.
  // `UNKNOWN`/`NO_CONSUMER_OBSERVED`/`SNAPSHOT_UNAVAILABLE` emit nothing.
  if (RUNTIME_LIVE_STATES.has(record.runtime_state)) {
    out.push({ key: dependencyKey("runtime", path), value: record.runtime_state, source: "machine-observation",
      evidence_ref: `runtime_state:${record.runtime_state}@${record.last_observed}`, occurred_at: observedAt });
    out.push({ key: dependencyKey("runtime_evidence", path), value: record.runtime_state, source: "machine-observation",
      evidence_ref: `runtime_state:${record.runtime_state}@${record.last_observed}`, occurred_at: observedAt });
  }

  return out;
}

/** One record that could not be projected, kept so a producer crash can never look like an empty batch. */
export interface ProducerFailure {
  capability_path: string;
  error: string;
}

/**
 * Every dependency event the current system state justifies, PLUS every record
 * that could not be projected.
 *
 * PER-RECORD ISOLATION, and the reason it matters (found by peer review,
 * 2026-08-26): before this, one malformed record threw and killed the ENTIRE
 * batch — all 280 events, not just its own. Callers reasonably wrap a producer
 * in try/catch, so the observable result was "0 events derived", which is
 * indistinguishable from "nothing became available". Nothing wakes, nothing
 * logs, and it looks exactly like patience. That is the same silent-stall shape
 * the canonical key exists to prevent, arriving through a different door.
 *
 * So a bad record now costs its own events and nothing else, and the failure is
 * RETURNED rather than swallowed — a caller that reports `failures` can tell a
 * crashed producer apart from a quiet system.
 */
export function deriveEventsWithFailures(census: LiveCensus): { events: DependencyEvent[]; failures: ProducerFailure[] } {
  const at = census.generated_at;
  const events: DependencyEvent[] = [];
  const failures: ProducerFailure[] = [];
  for (const record of census.capabilities) {
    try {
      events.push(...eventsFromCapability(record, at));
    } catch (error) {
      failures.push({ capability_path: record?.path ?? "<unknown record>", error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { events, failures };
}

/**
 * The events only. Kept for callers that already use it; it is a pure projection
 * (same census, same events), which is what makes duplicate delivery harmless —
 * the evaluator's replay defence does the rest. Prefer
 * `deriveEventsWithFailures` when you can report the failures.
 */
export function deriveEvents(census: LiveCensus): DependencyEvent[] {
  return deriveEventsWithFailures(census).events;
}
