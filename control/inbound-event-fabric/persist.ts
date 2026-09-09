import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CodingClientActivityV1, InboundAdapterV1, OwnerSubmittedWorkV1, WorkOutputRecordV1 } from "./types";

function fileOf(envKey: string, fallback: string): string {
  const env = process.env[envKey];
  if (env && env.startsWith("/")) return env;
  return join(process.cwd(), "control/inbound-event-fabric/data", env ?? fallback);
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter((line) => line.trim().length > 0).map((line) => JSON.parse(line) as T);
}

function rewrite(path: string, rows: readonly unknown[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));
}

let adapters: InboundAdapterV1[] | null = null;
let works: OwnerSubmittedWorkV1[] | null = null;
let activities: CodingClientActivityV1[] | null = null;
let outputs: WorkOutputRecordV1[] | null = null;
let identities: string[] | null = null;

export function resetInboundMemory(): void {
  adapters = null;
  works = null;
  activities = null;
  outputs = null;
  identities = null;
}

export function listPersistedAdapters(): InboundAdapterV1[] {
  if (adapters === null) adapters = readJsonl<InboundAdapterV1>(fileOf("INBOUND_ADAPTER_LOG", "adapters.jsonl"));
  return adapters;
}

export function persistAdapter(row: InboundAdapterV1): void {
  const rows = listPersistedAdapters().filter((item) => item.adapter_id !== row.adapter_id);
  rows.push(row);
  adapters = rows;
  rewrite(fileOf("INBOUND_ADAPTER_LOG", "adapters.jsonl"), rows);
}

export function listSubmittedWork(): OwnerSubmittedWorkV1[] {
  if (works === null) works = readJsonl<OwnerSubmittedWorkV1>(fileOf("INBOUND_SUBMITTED_WORK_LOG", "submitted-work.jsonl"));
  return works;
}

export function persistSubmittedWork(row: OwnerSubmittedWorkV1): void {
  const rows = listSubmittedWork().filter((item) => item.work_id !== row.work_id);
  rows.push(row);
  works = rows;
  rewrite(fileOf("INBOUND_SUBMITTED_WORK_LOG", "submitted-work.jsonl"), rows);
}

export function listCodingActivities(): CodingClientActivityV1[] {
  if (activities === null) activities = readJsonl<CodingClientActivityV1>(fileOf("INBOUND_CODING_ACTIVITY_LOG", "coding-activity.jsonl"));
  return activities;
}

export function persistCodingActivity(row: CodingClientActivityV1): void {
  const rows = listCodingActivities().filter((item) => !(item.work_id === row.work_id && item.client_id === row.client_id));
  rows.push(row);
  activities = rows;
  rewrite(fileOf("INBOUND_CODING_ACTIVITY_LOG", "coding-activity.jsonl"), rows);
}

export function listOutputs(): WorkOutputRecordV1[] {
  if (outputs === null) outputs = readJsonl<WorkOutputRecordV1>(fileOf("INBOUND_OUTPUT_LOG", "outputs.jsonl"));
  return outputs;
}

export function persistOutput(row: WorkOutputRecordV1): void {
  const rows = listOutputs();
  rows.push(row);
  outputs = rows;
  rewrite(fileOf("INBOUND_OUTPUT_LOG", "outputs.jsonl"), rows);
}

export function seenIdentities(): string[] {
  if (identities === null) identities = readJsonl<{ key: string }>(fileOf("INBOUND_IDENTITY_LOG", "identities.jsonl")).map((row) => row.key);
  return identities;
}

export function rememberIdentity(key: string): boolean {
  const rows = seenIdentities();
  if (rows.includes(key)) return true;
  rows.push(key);
  identities = rows;
  rewrite(fileOf("INBOUND_IDENTITY_LOG", "identities.jsonl"), rows.map((item) => ({ key: item })));
  return false;
}
