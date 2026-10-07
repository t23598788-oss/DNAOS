import { randomUUID } from "node:crypto";
import type { CanonicalEventV1 } from "../canonical-information/types";
import { getActiveActivities } from "../canonical-information/query";
import { getStore } from "../canonical-information/store";
import { ensureSafeCanonicalIngest } from "../canonical-information/ingest-safe";
import { projectHumanNotification } from "./human";
import { deduplicationKey, evaluateNotificationPolicy, isCodingSelfReport } from "./policy";
import {
  bumpMetric,
  listActivities,
  listNotifications,
  loadEnablement,
  persistActivity,
  persistDelivery,
  persistEnablement,
  persistNotification,
} from "./store";
import { nativeNotificationPort } from "./native";
import type {
  NativePermissionState,
  NotificationDeliveryEvidenceV1,
  NotificationSeverity,
  OwnerActiveWorkProjectionV1,
  OwnerAttentionIndexV1,
  OwnerNotificationEnablementV1,
  OwnerNotificationV1,
} from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

function actionsFor(type: string): readonly string[] {
  if (type === "OWNER_APPROVAL_REQUIRED" || type === "REVIEW_READY") return ["OPEN_REVIEW", "OPEN_WORK"];
  if (type === "DEVELOPMENT_PROPOSAL_READY") return ["OPEN_DEVELOPMENT_CONTROL"];
  if (type === "SECURITY_SENSITIVE_REAUTH") return ["OPEN_DEVELOPMENT_CONTROL"];
  return [];
}

function severityFor(decision: string, event: CanonicalEventV1): NotificationSeverity {
  if (decision === "NOTIFY_CRITICAL") return "CRITICAL";
  if (event.event_type.includes("FAILED") || event.severity === "WARN" || decision === "NOTIFY_ACTION_REQUIRED") return "WARNING";
  return "INFO";
}

export function upsertActiveWork(input: {
  readonly activity_id: string;
  readonly actor: string;
  readonly actor_type: string;
  readonly work_id: string;
  readonly subject: string;
  readonly goal: string;
  readonly stage: string;
  readonly status: string;
  readonly evidence_refs?: readonly string[];
}): OwnerActiveWorkProjectionV1 {
  const existing = listActivities().find((row) => row.activity_id === input.activity_id);
  const row: OwnerActiveWorkProjectionV1 = {
    schema: "OWNER_ACTIVE_WORK_PROJECTION_V1",
    activity_id: input.activity_id,
    actor: input.actor,
    actor_type: input.actor_type,
    work_id: input.work_id,
    subject: input.subject,
    goal: input.goal,
    stage: input.stage,
    status: input.status,
    started_at: existing?.started_at ?? nowIso(),
    last_activity_at: nowIso(),
    progress_summary: `${input.stage} ${input.status}`.trim(),
    evidence_refs: input.evidence_refs ?? existing?.evidence_refs ?? [],
  };
  persistActivity(row);
  return row;
}

export function listActiveWork(): readonly OwnerActiveWorkProjectionV1[] {
  ensureSafeCanonicalIngest();
  const local = listActivities().filter((row) => row.status !== "COMPLETED");
  const canonical = getActiveActivities().map((row) => ({
    schema: "OWNER_ACTIVE_WORK_PROJECTION_V1" as const,
    activity_id: row.activity_id,
    actor: row.actor_id,
    actor_type: row.actor_type,
    work_id: row.work_id,
    subject: row.subject,
    goal: row.goal,
    stage: row.current_stage,
    status: String(row.status),
    started_at: row.started_at,
    last_activity_at: row.last_activity_at,
    progress_summary: `${row.current_stage} ${row.status}`,
    evidence_refs: row.evidence_refs,
  }));
  const byId = new Map<string, OwnerActiveWorkProjectionV1>();
  for (const row of [...canonical, ...local]) byId.set(row.activity_id, row);
  return [...byId.values()];
}

export function attentionIndex(): OwnerAttentionIndexV1 {
  const rows = listNotifications().filter((row) => row.dismissed_at === null);
  return {
    schema: "OWNER_ATTENTION_INDEX_V1",
    unread_count: rows.filter((row) => row.read_at === null).length,
    attention_required_count: rows.filter((row) => row.action_required).length,
    warning_count: rows.filter((row) => row.severity === "WARNING").length,
    critical_count: rows.filter((row) => row.severity === "CRITICAL").length,
  };
}

export function queryNotifications(filter: "latest" | "unread" | "action_required" | "failed" | "success" = "latest"): readonly OwnerNotificationV1[] {
  const rows = listNotifications();
  if (filter === "unread") return rows.filter((row) => row.read_at === null && row.dismissed_at === null);
  if (filter === "action_required") return rows.filter((row) => row.action_required && row.dismissed_at === null);
  if (filter === "failed") return rows.filter((row) => /FAILED|ERROR/.test(row.notification_type));
  if (filter === "success") return rows.filter((row) => row.notification_type === "RUNTIME_VERIFIED" || row.notification_type === "CAPABILITY_AVAILABLE" || row.notification_type === "WORK_COMPLETED");
  return rows.slice(-20);
}

function registerCanonicalPointer(notification: OwnerNotificationV1): void {
  const store = getStore();
  if (store.evidence.some((row) => row.evidence_id === `ev:notify:${notification.notification_id}`)) return;
  store.evidence.push({
    schema: "CANONICAL_EVIDENCE_INDEX_V1",
    evidence_id: `ev:notify:${notification.notification_id}`,
    evidence_type: "OWNER_NOTIFICATION",
    source_system: "owner-notification",
    entity_refs: [notification.entity_id],
    work_id: notification.work_id,
    command_id: notification.command_id,
    resource_ref: notification.notification_id,
    hash: notification.deduplication_key,
    timestamp: notification.created_at,
    availability: "AVAILABLE",
    storage_ref: `notification:${notification.notification_id}`,
  });
}

export function readMacosNotificationPermission(): { state: NativePermissionState; helper_present: boolean; NEW_NOTIFICATION_PERMISSION_AUTO_REQUESTED: false } {
  const row = nativeNotificationPort().readPermission();
  return { state: row.state, helper_present: row.helper_present, NEW_NOTIFICATION_PERMISSION_AUTO_REQUESTED: false };
}

export function describeNativeNotificationEnablement(): Record<string, unknown> {
  return {
    schema: "OWNER_NOTIFICATION_ENABLEMENT_V1",
    action: "ENABLE_NATIVE_NOTIFICATIONS",
    purpose: "แจ้งเหตุการณ์ที่ตรวจแล้วผ่าน macOS Notification Center แม้ Owner จะไม่ได้เปิด Cursor หรือ DNA OS surface",
    uses: "UNUserNotificationCenter",
    NEW_NOTIFICATION_PERMISSION_AUTO_REQUESTED: false,
    requested: false,
  };
}

export function enableNativeNotifications(): OwnerNotificationEnablementV1 {
  const requested = nativeNotificationPort().requestAuthorization();
  const row: OwnerNotificationEnablementV1 = {
    schema: "OWNER_NOTIFICATION_ENABLEMENT_V1",
    native_enabled: requested.state === "AUTHORIZED" || requested.state === "PROVISIONAL",
    owner_surface_enabled: true,
    updated_at: nowIso(),
    NEW_NOTIFICATION_PERMISSION_AUTO_REQUESTED: false,
  };
  persistEnablement(row);
  return row;
}

function deliver(notification: OwnerNotificationV1): OwnerNotificationV1 {
  const human = projectHumanNotification(notification);
  const surface: NotificationDeliveryEvidenceV1 = {
    schema: "NOTIFICATION_DELIVERY_EVIDENCE_V1",
    notification_id: notification.notification_id,
    delivery_channel: "OWNER_SURFACE",
    permission_state: "N_A",
    delivery_requested_at: nowIso(),
    delivery_request_result: "DELIVERED_SURFACE",
    error_code: null,
    USER_VIEWED_UNKNOWN: true,
  };
  persistDelivery(surface);
  bumpMetric("OWNER_SURFACE_DELIVERIES");
  const enablement = loadEnablement();
  const permission = readMacosNotificationPermission();
  if (!enablement.native_enabled || (permission.state !== "AUTHORIZED" && permission.state !== "PROVISIONAL")) {
    persistDelivery({
      schema: "NOTIFICATION_DELIVERY_EVIDENCE_V1",
      notification_id: notification.notification_id,
      delivery_channel: "MACOS_NATIVE",
      permission_state: permission.state,
      delivery_requested_at: nowIso(),
      delivery_request_result: "SKIPPED",
      error_code: permission.state,
      USER_VIEWED_UNKNOWN: true,
    });
    return { ...notification, delivery_state: "DELIVERED_SURFACE", delivery_channels: ["OWNER_SURFACE"] };
  }
  bumpMetric("MACOS_DELIVERY_REQUESTS");
  const scheduled = nativeNotificationPort().schedule({
    identifier: notification.notification_id,
    title: human.title,
    body: human.message,
    category: notification.notification_type,
    thread: notification.work_id ?? notification.entity_id,
    userInfo: {
      notification_id: notification.notification_id,
      work_id: notification.work_id ?? "",
      entity_id: notification.entity_id,
    },
  });
  persistDelivery({
    schema: "NOTIFICATION_DELIVERY_EVIDENCE_V1",
    notification_id: notification.notification_id,
    delivery_channel: "MACOS_NATIVE",
    permission_state: permission.state,
    delivery_requested_at: nowIso(),
    delivery_request_result: scheduled.result,
    error_code: scheduled.error_code,
    USER_VIEWED_UNKNOWN: true,
  });
  if (scheduled.result === "DELIVERY_ACCEPTED_BY_OS") bumpMetric("MACOS_DELIVERY_ACCEPTED");
  else bumpMetric("MACOS_DELIVERY_FAILED");
  return {
    ...notification,
    delivery_state: scheduled.result === "DELIVERY_ACCEPTED_BY_OS" ? "DELIVERY_ACCEPTED_BY_OS" : "DELIVERED_SURFACE",
    delivery_channels: scheduled.result === "DELIVERY_ACCEPTED_BY_OS" ? ["OWNER_SURFACE", "MACOS_NATIVE"] : ["OWNER_SURFACE"],
  };
}

export function evaluateCanonicalEvent(
  event: CanonicalEventV1,
  facts: Readonly<Record<string, string | number | boolean | null>> = {},
): { decision: string; notification: OwnerNotificationV1 | null; activity: OwnerActiveWorkProjectionV1 | null } {
  bumpMetric("EVENTS_EVALUATED");
  const decision = evaluateNotificationPolicy(event);
  if (decision === "IGNORE") {
    bumpMetric("EVENTS_IGNORED");
    return { decision, notification: null, activity: null };
  }
  if (event.event_type === "CODING_STARTED" || event.event_type === "CODING_PROGRESS" || decision === "ACTIVITY_ONLY") {
    const activity = upsertActiveWork({
      activity_id: `activity:${event.work_id ?? event.entity_id}`,
      actor: event.source_system,
      actor_type: isCodingSelfReport(event) ? "CODING_CLIENT" : "DNA_OS",
      work_id: event.work_id ?? event.entity_id,
      subject: String(facts.subject ?? event.event_type),
      goal: String(facts.goal ?? event.current_state ?? event.event_type),
      stage: String(facts.stage ?? event.current_state ?? event.event_type),
      status: event.event_type === "CODING_PROGRESS" ? "IN_PROGRESS" : String(event.current_state ?? "RUNNING"),
      evidence_refs: event.evidence_refs,
    });
    if (decision === "ACTIVITY_ONLY") {
      bumpMetric("ACTIVITY_ONLY_EVENTS");
      return { decision, notification: null, activity };
    }
  }
  const extra = String(facts.revision ?? facts.owner_enabled ?? "");
  const key = deduplicationKey(event, extra);
  const existing = listNotifications().find((row) => row.deduplication_key === key);
  if (existing) {
    bumpMetric("NOTIFICATIONS_DEDUPLICATED");
    return { decision, notification: existing, activity: null };
  }
  const created: OwnerNotificationV1 = {
    schema: "OWNER_NOTIFICATION_V1",
    notification_id: `note-${randomUUID()}`,
    event_id: event.event_id,
    entity_id: event.entity_id,
    work_id: event.work_id,
    command_id: event.command_id,
    source_system: event.source_system,
    notification_type: event.event_type,
    severity: severityFor(decision, event),
    title_key: `notify.${event.event_type}.title`,
    message_key: `notify.${event.event_type}.message`,
    structured_facts: facts,
    state_before: event.previous_state,
    state_after: event.current_state,
    action_required: decision === "NOTIFY_ACTION_REQUIRED",
    owner_action_refs: actionsFor(event.event_type),
    resource_refs: event.evidence_refs,
    capability_refs: event.entity_id.startsWith("entity:capability:") ? [event.entity_id] : [],
    evidence_refs: event.evidence_refs,
    created_at: nowIso(),
    read_at: null,
    dismissed_at: null,
    delivery_state: "PENDING",
    delivery_channels: ["OWNER_SURFACE"],
    deduplication_key: key,
    version: 1,
  };
  const delivered = deliver(created);
  persistNotification(delivered);
  registerCanonicalPointer(delivered);
  bumpMetric("NOTIFICATIONS_CREATED");
  return { decision, notification: delivered, activity: null };
}

export function notificationInteraction(_notification_id: string): { grants_authority: false; SOURCE_WRITE_AUTHORITY: false } {
  return { grants_authority: false, SOURCE_WRITE_AUTHORITY: false };
}

export function scheduleNativeFixture(notification: OwnerNotificationV1): { LIVE_MACOS_NOTIFICATION: string; result?: string } {
  const permission = readMacosNotificationPermission();
  if (permission.state !== "AUTHORIZED" && permission.state !== "PROVISIONAL") {
    return { LIVE_MACOS_NOTIFICATION: "NOT_AVAILABLE_FOR_CURRENT_PERMISSION" };
  }
  bumpMetric("MACOS_DELIVERY_REQUESTS");
  const human = projectHumanNotification(notification);
  const scheduled = nativeNotificationPort().schedule({
    identifier: `fixture-${notification.notification_id}`,
    title: human.title,
    body: human.message,
    category: "FIXTURE",
    thread: notification.work_id ?? "fixture",
    userInfo: { notification_id: notification.notification_id, work_id: notification.work_id ?? "", entity_id: notification.entity_id },
  });
  persistDelivery({
    schema: "NOTIFICATION_DELIVERY_EVIDENCE_V1",
    notification_id: notification.notification_id,
    delivery_channel: "MACOS_NATIVE",
    permission_state: permission.state,
    delivery_requested_at: nowIso(),
    delivery_request_result: scheduled.result,
    error_code: scheduled.error_code,
    USER_VIEWED_UNKNOWN: true,
  });
  if (scheduled.result === "DELIVERY_ACCEPTED_BY_OS") bumpMetric("MACOS_DELIVERY_ACCEPTED");
  else bumpMetric("MACOS_DELIVERY_FAILED");
  return { LIVE_MACOS_NOTIFICATION: scheduled.result, result: scheduled.result };
}

export function ownerNotificationSurfaceSlice(): Record<string, unknown> {
  const index = attentionIndex();
  return {
    schema: "OWNER_NOTIFICATION_BACKEND_V1",
    HUMAN_NOTIFICATION_REQUIRES_AI: false,
    NOTIFICATION_SOURCE_SEARCH_REQUIRED: false,
    attention: index,
    latest: queryNotifications("latest").slice(-5).map((row) => ({
      notification_id: row.notification_id,
      type: row.notification_type,
      action_required: row.action_required,
    })),
    active_work: listActiveWork().slice(-5),
    NEW_NOTIFICATION_PERMISSION_AUTO_REQUESTED: false,
    grants_authority: false,
  };
}

export function makeCanonicalEvent(partial: Omit<CanonicalEventV1, "schema" | "grants_authority" | "received_at" | "occurred_at" | "version"> & {
  readonly occurred_at?: string;
}): CanonicalEventV1 {
  const t = nowIso();
  return {
    schema: "CANONICAL_EVENT_V1",
    grants_authority: false,
    occurred_at: partial.occurred_at ?? t,
    received_at: t,
    version: 1,
    ...partial,
  };
}
