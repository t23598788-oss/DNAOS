import { randomUUID } from "node:crypto";
import { getStore } from "../canonical-information/store";
import { ensureSafeCanonicalIngest } from "../canonical-information/ingest-safe";
import { evaluateCanonicalEvent, listNotifications, makeCanonicalEvent } from "../owner-notification/contract";
import { discoverInboundAdapters, getInboundAdapter } from "./adapters";
import { extendedOwnerWorkNotificationSummary } from "../production-checkpoint/contract";
import {
  listCodingActivities,
  listOutputs,
  listSubmittedWork,
  persistAdapter,
  persistCodingActivity,
  persistOutput,
  persistSubmittedWork,
  rememberIdentity,
} from "./persist";
import type {
  CodingClientActivityV1,
  NormalizedInboundEventV1,
  OwnerSubmittedWorkV1,
  StalenessState,
  WorkOutputRecordV1,
} from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

function identityOf(input: NormalizedInboundEventV1): string {
  const rev = String(input.facts.revision ?? input.current_state ?? "");
  return `${input.provider_id}|${input.external_event_id}|${input.work_id ?? ""}|${input.event_type}|${rev}`;
}

function registerCanonicalWork(work: OwnerSubmittedWorkV1): void {
  ensureSafeCanonicalIngest();
  const store = getStore();
  const id = `entity:work:${work.work_id}`;
  if (!store.entities.some((row) => row.entity_id === id)) {
    store.entities.push({
      schema: "CANONICAL_INFORMATION_ENTITY_V1",
      entity_id: id,
      entity_type: "WORK",
      canonical_name: work.work_id,
      display_name: work.subject,
      domain: "DEVELOPMENT",
      status: "RUNNING",
      verification: "VERIFIED",
      availability: "AVAILABLE",
      authority_state: "OWNER_DISABLED",
      owner_enabled: false,
      source_system: "inbound-event-fabric",
      source_ref: work.submission_id,
      relationships: [],
      evidence_refs: [`submission:${work.submission_id}`],
      created_at: work.submitted_at,
      updated_at: nowIso(),
      version: 1,
    });
  }
}

export function submitOwnerWork(input: {
  readonly subject: string;
  readonly assigned_client: string;
  readonly submitted_from_surface?: string;
  readonly work_id?: string;
  readonly goal?: string;
  readonly repository_id?: string;
}): OwnerSubmittedWorkV1 {
  discoverInboundAdapters();
  const work_id = input.work_id ?? `work-inb-${randomUUID()}`;
  const existing = listSubmittedWork().find((row) => row.work_id === work_id);
  if (existing) return existing;
  const t = nowIso();
  const row: OwnerSubmittedWorkV1 = {
    schema: "OWNER_SUBMITTED_WORK_V1",
    submission_id: `sub-${randomUUID()}`,
    work_id,
    work_order_id: `wo-${work_id}`,
    subject: input.subject,
    submitted_from_surface: input.submitted_from_surface ?? "DEVELOPMENT_CONTROL_SURFACE",
    assigned_client: input.assigned_client,
    submitted_at: t,
    accepted_at: null,
    current_stage: "WORK_ACCEPTED",
    latest_activity: "submitted",
    reports_created: 0,
    results_created: 0,
    artifacts_created: 0,
    reviews_ready: 0,
    failures: 0,
    attention_required: false,
    final_result_ref: null,
    client_connected: true,
    WORK_COMPLETED: false,
    machine_verified_status: null,
    reported_status: "SUBMITTED",
    last_activity_at: t,
    expected_activity_window_ms: 30 * 60 * 1000,
  };
  persistSubmittedWork(row);
  persistCodingActivity({
    schema: "CODING_CLIENT_ACTIVITY_ADAPTER_V1",
    client_id: input.assigned_client,
    work_id,
    work_order_id: row.work_order_id,
    subject: input.subject,
    goal: input.goal ?? input.subject,
    repository_id: input.repository_id ?? "repo://canonical",
    workspace_id: `ws:${work_id}`,
    current_stage: "WORK_ACCEPTED",
    current_action: "accepted",
    started_at: t,
    last_activity_at: t,
    reported_status: "SUBMITTED",
    machine_verified_status: null,
    result_refs: [],
    report_count: 0,
  });
  registerCanonicalWork(row);
  ingestInboundEvent({
    adapter_id: "adapter://inbound/coding-client/cursor",
    provider_id: input.assigned_client,
    external_event_id: `accept:${work_id}`,
    event_type: "WORK_ACCEPTED",
    work_id,
    entity_id: `entity:work:${work_id}`,
    source_system: input.assigned_client,
    current_state: "WORK_ACCEPTED",
    previous_state: null,
    facts: { client: input.assigned_client, subject: input.subject },
    evidence_refs: [`submission:${row.submission_id}`],
  });
  return listSubmittedWork().find((item) => item.work_id === work_id) ?? row;
}

function patchWork(work_id: string, patch: Partial<OwnerSubmittedWorkV1>): OwnerSubmittedWorkV1 | null {
  const current = listSubmittedWork().find((row) => row.work_id === work_id);
  if (!current) return null;
  const next = { ...current, ...patch, last_activity_at: nowIso() };
  persistSubmittedWork(next);
  return next;
}

export function ingestInboundEvent(input: NormalizedInboundEventV1): {
  readonly duplicate: boolean;
  readonly INBOUND_EVENT_GRANTS_AUTHORITY: false;
  readonly notification_id: string | null;
  readonly work: OwnerSubmittedWorkV1 | null;
} {
  discoverInboundAdapters();
  const adapter = getInboundAdapter(input.adapter_id);
  if (!adapter) {
    return { duplicate: false, INBOUND_EVENT_GRANTS_AUTHORITY: false, notification_id: null, work: null };
  }
  if ((adapter.health === "NOT_AVAILABLE" || adapter.health === "NOT_WIRED") && adapter.provider_type !== "SYSTEM_INTERNAL" && adapter.provider_type !== "CODING_CLIENT" && adapter.provider_type !== "FILE_SOURCE" && adapter.provider_type !== "MACOS" && adapter.provider_type !== "GITHUB") {
    return { duplicate: false, INBOUND_EVENT_GRANTS_AUTHORITY: false, notification_id: null, work: listSubmittedWork().find((row) => row.work_id === input.work_id) ?? null };
  }
  const key = identityOf(input);
  if (rememberIdentity(key)) {
    return { duplicate: true, INBOUND_EVENT_GRANTS_AUTHORITY: false, notification_id: null, work: listSubmittedWork().find((row) => row.work_id === input.work_id) ?? null };
  }
  persistAdapter({ ...adapter, last_event_at: nowIso() });
  const forbidden = input.event_type === "PRODUCTION_SUCCESS" || input.event_type === "RUNTIME_VERIFIED" || input.event_type === "CAPABILITY_AVAILABLE";
  const eventType = forbidden && adapter.provider_type === "CODING_CLIENT" ? "COMPLETED_CANDIDATE" : input.event_type;
  const event = makeCanonicalEvent({
    event_id: `event:inb:${input.external_event_id}`,
    event_type: eventType,
    entity_id: input.entity_id,
    work_id: input.work_id,
    command_id: null,
    source_system: input.source_system,
    previous_state: input.previous_state,
    current_state: input.current_state ?? eventType,
    severity: input.severity ?? (eventType.includes("FAILED") ? "WARN" : "INFO"),
    owner_attention: input.owner_attention ?? eventType === "REVIEW_READY",
    action_required: input.action_required ?? (eventType === "OWNER_APPROVAL_REQUIRED" || eventType === "REVIEW_READY"),
    evidence_refs: input.evidence_refs,
  });
  const evaluated = evaluateCanonicalEvent(event, input.facts);
  let work = input.work_id ? listSubmittedWork().find((row) => row.work_id === input.work_id) ?? null : null;
  if (work) {
    const stage = eventType;
    const patched = patchWork(work.work_id, {
      accepted_at: work.accepted_at ?? nowIso(),
      current_stage: stage,
      latest_activity: stage,
      reported_status: adapter.provider_type === "CODING_CLIENT" ? stage : work.reported_status,
      machine_verified_status: adapter.provider_type === "SYSTEM_INTERNAL" || eventType === "RUNTIME_VERIFIED" || eventType === "WORK_COMPLETED" ? stage : work.machine_verified_status,
      WORK_COMPLETED: eventType === "WORK_COMPLETED" && input.source_system === "DNA_OS",
      attention_required: eventType === "REVIEW_READY" || eventType === "OWNER_APPROVAL_REQUIRED" || eventType === "TEST_FAILED",
      failures: work.failures + (eventType.includes("FAILED") ? 1 : 0),
      reviews_ready: work.reviews_ready + (eventType === "REVIEW_READY" ? 1 : 0),
      client_connected: eventType === "CLIENT_DISCONNECTED" ? false : true,
    });
    work = patched;
    if (patched) {
      const activity = listCodingActivities().find((row) => row.work_id === patched.work_id);
      if (activity) {
        persistCodingActivity({
          ...activity,
          current_stage: patched.current_stage,
          current_action: stage,
          last_activity_at: nowIso(),
          reported_status: patched.reported_status ?? stage,
          machine_verified_status: patched.machine_verified_status,
          report_count: patched.reports_created,
        });
      }
    }
  }
  return {
    duplicate: false,
    INBOUND_EVENT_GRANTS_AUTHORITY: false,
    notification_id: evaluated.notification?.notification_id ?? null,
    work,
  };
}

export function recordWorkOutput(input: {
  readonly work_id: string;
  readonly kind: WorkOutputRecordV1["kind"];
}): WorkOutputRecordV1 {
  const id = `${input.kind}-${randomUUID()}`;
  const row: WorkOutputRecordV1 = {
    schema: "WORK_OUTPUT_ACCOUNTING_V1",
    output_id: id,
    work_id: input.work_id,
    kind: input.kind,
    report_id: input.kind === "report" ? id : null,
    result_id: input.kind === "result" ? id : null,
    artifact_id: input.kind === "artifact" ? id : null,
    evidence_bundle_id: input.kind === "evidence_bundle" ? id : null,
    review_id: input.kind === "review" ? id : null,
    deployment_id: input.kind === "deployment" ? id : null,
    runtime_result_id: input.kind === "runtime_result" ? id : null,
    created_at: nowIso(),
  };
  persistOutput(row);
  const work = listSubmittedWork().find((item) => item.work_id === input.work_id);
  if (work) {
    persistSubmittedWork({
      ...work,
      reports_created: work.reports_created + (input.kind === "report" ? 1 : 0),
      results_created: work.results_created + (input.kind === "result" ? 1 : 0),
      artifacts_created: work.artifacts_created + (input.kind === "artifact" ? 1 : 0),
      last_activity_at: nowIso(),
    });
  }
  if (input.kind === "report") {
    ingestInboundEvent({
      adapter_id: "adapter://inbound/system-internal",
      provider_id: "dna-os",
      external_event_id: `report:${id}`,
      event_type: "REPORT_CREATED",
      work_id: input.work_id,
      entity_id: `entity:work:${input.work_id}`,
      source_system: "DNA_OS",
      current_state: "REPORT_CREATED",
      previous_state: null,
      facts: { reports_created: (work?.reports_created ?? 0) + 1 },
      evidence_refs: [id],
    });
  }
  return row;
}

export function codingActivityFor(work_id: string): CodingClientActivityV1 | null {
  return listCodingActivities().find((row) => row.work_id === work_id) ?? null;
}

export function workStaleness(work_id: string, now = Date.now()): StalenessState {
  const work = listSubmittedWork().find((row) => row.work_id === work_id);
  if (!work) return "COMPLETED";
  if (work.WORK_COMPLETED) return "COMPLETED";
  if (work.current_stage === "BLOCKED") return "BLOCKED";
  if (work.current_stage === "WAITING") return "WAITING";
  const age = now - Date.parse(work.last_activity_at);
  if (age > work.expected_activity_window_ms) return "STALE";
  if (age > work.expected_activity_window_ms / 2) return "IDLE_EXPECTED";
  return "ACTIVE";
}

export function disconnectCodingClient(work_id: string): OwnerSubmittedWorkV1 | null {
  const work = listSubmittedWork().find((row) => row.work_id === work_id);
  if (!work) return null;
  ingestInboundEvent({
    adapter_id: "adapter://inbound/coding-client/cursor",
    provider_id: work.assigned_client,
    external_event_id: `disconnect:${work_id}:${work.last_activity_at}`,
    event_type: "CLIENT_DISCONNECTED",
    work_id,
    entity_id: `entity:work:${work_id}`,
    source_system: work.assigned_client,
    current_state: work.current_stage,
    previous_state: work.current_stage,
    facts: { subject: work.subject },
    evidence_refs: [`submission:${work.submission_id}`],
  });
  return listSubmittedWork().find((row) => row.work_id === work_id) ?? null;
}

export function reconnectCodingClient(work_id: string): OwnerSubmittedWorkV1 | null {
  const work = listSubmittedWork().find((row) => row.work_id === work_id);
  if (!work) return null;
  persistSubmittedWork({ ...work, client_connected: true, last_activity_at: nowIso(), latest_activity: "reconnected" });
  return listSubmittedWork().find((row) => row.work_id === work_id) ?? null;
}

export function ownerWorkVisibility(): Record<string, unknown> {
  const rows = listSubmittedWork();
  const today = new Date().toISOString().slice(0, 10);
  return {
    schema: "OWNER_CONTINUOUS_WORK_VISIBILITY_V1",
    running: rows.filter((row) => !row.WORK_COMPLETED && row.client_connected),
    completed_today: rows.filter((row) => row.WORK_COMPLETED && row.last_activity_at.startsWith(today)),
    failed: rows.filter((row) => row.failures > 0),
    waiting_for_owner: rows.filter((row) => row.attention_required),
    reports: listOutputs().filter((row) => row.kind === "report"),
    coding_clients: listCodingActivities(),
    stale: rows.filter((row) => workStaleness(row.work_id) === "STALE"),
    runtime_verified: rows.filter((row) => row.machine_verified_status === "RUNTIME_VERIFIED"),
    OWNER_CAN_LEAVE_CODING_CLIENT_AND_TRACK_WORK: true,
    INBOUND_EVENT_SOURCE_SEARCH_REQUIRED: false,
    INBOUND_EVENT_GRANTS_AUTHORITY: false,
  };
}

export function workOutputSummary(work_id?: string): Record<string, number> {
  const rows = work_id ? listOutputs().filter((row) => row.work_id === work_id) : listOutputs();
  const workRows = work_id ? listSubmittedWork().filter((row) => row.work_id === work_id) : listSubmittedWork();
  return {
    REPORTS_CREATED: rows.filter((row) => row.kind === "report").length,
    RESULTS_CREATED: rows.filter((row) => row.kind === "result").length,
    ARTIFACTS_CREATED: rows.filter((row) => row.kind === "artifact").length,
    REVIEWS_READY: workRows.reduce((sum, row) => sum + row.reviews_ready, 0),
    FAILURES: workRows.reduce((sum, row) => sum + row.failures, 0),
    OWNER_ACTIONS_REQUIRED: workRows.filter((row) => row.attention_required).length,
  };
}

export function ownerWorkNotificationSummary(): Record<string, unknown> {
  const rows = listSubmittedWork();
  const notes = listNotifications();
  const latestSuccess = [...notes].reverse().find((row) => row.notification_type === "RUNTIME_VERIFIED" || row.notification_type === "WORK_COMPLETED");
  const latestFailure = [...notes].reverse().find((row) => /FAILED/.test(row.notification_type));
  return {
    schema: "OWNER_WORK_NOTIFICATION_SUMMARY_V1",
    running_work_count: rows.filter((row) => !row.WORK_COMPLETED).length,
    completed_work_count: rows.filter((row) => row.WORK_COMPLETED).length,
    failed_work_count: rows.filter((row) => row.failures > 0).length,
    reports_created_count: listOutputs().filter((row) => row.kind === "report").length,
    attention_required_count: rows.filter((row) => row.attention_required).length,
    latest_success: latestSuccess?.notification_id ?? null,
    latest_failure: latestFailure?.notification_id ?? null,
    active_clients: [...new Set(listCodingActivities().map((row) => row.client_id))],
    ...extendedOwnerWorkNotificationSummary(),
  };
}

export function inboundWorkSurfaceSlice(): Record<string, unknown> {
  return {
    schema: "INBOUND_EVENT_ADAPTER_FABRIC_V1",
    visibility: ownerWorkVisibility(),
    summary: ownerWorkNotificationSummary(),
    grants_authority: false,
  };
}

export function fileArrival(input: {
  readonly meaningful: boolean;
  readonly work_id: string;
  readonly resource_ref: string;
}): { notified: boolean } {
  if (!input.meaningful) {
    ingestInboundEvent({
      adapter_id: "adapter://inbound/files",
      provider_id: "local-files",
      external_event_id: `internal-write:${input.resource_ref}`,
      event_type: "FILE_WRITE",
      work_id: input.work_id,
      entity_id: `entity:work:${input.work_id}`,
      source_system: "local-resource-access",
      current_state: "FILE_WRITE",
      previous_state: null,
      facts: {},
      evidence_refs: [input.resource_ref],
    });
    return { notified: false };
  }
  const result = ingestInboundEvent({
    adapter_id: "adapter://inbound/files",
    provider_id: "local-files",
    external_event_id: `file-received:${input.resource_ref}`,
    event_type: "FILE_RECEIVED",
    work_id: input.work_id,
    entity_id: `entity:work:${input.work_id}`,
    source_system: "local-resource-access",
    current_state: "FILE_RECEIVED",
    previous_state: null,
    facts: { resource: input.resource_ref },
    evidence_refs: [input.resource_ref],
    owner_attention: true,
  });
  return { notified: result.notification_id !== null };
}
