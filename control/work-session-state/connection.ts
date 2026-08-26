/**
 * หน้าที่: §5 CONNECTION RECOVERY + §6 OFFLINE-FIRST EXECUTION STATE.
 *
 * หลักการเดียวของไฟล์นี้: **อายุของ connection ไม่ใช่อายุของงาน**
 * SSE/WebSocket/เน็ตเป็นของใช้แล้วทิ้ง ตัดแล้วต่อใหม่ได้ ส่วนงานอยู่บนดิสก์
 *
 *   ตัด → บันทึกสถานะ connection → retry แบบ backoff ที่มีเพดาน
 *       → resume จาก event สุดท้ายที่ประมวลผลจริง → คืนสิ่งที่พลาดไป → CONNECTED
 *
 * และเมื่อไม่มีเน็ต งานที่ไม่ต้องใช้เน็ตเดินต่อ ส่วนงานที่ต้องใช้กลายเป็น
 * `WAITING_FOR_NETWORK` พร้อม next_action / provider / operation / evidence
 * ไม่ใช่ error ที่หายไปเฉย ๆ และไม่ต้องให้ Owner พิมพ์ใหม่
 *
 * Input: connection events และ operation ที่ต้องใช้เน็ต.
 * Output: `nextBackoffMs`, `recordConnectionState`, `readConnectionState`,
 * `reconcile`, `queueNetworkOperation`, `readQueue`, `drainQueue`.
 * Dependency ที่อนุญาต: Node built-ins + ./types.ts.
 * สิ่งที่ห้ามแตะ:
 * - ห้าม retry แบบไม่มีเพดาน และห้าม retry ถี่จนกลายเป็นการถล่มปลายทางเอง
 * - ห้ามถือว่า "ไม่มี event ใหม่" กับ "บอกไม่ได้ว่าพลาดอะไร" เป็นเรื่องเดียวกัน
 *   อย่างหลังต้องกลับไปเอา snapshot เต็ม
 * - ห้ามรัน queued operation ซ้ำโดยไม่มี idempotency key
 * - ห้ามให้ operation ที่ต้องการอำนาจตัดสินใจของ Owner รันเองอัตโนมัติ
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import type { StreamPosition } from "./types";

/** เพดาน backoff ที่ประกาศไว้ ไม่ใช่ค่าที่ซ่อนอยู่ในโค้ด */
export const BACKOFF_BASE_MS = 500;
export const BACKOFF_MAX_MS = 30_000;
export const BACKOFF_MAX_ATTEMPTS = 12;

export type ConnectionStatus = "CONNECTED" | "DISCONNECTED" | "RETRYING" | "GAVE_UP";

export interface ConnectionState {
  stream_id: string;
  status: ConnectionStatus;
  attempt: number;
  next_retry_in_ms: number | null;
  last_event_id: string | null;
  last_change_at: string;
  detail: string;
}

/**
 * Exponential backoff with a declared ceiling and a declared attempt limit.
 * Deterministic — no jitter — so a proof can assert the exact sequence; a
 * fleet of clients hammering one endpoint in lockstep is a real concern, and
 * is noted here as `UD-CONN-01` rather than solved with an undeclared random.
 */
export function nextBackoffMs(attempt: number): number | null {
  if (attempt >= BACKOFF_MAX_ATTEMPTS) return null;
  return Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_MAX_MS);
}

export function connectionStatePath(root = process.env.WORK_SESSION_STATE_ROOT ?? resolve(process.cwd(), "local-runtime/work-session-state")): string {
  return resolve(root, "connections.jsonl");
}
export function networkQueuePath(root = process.env.WORK_SESSION_STATE_ROOT ?? resolve(process.cwd(), "local-runtime/work-session-state")): string {
  return resolve(root, "network-queue.jsonl");
}

function appendLine(path: string, row: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(row)}\n`, { mode: 0o600 });
}
function readLines<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const out: T[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try { out.push(JSON.parse(line) as T); } catch { /* half-written line */ }
  }
  return out;
}

export function recordConnectionState(state: Omit<ConnectionState, "last_change_at">, options: { path?: string } = {}): ConnectionState {
  const row: ConnectionState = { ...state, last_change_at: new Date().toISOString() };
  appendLine(options.path ?? connectionStatePath(), row);
  return row;
}

/** Current state per stream = its last recorded row. */
export function readConnectionState(options: { path?: string } = {}): ConnectionState[] {
  const latest = new Map<string, ConnectionState>();
  for (const row of readLines<ConnectionState>(options.path ?? connectionStatePath())) latest.set(row.stream_id, row);
  return Array.from(latest.values());
}

/** The disconnect side of the loop: record it, and say when to try again. */
export function recordDisconnect(streamId: string, lastEventId: string | null, detail: string, options: { path?: string } = {}): ConnectionState {
  const previous = readConnectionState(options).find((c) => c.stream_id === streamId);
  const attempt = previous && previous.status !== "CONNECTED" ? previous.attempt + 1 : 0;
  const wait = nextBackoffMs(attempt);
  return recordConnectionState({
    stream_id: streamId,
    status: wait === null ? "GAVE_UP" : "RETRYING",
    attempt,
    next_retry_in_ms: wait,
    last_event_id: lastEventId ?? previous?.last_event_id ?? null,
    detail: wait === null ? `${detail} — ${BACKOFF_MAX_ATTEMPTS} attempts reached, no further automatic retry` : detail,
  }, options);
}

export function recordConnected(streamId: string, lastEventId: string | null, detail: string, options: { path?: string } = {}): ConnectionState {
  return recordConnectionState({ stream_id: streamId, status: "CONNECTED", attempt: 0, next_retry_in_ms: null, last_event_id: lastEventId, detail }, options);
}

export interface ReconcileResult {
  stream_id: string;
  outcome: "RESUMED" | "FULL_RESYNC_REQUIRED";
  /** Events the producer says were missed, when it could tell us. */
  missed: readonly unknown[];
  detail: string;
}

/**
 * Asks the producer for what was missed since `last_event_id`.
 *
 * `fetchSince` returns `null` when the producer cannot place that event id.
 * That is NOT the same as "nothing was missed" and is never treated as such:
 * an unplaceable resume point forces a full resync, because a client told
 * "you missed nothing" when the truth is "I cannot tell" loses events in
 * silence, which is the failure this whole phase exists to prevent.
 */
export function reconcile(
  streamId: string,
  fetchSince: (lastEventId: string | null) => readonly unknown[] | null,
  options: { path?: string } = {},
): ReconcileResult {
  const state = readConnectionState(options).find((c) => c.stream_id === streamId) ?? null;
  const missed = fetchSince(state?.last_event_id ?? null);
  if (missed === null) {
    recordConnected(streamId, state?.last_event_id ?? null, "resume point unknown to the producer — took a full snapshot instead", options);
    return { stream_id: streamId, outcome: "FULL_RESYNC_REQUIRED", missed: [], detail: `producer could not place last_event_id=${state?.last_event_id ?? "null"}` };
  }
  const lastId = missed.length > 0 ? ((missed[missed.length - 1] as { event_id?: string }).event_id ?? state?.last_event_id ?? null) : (state?.last_event_id ?? null);
  recordConnected(streamId, lastId, `resumed, ${missed.length} event(s) replayed`, options);
  return { stream_id: streamId, outcome: "RESUMED", missed, detail: `${missed.length} event(s) replayed since ${state?.last_event_id ?? "the beginning"}` };
}

// ---------------------------------------------------------------------------
// §6 OFFLINE-FIRST
// ---------------------------------------------------------------------------

export interface QueuedOperation {
  operation_id: string;
  work_id: string;
  /** The provider the operation cannot run without, e.g. `railway`, `supabase`, `github`. */
  required_provider: string;
  /** What the operation is, in the caller's own words. */
  operation: string;
  /** The one action that runs it when the network is back. */
  next_action: string;
  /** Re-running must be safe; this is the key that makes it so. */
  idempotency_key: string;
  /**
   * `true` when a human must approve before this runs, even once the network
   * is back — an authority boundary is not a connectivity problem and must
   * never be crossed automatically by a drain.
   */
  requires_owner_authority: boolean;
  evidence_refs: readonly string[];
  status: "WAITING_FOR_NETWORK" | "READY" | "DONE" | "BLOCKED_ON_OWNER";
  queued_at: string;
  detail: string;
}

export function queueNetworkOperation(
  input: Omit<QueuedOperation, "operation_id" | "status" | "queued_at" | "idempotency_key"> & { idempotency_key?: string },
  options: { path?: string } = {},
): QueuedOperation {
  const row: QueuedOperation = {
    ...input,
    operation_id: `qop-${randomUUID()}`,
    idempotency_key: input.idempotency_key ?? `${input.work_id}:${input.required_provider}:${input.operation}`,
    status: "WAITING_FOR_NETWORK",
    queued_at: new Date().toISOString(),
  };
  appendLine(options.path ?? networkQueuePath(), row);
  return row;
}

export function readQueue(options: { path?: string } = {}): QueuedOperation[] {
  const latest = new Map<string, QueuedOperation>();
  for (const row of readLines<QueuedOperation>(options.path ?? networkQueuePath())) latest.set(row.operation_id, row);
  // Same operation queued twice = the same idempotency key; keep one.
  const byKey = new Map<string, QueuedOperation>();
  for (const row of Array.from(latest.values())) {
    const existing = byKey.get(row.idempotency_key);
    if (!existing || row.queued_at > existing.queued_at || existing.status === "WAITING_FOR_NETWORK") byKey.set(row.idempotency_key, row);
  }
  return Array.from(byKey.values());
}

export interface DrainResult {
  ran: readonly QueuedOperation[];
  held_for_owner: readonly QueuedOperation[];
  still_waiting: readonly QueuedOperation[];
}

/**
 * Runs everything that was only waiting for connectivity, and nothing that was
 * waiting for a decision.
 *
 * `isOnline(provider)` is asked per provider — "the internet" is not one thing,
 * and one reachable provider does not make another reachable.
 */
export function drainQueue(
  isOnline: (provider: string) => boolean,
  run: (op: QueuedOperation) => { ok: boolean; detail: string },
  options: { path?: string } = {},
): DrainResult {
  const path = options.path ?? networkQueuePath();
  const ran: QueuedOperation[] = [];
  const held: QueuedOperation[] = [];
  const waiting: QueuedOperation[] = [];
  for (const op of readQueue({ path })) {
    if (op.status === "DONE") continue;
    if (op.requires_owner_authority) {
      const row = { ...op, status: "BLOCKED_ON_OWNER" as const, detail: "the network is not what this is waiting for — it needs the Owner's decision, and a drain never makes that decision" };
      appendLine(path, row); held.push(row); continue;
    }
    if (!isOnline(op.required_provider)) {
      const row = { ...op, status: "WAITING_FOR_NETWORK" as const, detail: `${op.required_provider} still unreachable` };
      appendLine(path, row); waiting.push(row); continue;
    }
    const result = run(op);
    const row = { ...op, status: result.ok ? ("DONE" as const) : ("WAITING_FOR_NETWORK" as const), detail: result.detail };
    appendLine(path, row);
    (result.ok ? ran : waiting).push(row);
  }
  return { ran, held_for_owner: held, still_waiting: waiting };
}

/** The stream positions to store on a checkpoint, from the recorded connection state. */
export function streamPositions(options: { path?: string } = {}): StreamPosition[] {
  return readConnectionState(options).map((c) => ({ stream_id: c.stream_id, last_event_id: c.last_event_id, observed_at: c.last_change_at }));
}
