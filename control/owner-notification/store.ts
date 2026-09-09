import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  NotificationDeliveryEvidenceV1,
  NotificationMetricsV1,
  OwnerActiveWorkProjectionV1,
  OwnerNotificationEnablementV1,
  OwnerNotificationV1,
} from "./types";

function fileOf(envKey: string, fallback: string): string {
  const env = process.env[envKey];
  if (env && env.startsWith("/")) return env;
  return join(process.cwd(), "control/owner-notification/data", env ?? fallback);
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter((line) => line.trim().length > 0).map((line) => JSON.parse(line) as T);
}

function rewrite(path: string, rows: readonly unknown[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));
}

function append(path: string, row: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const prefix = existsSync(path) ? readFileSync(path, "utf8") : "";
  writeFileSync(path, `${prefix}${JSON.stringify(row)}\n`);
}

export const emptyMetrics = (): NotificationMetricsV1 => ({
  EVENTS_EVALUATED: 0,
  EVENTS_IGNORED: 0,
  ACTIVITY_ONLY_EVENTS: 0,
  NOTIFICATIONS_CREATED: 0,
  NOTIFICATIONS_DEDUPLICATED: 0,
  OWNER_SURFACE_DELIVERIES: 0,
  MACOS_DELIVERY_REQUESTS: 0,
  MACOS_DELIVERY_ACCEPTED: 0,
  MACOS_DELIVERY_FAILED: 0,
  UNREAD_COUNT: 0,
  OWNER_ATTENTION_COUNT: 0,
});

let metrics: NotificationMetricsV1 = emptyMetrics();
let memoryNotifications: OwnerNotificationV1[] | null = null;
let memoryActivities: OwnerActiveWorkProjectionV1[] | null = null;

export function notificationMetrics(): NotificationMetricsV1 {
  const unread = listNotifications().filter((row) => row.read_at === null && row.dismissed_at === null).length;
  const attention = listNotifications().filter((row) => row.action_required && row.dismissed_at === null).length;
  metrics.UNREAD_COUNT = unread;
  metrics.OWNER_ATTENTION_COUNT = attention;
  return { ...metrics };
}

export function bumpMetric(key: keyof NotificationMetricsV1, by = 1): void {
  metrics[key] += by;
}

export function resetNotificationMemory(): void {
  memoryNotifications = null;
  memoryActivities = null;
}

export function listNotifications(): OwnerNotificationV1[] {
  if (memoryNotifications === null) memoryNotifications = readJsonl<OwnerNotificationV1>(fileOf("OWNER_NOTIFICATION_LOG", "notifications.jsonl"));
  return memoryNotifications;
}

export function persistNotification(row: OwnerNotificationV1): void {
  const rows = listNotifications().filter((item) => item.notification_id !== row.notification_id);
  rows.push(row);
  memoryNotifications = rows;
  rewrite(fileOf("OWNER_NOTIFICATION_LOG", "notifications.jsonl"), rows);
}

export function listActivities(): OwnerActiveWorkProjectionV1[] {
  if (memoryActivities === null) memoryActivities = readJsonl<OwnerActiveWorkProjectionV1>(fileOf("OWNER_ACTIVITY_LOG", "activities.jsonl"));
  return memoryActivities;
}

export function persistActivity(row: OwnerActiveWorkProjectionV1): void {
  const rows = listActivities().filter((item) => item.activity_id !== row.activity_id);
  rows.push(row);
  memoryActivities = rows;
  rewrite(fileOf("OWNER_ACTIVITY_LOG", "activities.jsonl"), rows);
}

export function persistDelivery(row: NotificationDeliveryEvidenceV1): void {
  append(fileOf("OWNER_NOTIFICATION_DELIVERY_LOG", "deliveries.jsonl"), row);
}

export function listDeliveries(): NotificationDeliveryEvidenceV1[] {
  return readJsonl<NotificationDeliveryEvidenceV1>(fileOf("OWNER_NOTIFICATION_DELIVERY_LOG", "deliveries.jsonl"));
}

export function loadEnablement(): OwnerNotificationEnablementV1 {
  const path = fileOf("OWNER_NOTIFICATION_ENABLEMENT_LOG", "enablement.jsonl");
  const rows = readJsonl<OwnerNotificationEnablementV1>(path);
  return rows[rows.length - 1] ?? {
    schema: "OWNER_NOTIFICATION_ENABLEMENT_V1",
    native_enabled: false,
    owner_surface_enabled: true,
    updated_at: new Date(0).toISOString(),
    NEW_NOTIFICATION_PERMISSION_AUTO_REQUESTED: false,
  };
}

export function persistEnablement(row: OwnerNotificationEnablementV1): void {
  append(fileOf("OWNER_NOTIFICATION_ENABLEMENT_LOG", "enablement.jsonl"), row);
}
