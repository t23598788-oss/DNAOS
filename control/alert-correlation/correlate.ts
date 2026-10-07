/**
 * หน้าที่: decide the incident state by weighing the email's CLAIM
 * against a freshly-observed system FACT. This is the file the Owner's
 * rule "อีเมลอย่างเดียวไม่ใช่ความจริงสุดท้าย" lives in.
 *
 * NO AI IS IN THIS PATH. The decision is a fixed truth table over two
 * inputs — what the email claimed, and what a real HTTP probe observed
 * just now. There is no model call, no heuristic, and no natural-language
 * judgement anywhere in this file, so the same inputs always produce the
 * same verdict and the derivation can be replayed from the evidence list.
 *
 * The decisive case (Owner's own example, proven live in
 * ./tests/runtime-proof.test.ts case C): Railway emailed "Build failed"
 * for dna-os-circuit at 06:19; the service answers HTTP 200 now. Reporting
 * that as an outage would be false. It is ALERT_HISTORICAL_RECOVERED.
 *
 * Input: `AlertEvent` + `ResolvedTarget`.
 * Output: `assessIncident`.
 * Dependency ที่อนุญาต: ./types.ts, ./host-runtime.ts.
 * สิ่งที่ห้ามแตะ: never let the email's `reported_status` alone decide
 * `ACTIVE_INCIDENT` — that is precisely the false-outage bug this file
 * exists to prevent. Never treat "probe could not run" as healthy.
 */

import { UNKNOWN, type AlertEvent, type CurrentStateObservation, type IncidentAssessment, type IncidentState, type ResolvedTarget } from "./types";
import { nowIso, probeHttp } from "./host-runtime";

/**
 * A reference host used ONLY to tell "the target is down" apart from "our
 * own network is down". Without it, a laptop offline would report every
 * service as ACTIVE_INCIDENT — a false outage, which is the exact class
 * of error this whole capability exists to prevent.
 */
const CONTROL_PROBE_URL = "https://api.github.com";

/** A 2xx/3xx answer means the service is serving. 4xx/5xx means it answered but is not well. */
function isHealthy(status: number | null): boolean {
  return status !== null && status >= 200 && status < 400;
}

function secondsBetween(fromIso: string, toIso: string): number | null {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.round((to - from) / 1000);
}

/**
 * Runs one correlation. The probe is performed by THIS software, not by
 * a caller and not by an agent — so the observation cannot be supplied
 * (or fabricated) from outside.
 */
export async function assessIncident(alert: AlertEvent, target: ResolvedTarget): Promise<IncidentAssessment> {
  const evidence: string[] = [
    `email ${alert.raw_message_reference} from ${alert.sender} at ${alert.received_at}`,
    `parsed by ${alert.parsed_by}: provider=${alert.provider} service=${alert.service} alert_type=${alert.alert_type}`,
    `claim (provider's own words): "${alert.reported_status}"`,
    `target resolution: ${target.reason}`,
  ];

  if (!target.resolved) {
    evidence.push("no observation attempted — an unresolved target cannot be probed");
    return { incident_state: "UNRESOLVED_ALERT", alert, target, observation: null, claim_to_observation_seconds: null, evidence };
  }

  if (target.health_url === UNKNOWN) {
    evidence.push("target resolved but no probe-able URL is known — refusing to claim healthy or unhealthy");
    return { incident_state: "UNVERIFIABLE", alert, target, observation: null, claim_to_observation_seconds: null, evidence };
  }

  const probe = await probeHttp(target.health_url);
  const observation: CurrentStateObservation = {
    observed_at: nowIso(),
    probe_target: target.health_url,
    reachable: probe.reachable,
    http_status: probe.status,
    detail: probe.detail,
  };
  const gap = secondsBetween(alert.received_at, observation.observed_at);
  evidence.push(`live probe of ${target.health_url} at ${observation.observed_at}: ${probe.detail}`);
  if (gap !== null) evidence.push(`observation is ${gap}s after the email's claim`);

  // An unreachable host is NOT proof of an outage: it is equally
  // consistent with our own network being broken. Distinguish the two
  // with a control probe before ever claiming a service is down.
  if (!observation.reachable) {
    const control = await probeHttp(CONTROL_PROBE_URL);
    if (!control.reachable) {
      evidence.push(`control probe of ${CONTROL_PROBE_URL} ALSO failed (${control.detail}) — this machine's network cannot reach anything, so the target's state is unobservable`);
      evidence.push("VERDICT: refusing to report an outage on evidence that only shows our own connectivity failing");
      return { incident_state: "UNVERIFIABLE", alert, target, observation, claim_to_observation_seconds: gap, evidence };
    }
    evidence.push(`control probe of ${CONTROL_PROBE_URL} succeeded (${control.detail}) — our network works, so the target being unreachable is a real fact about the target`);
  }

  const healthy = isHealthy(observation.http_status);
  let incident_state: IncidentState;
  if (healthy) {
    incident_state = "ALERT_HISTORICAL_RECOVERED";
    evidence.push("VERDICT: the system is serving now, so the email's failure claim describes a past state, not a current outage");
  } else {
    incident_state = "ACTIVE_INCIDENT";
    evidence.push(`VERDICT: the email claimed failure AND the system is still not serving (${observation.detail}) — the claim is corroborated by a fact observed just now`);
  }

  return { incident_state, alert, target, observation, claim_to_observation_seconds: gap, evidence };
}
