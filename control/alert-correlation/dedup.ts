/**
 * หน้าที่: decide, deterministically, whether an incoming alert is a NEW
 * incident, an UPDATE to one already open, a DUPLICATE, or a RECOVERY
 * notice — so a provider that emails four times in thirty seconds does
 * not create four incidents.
 *
 * THE KEY DESIGN DECISION, forced by real mail rather than theory:
 * `thread_id` is NOT part of the identity. Gmail thread
 * `1a03cb91688a2d24` really does contain four Railway "Build failed"
 * messages covering TWO DIFFERENT services (dna-os-circuit ×2 and
 * owner-command-http ×2), because Railway groups by subject and the
 * subject names only the PROJECT. Keying on the thread would merge two
 * genuine incidents into one and silently drop an outage. The service is
 * what identifies the incident; the thread is only a mail artifact.
 * Proven in ./tests/runtime-proof.test.ts case B.
 *
 * Input: an `AlertEvent` + the incidents already open.
 * Output: `dedupIdentity`, `identityKey`, `classifyAlert`, `DEFAULT_WINDOW_MS`.
 * Dependency ที่อนุญาต: ./types.ts.
 * สิ่งที่ห้ามแตะ: never add `message_id` to the identity — every message
 * has a unique one, so including it makes every alert "new" and defeats
 * the whole mechanism. Never add `thread_id` (see above).
 */

import type { AlertEvent, DedupIdentity, DedupVerdict, IncidentState } from "./types";

/** Alerts for the same target inside this window are the same incident. */
export const DEFAULT_WINDOW_MS = 30 * 60 * 1000;

export function dedupIdentity(alert: AlertEvent, windowMs: number = DEFAULT_WINDOW_MS): DedupIdentity {
  const received = Date.parse(alert.received_at);
  return {
    provider: alert.provider,
    project: alert.project,
    service: alert.service,
    alert_type: alert.alert_type,
    window_index: Number.isNaN(received) ? 0 : Math.floor(received / windowMs),
  };
}

export function identityKey(identity: DedupIdentity): string {
  return [identity.provider, identity.project, identity.service, identity.alert_type, String(identity.window_index)].join("|");
}

/** One already-known incident, as the caller's store holds it. */
export interface OpenIncident {
  readonly key: string;
  readonly first_seen_at: string;
  readonly last_seen_at: string;
  readonly message_ids: readonly string[];
  readonly incident_state: IncidentState;
}

export interface DedupDecision {
  readonly verdict: DedupVerdict;
  readonly key: string;
  readonly reason: string;
}

/**
 * Pure classification against the caller's existing incidents. This
 * function never mutates a store and never performs I/O — the caller
 * owns persistence, so the same inputs are always replayable.
 */
export function classifyAlert(
  alert: AlertEvent,
  assessedState: IncidentState,
  open: readonly OpenIncident[],
  windowMs: number = DEFAULT_WINDOW_MS,
): DedupDecision {
  const key = identityKey(dedupIdentity(alert, windowMs));
  const existing = open.find((incident) => incident.key === key);

  if (!existing) {
    return { verdict: "NEW_INCIDENT", key, reason: `no open incident matches identity "${key}"` };
  }

  if (existing.message_ids.includes(alert.message_id)) {
    return { verdict: "DUPLICATE_ALERT", key, reason: `message ${alert.message_id} was already recorded against this incident` };
  }

  // A later observation showing the system serving again is a recovery,
  // not another failure — even though the EMAIL still claims failure.
  // This is the same "fact outranks claim" rule ./correlate.ts applies.
  if (assessedState === "ALERT_HISTORICAL_RECOVERED" && existing.incident_state === "ACTIVE_INCIDENT") {
    return { verdict: "RECOVERY_NOTICE", key, reason: `incident "${key}" was ACTIVE, and the current observation shows the service serving again` };
  }

  return {
    verdict: "DUPLICATE_ALERT",
    key,
    reason: `a distinct message for an already-open incident "${key}" inside the same ${Math.round(windowMs / 60000)}-minute window — recorded as evidence, no new incident created`,
  };
}
