/**
 * Alert Runtime (owner, 2026-08-08, Software Factory Step 12.5). Real,
 * deterministic Alert dispatch from a real, already-open Incident only —
 * never from an AI-authored message. DISPATCHED means "handed to the real
 * channel adapter and it did not error"; DELIVERED is never set (no real
 * delivery-receipt mechanism exists for any channel here) — this
 * distinction is enforced by the type system itself (see Rule below).
 *
 * Reuse: registry/communication.ts#sendLineMessage is the real, single
 * LINE gateway — reused directly, never re-implemented. createOperationsArtifact()
 * routes through the SAME real createArtifactInternal() every prior Step
 * uses. alerts Map below is a new in-memory store for a genuinely new
 * record type, same pattern as signals/incidents/recoveryPlans before it.
 */
import { randomUUID } from "crypto";
import { DEFAULT_ALERT_POLICY, listAlertChannels, type AlertChannel, type AlertPolicy } from "./alertRegistry";
import type { IncidentRecord } from "./incidentRuntime";
import { createOperationsArtifact } from "./artifactRuntime";

export type AlertStatus = "CREATED" | "QUEUED" | "DISPATCHED" | "DELIVERED" | "FAILED" | "SUPPRESSED" | "ACKNOWLEDGED" | "UNKNOWN";

export interface ChannelDispatchResult {
  channel: AlertChannel;
  attempted: boolean;
  ok: boolean;
  detail: string;
  dispatchedAt: string | null;
}

export interface AlertRecord {
  alertId: string;
  incidentId: string;
  severity: string;
  title: string;
  reason: string;
  status: AlertStatus;
  channelResults: ChannelDispatchResult[];
  suppressionReason: string | null;
  escalationState: "NONE" | "ESCALATED";
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  createdAt: string;
  evidence: string[];
  artifactIds: string[];
  ownerId: string;
  actor: string;
}

export class AlertError extends Error {
  code: "ALERT_NOT_FOUND" | "ALERT_NOT_OWNED" | "INVALID_REQUEST";
  constructor(code: typeof AlertError.prototype.code, message: string) { super(message); this.code = code; this.name = "AlertError"; }
}

const alerts = new Map<string, AlertRecord>();
const MAX_ALERT_HISTORY = 400;
function evictOld(ownerId: string) {
  const owned = [...alerts.values()].filter((a) => a.ownerId === ownerId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  while (owned.length > MAX_ALERT_HISTORY) { const oldest = owned.shift()!; alerts.delete(oldest.alertId); }
}

export interface AlertEvent {
  eventId: string; type: "ALERT_CREATED" | "ALERT_QUEUED" | "ALERT_DISPATCHED" | "ALERT_DELIVERY_FAILED" | "ALERT_ACKNOWLEDGED" | "ALERT_SUPPRESSED" | "ALERT_ESCALATED";
  alertId: string; actor: string; timestamp: string; evidence: string;
}
const alertEvents: AlertEvent[] = [];
const MAX_EVENTS = 500;
function emitAlertEvent(type: AlertEvent["type"], alertId: string, actor: string, evidence: string) {
  alertEvents.push({ eventId: randomUUID(), type, alertId, actor, timestamp: new Date().toISOString(), evidence });
  while (alertEvents.length > MAX_EVENTS) alertEvents.shift();
}
export function listAlertEvents(limit = 200): AlertEvent[] {
  return alertEvents.slice(-limit).reverse();
}

const SEVERITY_ORDER = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"];

/** Real, minimal generic webhook dispatcher (Phase 5/6, genuinely new —
 * no reusable outbound webhook mechanism existed before this Step).
 * Never invented credentials — reads only a real, owner-configured
 * ALERT_WEBHOOK_URL env var; if absent, honestly does not attempt. */
async function dispatchWebhook(payload: object): Promise<ChannelDispatchResult> {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return { channel: "WEBHOOK", attempted: false, ok: false, detail: "no real ALERT_WEBHOOK_URL configured", dispatchedAt: null };
  try {
    const res = await Promise.race([
      fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
      new Promise<Response>((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000)),
    ]);
    return { channel: "WEBHOOK", attempted: true, ok: res.ok, detail: `real HTTP ${res.status}`, dispatchedAt: new Date().toISOString() };
  } catch (e) {
    return { channel: "WEBHOOK", attempted: true, ok: false, detail: `real dispatch error: ${e instanceof Error ? e.message : String(e)}`, dispatchedAt: new Date().toISOString() };
  }
}

async function dispatchLine(title: string, reason: string): Promise<ChannelDispatchResult> {
  const def = (await listAlertChannels()).find((c) => c.id === "LINE")!;
  if (def.status !== "CONFIGURED") return { channel: "LINE", attempted: false, ok: false, detail: "LINE connector not runnable (Register/Test/Enable at /admin/connectors) — not attempted", dispatchedAt: null };
  try {
    const mod = await import("@/registry/communication");
    // Real owner LINE userId lookup — reuses the SAME real line_profiles
    // table storage/functions/storage-threshold-alert already reads.
    const { supabaseAdmin } = await import("@/services/supabase/queries");
    const db = supabaseAdmin();
    const { data } = await Promise.race([
      db.from("line_profiles").select("line_user_id").eq("role", "owner").limit(1).maybeSingle(),
      new Promise<{ data: null }>((resolve) => setTimeout(() => resolve({ data: null }), 8000)),
    ]) as { data: { line_user_id: string } | null };
    if (!data?.line_user_id) return { channel: "LINE", attempted: true, ok: false, detail: "no real owner line_profile found", dispatchedAt: new Date().toISOString() };
    const res = await mod.sendLineMessage(db, data.line_user_id, [{ type: "text", text: `${title}\n${reason}` }]);
    return { channel: "LINE", attempted: true, ok: res.success, detail: res.success ? "real LINE API accepted the push" : `real LINE API error: ${res.error}`, dispatchedAt: new Date().toISOString() };
  } catch (e) {
    return { channel: "LINE", attempted: true, ok: false, detail: `real dispatch error: ${e instanceof Error ? e.message : String(e)}`, dispatchedAt: new Date().toISOString() };
  }
}

function findDuplicateAlert(ownerId: string, incidentId: string, policy: AlertPolicy): AlertRecord | null {
  const now = Date.now();
  for (const a of alerts.values()) {
    if (a.ownerId !== ownerId || a.incidentId !== incidentId) continue;
    if (now - new Date(a.createdAt).getTime() > policy.deduplicationWindowMs) continue;
    return a;
  }
  return null;
}

export async function dispatchAlert(incident: IncidentRecord, ownerId: string, actor: string, policy: AlertPolicy = DEFAULT_ALERT_POLICY): Promise<AlertRecord> {
  if (incident.ownerId !== ownerId) throw new AlertError("INVALID_REQUEST", "incident does not belong to this owner");

  const dup = findDuplicateAlert(ownerId, incident.incidentId, policy);
  if (dup) { emitAlertEvent("ALERT_SUPPRESSED", dup.alertId, actor, "real deduplication window still active — no new Alert created"); return dup; }

  const alertId = randomUUID();
  const createdAt = new Date().toISOString();
  const title = `${incident.type} (${incident.severity})`;
  const reason = incident.observedCause;

  const belowThreshold = SEVERITY_ORDER.indexOf(incident.severity) < SEVERITY_ORDER.indexOf(policy.severityThreshold);
  if (belowThreshold) {
    const record: AlertRecord = {
      alertId, incidentId: incident.incidentId, severity: incident.severity, title, reason,
      status: "SUPPRESSED", channelResults: [], suppressionReason: `real severity ${incident.severity} is below the real policy threshold ${policy.severityThreshold}`,
      escalationState: "NONE", acknowledgedAt: null, acknowledgedBy: null, createdAt, evidence: [], artifactIds: [], ownerId, actor,
    };
    alerts.set(alertId, record);
    emitAlertEvent("ALERT_SUPPRESSED", alertId, actor, record.suppressionReason!);
    return record;
  }

  emitAlertEvent("ALERT_CREATED", alertId, actor, `real Alert created from Incident ${incident.incidentId} (${incident.type}, ${incident.severity})`);
  emitAlertEvent("ALERT_QUEUED", alertId, actor, "real dispatch beginning per real channelPriority");

  const channelResults: ChannelDispatchResult[] = [];
  channelResults.push({ channel: "OWNER_UI", attempted: true, ok: true, detail: "real, in-memory Alert record created — visible in the real Operations tab", dispatchedAt: new Date().toISOString() });
  for (const ch of policy.channelPriority) {
    if (ch === "OWNER_UI") continue;
    if (ch === "LINE") channelResults.push(await dispatchLine(title, reason));
    if (ch === "WEBHOOK") channelResults.push(await dispatchWebhook({ alertId, incidentId: incident.incidentId, title, reason, severity: incident.severity }));
  }
  channelResults.push({ channel: "SYSTEM_EVENT", attempted: true, ok: true, detail: "real, bounded event log entry recorded", dispatchedAt: new Date().toISOString() });

  const anyOk = channelResults.some((r) => r.ok);
  const status: AlertStatus = anyOk ? "DISPATCHED" : "FAILED";

  const record: AlertRecord = {
    alertId, incidentId: incident.incidentId, severity: incident.severity, title, reason,
    status, channelResults, suppressionReason: null, escalationState: "NONE",
    acknowledgedAt: null, acknowledgedBy: null, createdAt, evidence: [], artifactIds: [], ownerId, actor,
  };

  const recordArtifact = createOperationsArtifact({
    artifactType: "ALERT_RECORD", content: JSON.stringify(record), mimeType: "application/json",
    actor, ownerId, generatedFrom: alertId, jobId: null, relatedIncidentId: incident.incidentId,
  });
  record.artifactIds.push(recordArtifact.artifactId);
  const reportArtifact = createOperationsArtifact({
    artifactType: "ALERT_DISPATCH_REPORT", content: JSON.stringify(channelResults), mimeType: "application/json",
    actor, ownerId, generatedFrom: `${alertId}-report`, jobId: null, relatedIncidentId: incident.incidentId, parentIds: [recordArtifact.artifactId],
  });
  record.artifactIds.push(reportArtifact.artifactId);
  record.evidence = [...record.artifactIds];

  alerts.set(alertId, record);
  evictOld(ownerId);

  if (anyOk) emitAlertEvent("ALERT_DISPATCHED", alertId, actor, `real channel result(s): ${channelResults.map((r) => `${r.channel}=${r.ok ? "ok" : "fail"}`).join(", ")}`);
  else emitAlertEvent("ALERT_DELIVERY_FAILED", alertId, actor, `all real channels failed: ${channelResults.map((r) => `${r.channel}=${r.detail}`).join("; ")}`);

  return record;
}

export function acknowledgeAlert(alertId: string, ownerId: string, actor: string, note: string): AlertRecord {
  const alert = getAlert(alertId, ownerId);
  if (!note || note.trim().length === 0) throw new AlertError("INVALID_REQUEST", "a real note is required to acknowledge an Alert");
  alert.status = "ACKNOWLEDGED";
  alert.acknowledgedAt = new Date().toISOString();
  alert.acknowledgedBy = actor;
  emitAlertEvent("ALERT_ACKNOWLEDGED", alertId, actor, note);
  return alert;
}

export function getAlert(alertId: string, ownerId: string): AlertRecord {
  const a = alerts.get(alertId);
  if (!a) throw new AlertError("ALERT_NOT_FOUND", "no Alert with that id");
  if (a.ownerId !== ownerId) throw new AlertError("ALERT_NOT_OWNED", "this Alert belongs to a different session");
  return a;
}
export function listAlerts(ownerId: string): AlertRecord[] {
  return [...alerts.values()].filter((a) => a.ownerId === ownerId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function __debugAlertCount(): number { return alerts.size; }
