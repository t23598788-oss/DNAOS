/**
 * Canonical Owner work identity. One work_id per lifecycle, persisted per
 * Owner identity so continuation and restart read the same pointer.
 *
 * Input: identity_id, optional command text / result status.
 * Output: allocateCanonicalWorkId, resolveCanonicalWorkId, latestWorkForIdentity,
 * rememberLatestWork.
 * Dependency ที่อนุญาต: node:fs/path/crypto, ./host-runtime.ts.
 * สิ่งที่ห้ามแตะ: never use command_id as WORK_ID. never mint wo-${command_id}.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { hostNowIso } from "./host-runtime";

export type CanonicalWorkStatus =
  | "created"
  | "started"
  | "waiting_owner"
  | "blocked"
  | "failed"
  | "rejected"
  | "completed";

export interface CanonicalWorkPointer {
  readonly identity_id: string;
  readonly work_id: string;
  readonly command_id: string;
  readonly task_id: string | null;
  readonly status: CanonicalWorkStatus;
  readonly action_fingerprint: string;
  readonly summary: string | null;
  readonly capability_id: string | null;
  /** Observed execution stage for this work_id (engineering/build/github), never a guessed chat label. */
  readonly execution_stage: string;
  readonly updated_at: string;
}

const ROOT = join(process.cwd(), "control/owner-command/data");
const POINTER_FILE = join(ROOT, "latest-work.jsonl");

export function isCanonicalWorkId(value: string | null | undefined): value is string {
  return typeof value === "string" && /^work-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function allocateCanonicalWorkId(): string {
  return `work-${randomUUID()}`;
}

export function fingerprintOwnerAction(commandText: string): string {
  return createHash("sha256").update(commandText.trim().toLowerCase().replace(/\s+/g, " ")).digest("hex");
}

export function isWorkContinuationPhrase(commandText: string): boolean {
  const text = commandText.trim().toLowerCase();
  if (text === "continue" || text === "previous task" || text === "where is the last task now" || text === "is it finished") return true;
  if (text === "อันเมื่อกี้" || text === "ตัวเดิม" || text === "งานล่าสุด") return true;
  return /^(continue|previous task|where is the last task now|is it finished)\b/.test(text);
}

export function isWorkStatusPhrase(commandText: string): boolean {
  const text = commandText.trim().toLowerCase();
  return text === "where is the last task now" || text === "is it finished" || text === "งานล่าสุด";
}

function ensure(): void {
  mkdirSync(ROOT, { recursive: true });
  if (!existsSync(POINTER_FILE)) appendFileSync(POINTER_FILE, "");
}

function readAll(): CanonicalWorkPointer[] {
  ensure();
  const raw = readFileSync(POINTER_FILE, "utf8");
  if (raw.trim().length === 0) return [];
  return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line) as CanonicalWorkPointer);
}

export function latestWorkPointer(): CanonicalWorkPointer | null {
  const rows = readAll();
  return rows.length > 0 ? rows[rows.length - 1]! : null;
}

export function latestWorkForIdentity(identityId: string): CanonicalWorkPointer | null {
  const rows = readAll().filter((row) => row.identity_id === identityId);
  return rows.length > 0 ? rows[rows.length - 1]! : null;
}

export function workForActionFingerprint(identityId: string, fingerprint: string): CanonicalWorkPointer | null {
  const rows = readAll().filter((row) => row.identity_id === identityId && row.action_fingerprint === fingerprint);
  return rows.length > 0 ? rows[rows.length - 1]! : null;
}

export function rememberLatestWork(pointer: CanonicalWorkPointer): CanonicalWorkPointer {
  ensure();
  const row: CanonicalWorkPointer = {
    ...pointer,
    execution_stage: pointer.execution_stage || pointer.status,
    updated_at: pointer.updated_at || hostNowIso(),
  };
  appendFileSync(POINTER_FILE, `${JSON.stringify(row)}\n`);
  return row;
}

export function resolveCanonicalWorkId(input: {
  readonly identity_id: string;
  readonly command_text: string;
  readonly requested_work_id?: string | null;
}): { readonly work_id: string; readonly reused: boolean; readonly duplicate_action: boolean; readonly continuation: boolean; readonly status_query: boolean } {
  if (isCanonicalWorkId(input.requested_work_id)) {
    return { work_id: input.requested_work_id, reused: true, duplicate_action: false, continuation: true, status_query: isWorkStatusPhrase(input.command_text) };
  }
  const fingerprint = fingerprintOwnerAction(input.command_text);
  const duplicate = workForActionFingerprint(input.identity_id, fingerprint);
  if (duplicate && isCanonicalWorkId(duplicate.work_id)) {
    return { work_id: duplicate.work_id, reused: true, duplicate_action: true, continuation: false, status_query: false };
  }
  const continuation = isWorkContinuationPhrase(input.command_text);
  const latest = latestWorkForIdentity(input.identity_id);
  if (continuation && latest && isCanonicalWorkId(latest.work_id)) {
    return { work_id: latest.work_id, reused: true, duplicate_action: false, continuation: true, status_query: isWorkStatusPhrase(input.command_text) };
  }
  return { work_id: allocateCanonicalWorkId(), reused: false, duplicate_action: false, continuation: false, status_query: false };
}

export function workStatusFromCapability(status: string): CanonicalWorkStatus {
  if (status === "COMPLETED") return "completed";
  if (status === "FAILED") return "failed";
  if (status === "BLOCKED") return "blocked";
  if (status === "OWNER_REVIEW") return "waiting_owner";
  if (status === "RUNNING" || status === "PENDING" || status === "EXECUTING") return "started";
  if (status === "REJECTED") return "rejected";
  return "started";
}

export function isTerminalWorkStatus(status: CanonicalWorkStatus): boolean {
  return status === "completed" || status === "failed" || status === "blocked" || status === "rejected" || status === "waiting_owner";
}
