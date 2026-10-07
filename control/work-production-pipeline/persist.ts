import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { dataPath } from "./host-runtime";
import type { PipelineRecordV1 } from "./types";

function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  const rows: T[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line) as T); } catch { /* skip */ }
  }
  return rows;
}

function appendJsonl(file: string, row: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(row)}\n`, "utf8");
}

export function persistPipeline(row: PipelineRecordV1): void {
  appendJsonl(dataPath("pipeline.jsonl", "WORK_PIPELINE_LOG"), row);
}
export function listPipelines(): PipelineRecordV1[] {
  const map = new Map<string, PipelineRecordV1>();
  for (const row of readJsonl<PipelineRecordV1>(dataPath("pipeline.jsonl", "WORK_PIPELINE_LOG"))) {
    map.set(row.work_id, row);
  }
  return [...map.values()];
}
export function persistNotification(row: unknown): void {
  appendJsonl(dataPath("notifications.jsonl", "WORK_PIPELINE_NOTIFY_LOG"), row);
}
export function listNotifications<T>(): T[] {
  return readJsonl<T>(dataPath("notifications.jsonl", "WORK_PIPELINE_NOTIFY_LOG"));
}
export function persistVerification(row: unknown): void {
  appendJsonl(dataPath("verification.jsonl", "WORK_PIPELINE_VERIFY_LOG"), row);
}
export function listVerifications<T>(): T[] {
  return readJsonl<T>(dataPath("verification.jsonl", "WORK_PIPELINE_VERIFY_LOG"));
}
export function persistDeployment(row: unknown): void {
  appendJsonl(dataPath("deployments.jsonl", "WORK_PIPELINE_DEPLOY_LOG"), row);
}
export function listDeployments<T>(): T[] {
  return readJsonl<T>(dataPath("deployments.jsonl", "WORK_PIPELINE_DEPLOY_LOG"));
}
export function persistCapability(row: unknown): void {
  appendJsonl(dataPath("capabilities.jsonl", "WORK_PIPELINE_CAPS_LOG"), row);
}
export function listProducedCapabilities<T>(): T[] {
  return readJsonl<T>(dataPath("capabilities.jsonl", "WORK_PIPELINE_CAPS_LOG"));
}
