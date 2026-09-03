/**
 * หน้าที่: §4–§7 — deliver an OWNER_DECISION_REQUIRED incident to the
 * Owner through the EXISTING owner output boundary, and persist the
 * delivery state so a failure can never be silent.
 *
 * NO NEW OWNER OUTPUT WAS BUILT. Two existing components are reused:
 *  - `../output-routing/` — `resolveOutputConsumers` + the existing
 *    `OUTPUT_CONSUMER_REGISTRY`. This is DNA OS's canonical answer to
 *    "who is allowed to receive output", and it decides routing here.
 *  - `../../observability/joint-monitor/` — `reportViolation`, the real
 *    owner-facing surface already serving on :5178. It is the delivery
 *    transport, not a new one.
 *
 * THE INCIDENT RECORD REMAINS SOURCE OF TRUTH. This module produces a
 * payload FROM the record and reports delivery back; it never invents an
 * incident fact. An AI may later translate the payload for the Owner — it
 * cannot author it.
 *
 * Input: a `RemediationRecord` in OWNER_DECISION_REQUIRED.
 * Output: `buildEscalationPayload`, `escalateToOwner`, `loadDeliveries`.
 * Dependency ที่อนุญาต: ./types.ts, ./persistence.ts,
 * ../output-routing/contract.ts, ../../observability/joint-monitor/contract.ts,
 * ../agent-gateway/contract.ts.
 * ⚠️ WHY DELIVERY IS VERIFIED, NOT TRUSTED — a real defect in the
 * transport, found while wiring this: `joint-monitor/host-runtime.ts#hostPostJson`
 * catches EVERY error and returns `{ ok: false }`, and
 * `client.ts#reportViolation` ignores that return value and resolves
 * `void`. So `reportViolation` can never throw and never signals failure:
 * a wrapper that simply `await`ed it would report DELIVERED against a
 * dead channel, which is precisely the silent escalation failure §6
 * forbids. This module therefore PROBES the channel itself and derives
 * the delivery state from that observation. Fixing the swallow belongs in
 * the joint-monitor capability, not here.
 *
 * สิ่งที่ห้ามแตะ: never mark an incident closed because delivery
 * succeeded — delivery is an event, not a resolution. Never retry
 * unboundedly: one attempt per call, the caller owns scheduling. Never
 * replace the probe with a bare `await reportViolation(...)`.
 */

import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { saveEvidence, loadEvidenceForTask } from "../agent-gateway/contract";
import { resolveOutputConsumers } from "../output-routing/contract";
import { reportViolation } from "../../observability/joint-monitor/contract";
import type { RemediationRecord } from "./types";

const SOURCE_MARKER = "control/incident-remediation/owner-escalation.ts";

export type DeliveryState = "PENDING_DELIVERY" | "DELIVERED" | "ACKNOWLEDGED" | "DELIVERY_FAILED";

/** §5 — exactly the fields the Owner needs to decide, all derived from the record. */
export interface OwnerEscalationPayload {
  readonly incident_id: string;
  readonly work_id: string;
  readonly severity: "HIGH" | "MEDIUM" | "LOW";
  readonly category: string;
  readonly provider: string;
  readonly service_id: string;
  readonly resource_id: string;
  readonly what_failed: string;
  readonly current_real_state: string;
  readonly what_dna_os_already_tried: readonly string[];
  readonly failed_resources: readonly string[];
  readonly available_options: readonly string[];
  readonly decision_required: string;
  readonly financial_effect: "NONE" | "SPEND_REQUIRED";
  readonly estimated_cost: string;
  readonly currency: string;
  readonly impact_if_no_action: string;
  readonly evidence_refs: readonly string[];
  readonly next_action: string;
  readonly created_at: string;
}

export interface DeliveryRecord {
  readonly delivery_id: string;
  readonly incident_id: string;
  readonly state: DeliveryState;
  readonly consumer_route: string;
  readonly transport: string;
  readonly attempted_at: string;
  readonly detail: string;
  readonly payload: OwnerEscalationPayload;
}

const FINANCIAL_BLOCKS = new Set(["PAYMENT_REQUIRED", "FINANCIAL_DECISION"]);

export function buildEscalationPayload(record: RemediationRecord): OwnerEscalationPayload {
  const financial = FINANCIAL_BLOCKS.has(record.block_reason);
  const failedResources = record.attempts
    .filter((a) => a.outcome === "TOKEN_EXHAUSTED" || a.outcome === "UNAVAILABLE")
    .map((a) => `${a.provider}: ${a.outcome} — ${a.detail}`);

  return {
    incident_id: record.incident_id,
    work_id: record.work_id,
    severity: financial || record.block_reason === "REMEDIATION_POLICY_VIOLATION" ? "HIGH" : "MEDIUM",
    category: record.block_reason,
    provider: record.provider,
    service_id: record.service_id,
    resource_id: record.resource_id,
    what_failed: record.required_remediation,
    current_real_state: record.current_runtime_state,
    what_dna_os_already_tried: record.attempts.map((a) => `${a.provider}/${a.unit_id} -> ${a.outcome}`),
    failed_resources: failedResources,
    available_options: financial
      ? ["Authorise additional capacity (Owner only)", "Leave the incident open and unremediated", "Remediate manually"]
      : ["Register the missing service/capability, then re-resolve", "Leave the incident open", "Remediate manually"],
    decision_required: record.next_action,
    financial_effect: financial ? "SPEND_REQUIRED" : "NONE",
    // DNA OS holds no pricing source, so cost is honestly UNKNOWN rather
    // than an invented figure the Owner might act on.
    estimated_cost: "UNKNOWN",
    currency: "UNKNOWN",
    impact_if_no_action: financial
      ? "Remediation cannot proceed: every authorized execution resource is exhausted and restoring capacity has a cost consequence."
      : `The incident stays OPEN and "${record.required_remediation}" remains undone.`,
    evidence_refs: [
      `remediation:${record.incident_id}`,
      ...(record.resolution_id !== "UNKNOWN" ? [`resolution:${record.resolution_id}`] : []),
      ...record.exact_source_paths.slice(0, 5),
      ...(record.observation ? [`observation:${record.observation.observed_at}`] : []),
      ...(record.fault_check ? [`fault_check:${record.fault_check.source}`] : []),
    ],
    next_action: record.next_action,
    created_at: new Date().toISOString(),
  };
}

function saveDelivery(row: DeliveryRecord): DeliveryRecord {
  saveEvidence({
    evidence_id: row.delivery_id,
    task_id: row.incident_id,
    kind: "owner_decision",
    source: SOURCE_MARKER,
    recorded_at: row.attempted_at,
    payload: row,
  });
  return row;
}

export function loadDeliveries(incidentId: string): readonly DeliveryRecord[] {
  return loadEvidenceForTask(incidentId)
    .filter((e) => e.source === SOURCE_MARKER)
    .map((e) => e.payload as DeliveryRecord)
    .sort((a, b) => a.attempted_at.localeCompare(b.attempted_at));
}

/**
 * ONE delivery attempt. Never retries internally — an unbounded retry
 * loop inside a delivery function is how a channel outage becomes a spin.
 * A `DELIVERY_FAILED` row is persisted and the incident stays OPEN.
 */
/** A real GET over the stdlib client. Returns the status code, or null if nothing answered. */
function probeChannel(baseUrl: string, timeoutMs: number): Promise<number | null> {
  return new Promise((resolvePromise) => {
    try {
      const parsed = new URL(baseUrl);
      const isHttps = parsed.protocol === "https:";
      const client = isHttps ? httpsGet : httpGet;
      const request = client(
        { hostname: parsed.hostname, port: parsed.port !== "" ? Number(parsed.port) : isHttps ? 443 : 80, path: "/", timeout: timeoutMs },
        (res) => { res.resume(); resolvePromise(res.statusCode ?? null); },
      );
      request.on("timeout", () => { request.destroy(); resolvePromise(null); });
      request.on("error", () => resolvePromise(null));
    } catch { resolvePromise(null); }
  });
}

export async function escalateToOwner(record: RemediationRecord): Promise<DeliveryRecord> {
  const payload = buildEscalationPayload(record);
  const deliveryId = `delivery-${record.incident_id}-${Date.now()}`;
  const attemptedAt = new Date().toISOString();

  // PENDING_DELIVERY is persisted FIRST, so a crash mid-delivery still
  // leaves visible evidence that an escalation was owed.
  saveDelivery({ delivery_id: `${deliveryId}-pending`, incident_id: record.incident_id, state: "PENDING_DELIVERY", consumer_route: "unresolved", transport: "none", attempted_at: attemptedAt, detail: "escalation queued", payload });

  // Routing decided by the EXISTING output boundary, not by this module.
  // LANE BUG, fixed: this used `lane: "OWNER"`, which does not exist —
  // `contracts/command/output-contract.ts` defines only SYSTEM_STATE and
  // WORK_ITEM. The invented lane matched nothing, so routing returned
  // NO_REGISTERED_CONSUMER while delivery still appeared to work. An Owner
  // escalation IS system state, and that lane has real consumers.
  const routing = resolveOutputConsumers({
    lane: "SYSTEM_STATE",
    task_id: record.incident_id,
    capability_id: "incident-remediation",
    status: "OWNER_DECISION_REQUIRED",
  } as never) as unknown as { status: string; consumers?: { consumer_id: string }[] };
  const route = routing.consumers?.map((c) => c.consumer_id).join(", ") ?? routing.status;

  // Probe the channel FIRST. reportViolation now returns a real result,
  // but an independent probe still distinguishes "the collector rejected
  // this payload" from "nothing is listening" — two failures that need
  // different fixes and must never be reported as one.
  const channelUrl = process.env.JOINT_MONITOR_URL ?? "http://127.0.0.1:5178";
  let reachable = false;
  let probeDetail = "";
  try {
    // `node:http`, not `fetch`: this repo runs on a Node 16 that has no
    // global fetch, and the previous fetch call threw ReferenceError on
    // every probe — which this function then reported as "channel
    // unreachable". A live collector was being called dead.
    const status = await probeChannel(channelUrl, 5_000);
    reachable = status !== null;
    probeDetail = status !== null ? `channel answered HTTP ${status}` : "channel unreachable: no response";
  } catch (error) {
    reachable = false;
    probeDetail = `channel unreachable: ${error instanceof Error ? error.message : String(error)}`;
  }

  if (!reachable) {
    return saveDelivery({
      delivery_id: deliveryId,
      incident_id: record.incident_id,
      state: "DELIVERY_FAILED",
      consumer_route: route,
      transport: "observability/joint-monitor#reportViolation",
      attempted_at: new Date().toISOString(),
      detail: `${probeDetail} — incident REMAINS OPEN, escalation still owed`,
      payload,
    });
  }

  try {
    // Delivery through the EXISTING owner-facing surface. `reportViolation`
    // now returns the real result (fixed 2026-08-26 in
    // observability/joint-monitor/client.ts) — so the outcome is READ, not
    // assumed. The probe above still runs because a swallowed transport
    // error would otherwise be indistinguishable from a dead channel.
    // PAYLOAD SHAPE, corrected 2026-08-26. This previously invented
    // `violation_type`/`correlation_id` and forced them past the type
    // checker with `as never`. The real contract is
    // `Omit<ViolationEvent, event_id|at|received_at|OccurrenceStamp>` —
    // launch_id / reason / detail / source / enforced. The cast hid the
    // mismatch, the server answered 400, and the old `void` return made
    // every escalation look DELIVERED. Never cast a payload past a
    // contract: the contract was right and the caller was wrong.
    const sent = await reportViolation({
      launch_id: record.incident_id,
      reason: `OWNER_DECISION_REQUIRED:${payload.category}`,
      detail: `${payload.what_failed} | ${payload.decision_required}`,
      source: SOURCE_MARKER,
      enforced: false,
    });
    if (!sent.ok) {
      return saveDelivery({ delivery_id: deliveryId, incident_id: record.incident_id, state: "DELIVERY_FAILED", consumer_route: route, transport: "observability/joint-monitor#reportViolation", attempted_at: new Date().toISOString(), detail: `transport reported ok=false (${probeDetail}) — incident REMAINS OPEN, escalation still owed`, payload });
    }
    return saveDelivery({ delivery_id: deliveryId, incident_id: record.incident_id, state: "DELIVERED", consumer_route: route, transport: "observability/joint-monitor#reportViolation", attempted_at: new Date().toISOString(), detail: `routing=${routing.status}; ${probeDetail}; transport ok=true`, payload });
  } catch (error) {
    return saveDelivery({
      delivery_id: deliveryId,
      incident_id: record.incident_id,
      state: "DELIVERY_FAILED",
      consumer_route: route,
      transport: "observability/joint-monitor#reportViolation",
      attempted_at: new Date().toISOString(),
      detail: `delivery failed: ${error instanceof Error ? error.message : String(error)} — incident REMAINS OPEN, escalation still owed`,
      payload,
    });
  }
}


/** Bounded. One escalation may never spin a channel outage into a loop. */
export const MAX_DELIVERY_ATTEMPTS = 3;

/**
 * §6 — bounded retry. Counts REAL persisted attempts, so the bound holds
 * across process restarts rather than living in memory. Returns the
 * existing DELIVERED row untouched if the escalation already landed.
 */
export async function retryEscalation(record: RemediationRecord): Promise<DeliveryRecord> {
  const history = loadDeliveries(record.incident_id);
  const delivered = history.find((d) => d.state === "DELIVERED" || d.state === "ACKNOWLEDGED");
  if (delivered) return delivered;

  const realAttempts = history.filter((d) => d.state === "DELIVERED" || d.state === "DELIVERY_FAILED").length;
  if (realAttempts >= MAX_DELIVERY_ATTEMPTS) {
    return saveDelivery({
      delivery_id: `delivery-${record.incident_id}-exhausted-${Date.now()}`,
      incident_id: record.incident_id,
      state: "DELIVERY_FAILED",
      consumer_route: "retry-bound-reached",
      transport: "none",
      attempted_at: new Date().toISOString(),
      detail: `retry bound reached (${realAttempts}/${MAX_DELIVERY_ATTEMPTS}) — NOT retrying again. The incident REMAINS OPEN and the escalation is still owed; a human or a scheduler must intervene.`,
      payload: buildEscalationPayload(record),
    });
  }
  return escalateToOwner(record);
}

/**
 * §6 — the Owner acknowledges. Recorded as its own append-only row, so
 * "delivered" and "seen by a human" stay distinguishable. Acknowledging
 * does NOT resolve the incident: only the original-fault re-check can.
 */
export function acknowledgeEscalation(incidentId: string, acknowledgedBy: string): DeliveryRecord | null {
  const history = loadDeliveries(incidentId);
  const delivered = [...history].reverse().find((d) => d.state === "DELIVERED");
  if (!delivered) return null;
  return saveDelivery({
    ...delivered,
    delivery_id: `delivery-${incidentId}-ack-${Date.now()}`,
    state: "ACKNOWLEDGED",
    attempted_at: new Date().toISOString(),
    detail: `acknowledged by ${acknowledgedBy}. Acknowledgement records that the Owner SAW it — the incident stays OPEN until the original fault clears.`,
  });
}
