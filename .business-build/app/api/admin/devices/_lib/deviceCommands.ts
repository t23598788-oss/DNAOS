/**
 * Device Command lifecycle (owner step7,2026-09-26) — command_id, expiry,
 * acknowledgement, result, retry, idempotency. HARD RULES:
 *  - Success = terminal status from a REAL result ack — heartbeat/dispatch
 *    never touch status.
 *  - Permission re-checked at ACK with jobId=command.id (job-scoped grants).
 *  - Idempotency: submit-by-key returns SAME command (unique +23505 recovery);
 *    duplicate result = safe no-op returning stored terminal state; retry only
 *    from 'failed' under max_attempts.
 *  - Revoked device: dispatched/running → 'revoked' by revokeDevice; later
 *    ack/result hits the status guard here.
 * COMMAND_KINDS is closed — expand ONLY with owner approval (migration CHECK
 * is the database-side twin).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluateScope, type GrantRow } from "@/core/policy/scope";
import { isMissingTable } from "./deviceRegistry";

export const COMMAND_KINDS = ["managed.run"] as const;
export type CommandKind = (typeof COMMAND_KINDS)[number];

export interface DeviceCommandRow {
  id: string;
  device_id: string;
  command_kind: string;
  payload: Record<string, unknown>;
  idempotency_key: string;
  status: "dispatched" | "running" | "succeeded" | "failed" | "cancelled" | "revoked";
  attempts: number;
  max_attempts: number;
  expires_at: string;
  result: Record<string, unknown> | null;
  error: string | null;
  created_by: string;
  created_at: string;
  acked_at: string | null;
  finished_at: string | null;
}

export type CmdFail = {
  ok: false;
  code: "META_TABLES_MISSING" | "KIND_UNKNOWN" | "DEVICE_NOT_FOUND" | "DEVICE_REVOKED" | "SCOPE_DENIED" | "NOT_FOUND" | "WRONG_DEVICE" | "EXPIRED" | "CONFLICT" | "NOT_ACKED" | "RETRY_EXHAUSTED";
  error: string;
};

function fail(code: CmdFail["code"], error: string): CmdFail {
  return { ok: false, code, error };
}
function rethrow(e: unknown): never {
  if (isMissingTable(e)) {
    const err = new Error("ตาราง device_commands/scoped_grants ยังไม่ถูกสร้างบนฐานข้อมูลนี้ (รัน migration 20260926000001 ก่อน)") as Error & { code?: string };
    err.code = "META_TABLES_MISSING";
    throw err;
  }
  throw e;
}

async function liveGrants(db: SupabaseClient, deviceId: string): Promise<GrantRow[]> {
  try {
    const { data, error } = await db
      .from("scoped_grants")
      .select("subject_type, subject_id, action, resource, job_id, expires_at, revoked_at")
      .eq("subject_type", "device")
      .eq("subject_id", deviceId);
    if (error) throw new Error(error.message);
    return (data ?? []) as GrantRow[];
  } catch (e) {
    rethrow(e);
  }
}

export type CreateResult =
  | { ok: true; command: DeviceCommandRow; created: boolean }
  | CmdFail;

/** Admin-side dispatch: scope check (deny-default) THEN insert (idempotent). */
export async function createDeviceCommand(
  db: SupabaseClient,
  input: { deviceId: string; kind: string; payload?: Record<string, unknown>; idempotencyKey: string; createdBy: string; ttlSeconds?: number },
): Promise<CreateResult> {
  if (!(COMMAND_KINDS as readonly string[]).includes(input.kind)) {
    return fail("KIND_UNKNOWN", `command_kind ไม่อยู่ในชุดปิด: ${COMMAND_KINDS.join(", ")}`);
  }
  const payload = input.payload ?? {};
  const toolId = typeof payload.tool_id === "string" && payload.tool_id ? payload.tool_id : input.kind;

  let device: { status: string } | null = null;
  try {
    const { data, error } = await db.from("device_registry").select("status").eq("id", input.deviceId).maybeSingle();
    if (error) throw new Error(error.message);
    device = data as { status: string } | null;
  } catch (e) { rethrow(e); }
  if (!device) return fail("DEVICE_NOT_FOUND", "ไม่พบอุปกรณ์นี้");
  if (device.status === "revoked") return fail("DEVICE_REVOKED", "อุปกรณ์ถูกเพิกถอนแล้ว");

  // Deny-by-default scope gate BEFORE any dispatch (owner step2/4).
  const grants = await liveGrants(db, input.deviceId);
  const decision = evaluateScope({ subject: { deviceId: input.deviceId }, action: "run", resource: toolId }, grants);
  if (!decision.allow) return fail("SCOPE_DENIED", `${decision.code}: ${decision.reason}`);

  try {
    const { data: existing } = await db.from("device_commands").select("*").eq("idempotency_key", input.idempotencyKey).maybeSingle();
    if (existing) return { ok: true, command: existing as DeviceCommandRow, created: false };
  } catch (e) { rethrow(e); }

  const ttl = Math.max(60, Math.min(input.ttlSeconds ?? 900, 3600));
  const row = {
    device_id: input.deviceId,
    command_kind: input.kind,
    payload,
    idempotency_key: input.idempotencyKey,
    status: "dispatched",
    attempts: 1,
    max_attempts: 3,
    expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
    created_by: input.createdBy,
  };
  try {
    const { data, error } = await db.from("device_commands").insert(row).select("*").single();
    if (error) {
      if (String((error as { code?: string }).code) === "23505" || /duplicate|unique/i.test(error.message ?? "")) {
        const { data: again } = await db.from("device_commands").select("*").eq("idempotency_key", input.idempotencyKey).maybeSingle();
        if (again) return { ok: true, command: again as DeviceCommandRow, created: false };
      }
      throw new Error(error.message);
    }
    return { ok: true, command: data as DeviceCommandRow, created: true };
  } catch (e) { rethrow(e); }
}

/** Device pull: expire stale dispatches FIRST, then hand out live ones. */
export async function pullDeviceCommands(db: SupabaseClient, deviceId: string, limit = 5): Promise<DeviceCommandRow[]> {
  try {
    const nowIso = new Date().toISOString();
    await db
      .from("device_commands")
      .update({ status: "failed", error: "expired before ack", finished_at: nowIso, updated_at: nowIso })
      .eq("device_id", deviceId)
      .eq("status", "dispatched")
      .lte("expires_at", nowIso);
    const { data, error } = await db
      .from("device_commands")
      .select("*")
      .eq("device_id", deviceId)
      .eq("status", "dispatched")
      .gt("expires_at", nowIso)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []) as DeviceCommandRow[];
  } catch (e) { rethrow(e); }
}

export type AckResult = { ok: true; already?: boolean } | CmdFail;

/** Device ack: dispatched→running (CAS) + POLICY RE-CHECK with jobId=command. */
export async function ackCommand(db: SupabaseClient, commandId: string, deviceId: string): Promise<AckResult> {
  const nowIso = new Date().toISOString();
  let acked: DeviceCommandRow | null = null;
  try {
    const { data, error } = await db
      .from("device_commands")
      .update({ status: "running", acked_at: nowIso, updated_at: nowIso })
      .eq("id", commandId)
      .eq("device_id", deviceId)
      .eq("status", "dispatched")
      .gt("expires_at", nowIso)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    acked = data as DeviceCommandRow | null;
  } catch (e) { rethrow(e); }

  if (!acked) {
    let row: DeviceCommandRow | null = null;
    try {
      const { data } = await db.from("device_commands").select("*").eq("id", commandId).maybeSingle();
      row = data as DeviceCommandRow | null;
    } catch (e) { rethrow(e); }
    if (!row) return fail("NOT_FOUND", "ไม่พบคำสั่งนี้");
    if (row.device_id !== deviceId) return fail("WRONG_DEVICE", "คำสั่งนี้ไม่ได้ส่งให้อุปกรณ์นี้");
    if (row.status === "running") return { ok: true, already: true };
    if (row.status === "failed" && row.error === "expired before ack") return fail("EXPIRED", "คำสั่งหมดอายุก่อนรับ");
    return fail("CONFLICT", `สถานะปัจจุบัน '${row.status}' ไม่รับ ack ได้`);
  }

  // Permission re-check AT ack with jobId = this command (job-bound grants).
  const toolId = typeof acked.payload?.tool_id === "string" ? (acked.payload.tool_id as string) : acked.command_kind;
  const grants = await liveGrants(db, deviceId);
  const decision = evaluateScope({ subject: { deviceId }, action: "run", resource: toolId, jobId: commandId }, grants);
  if (!decision.allow) {
    try {
      await db.from("device_commands")
        .update({ status: "cancelled", error: `SCOPE_DENIED@ack: ${decision.code}`, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", commandId)
        .eq("status", "running");
    } catch (e) { if (!isMissingTable(e)) console.error("[cmd] cancel-on-scope-denied failed:", e); }
    return fail("SCOPE_DENIED", `${decision.code}: ${decision.reason}`);
  }
  return { ok: true };
}

export type CompleteResult = { ok: true; status: string; duplicate?: boolean } | CmdFail;

/** Device result: running→terminal EXACTLY ONCE (duplicate ack = no-op). */
export async function completeCommand(
  db: SupabaseClient,
  commandId: string,
  deviceId: string,
  outcome: { ok: boolean; result?: Record<string, unknown>; error?: string },
): Promise<CompleteResult> {
  const target = outcome.ok ? "succeeded" : "failed";
  const nowIso = new Date().toISOString();
  let done: DeviceCommandRow | null = null;
  try {
    const { data, error } = await db
      .from("device_commands")
      .update({
        status: target,
        result: outcome.result ?? null,
        error: outcome.ok ? null : (outcome.error ?? "failed"),
        finished_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", commandId)
      .eq("device_id", deviceId)
      .eq("status", "running")
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    done = data as DeviceCommandRow | null;
  } catch (e) { rethrow(e); }

  if (done) return { ok: true, status: target };

  let row: DeviceCommandRow | null = null;
  try {
    const { data } = await db.from("device_commands").select("*").eq("id", commandId).maybeSingle();
    row = data as DeviceCommandRow | null;
  } catch (e) { rethrow(e); }
  if (!row) return fail("NOT_FOUND", "ไม่พบคำสั่งนี้");
  if (row.device_id !== deviceId) return fail("WRONG_DEVICE", "คำสั่งนี้ไม่ได้ส่งให้อุปกรณ์นี้");
  if (row.status === "succeeded" || row.status === "failed") {
    return { ok: true, status: row.status, duplicate: true }; // retry-safe: first result wins
  }
  if (row.status === "revoked") return fail("CONFLICT", "อุปกรณ์ถูกเพิกถอนระหว่างทำงาน — ผลนี้ไม่ถูกนับเป็นความสำเร็จ");
  if (row.status === "cancelled") return fail("CONFLICT", "คำสั่งถูกยกเลิกแล้ว");
  if (row.status === "dispatched") return fail("NOT_ACKED", "ต้อง ack ก่อนส่งผล");
  return fail("CONFLICT", `สถานะ '${row.status}' ไม่รับผลได้`);
}

/** Admin retry: only failed & attempts<max → re-dispatch with fresh expiry. */
export async function requeueCommand(db: SupabaseClient, commandId: string): Promise<{ ok: true; command: DeviceCommandRow } | CmdFail> {
  const nowIso = new Date().toISOString();
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  try {
    const { data: current } = await db.from("device_commands").select("*").eq("id", commandId).maybeSingle();
    const row = current as DeviceCommandRow | null;
    if (!row) return fail("NOT_FOUND", "ไม่พบคำสั่งนี้");
    if (row.status !== "failed") return fail("CONFLICT", `requeue ได้เฉพาะสถานะ failed (ตอนนี้ '${row.status}')`);
    if (row.attempts >= row.max_attempts) return fail("RETRY_EXHAUSTED", `ใช้ครั้งครบ ${row.attempts}/${row.max_attempts} แล้ว`);

    const { data, error } = await db
      .from("device_commands")
      .update({ status: "dispatched", attempts: row.attempts + 1, expires_at: expires, acked_at: null, finished_at: null, result: null, error: null, updated_at: nowIso })
      .eq("id", commandId)
      .eq("status", "failed")
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return fail("CONFLICT", "สถานะเปลี่ยนระหว่าง requeue");
    return { ok: true, command: data as DeviceCommandRow };
  } catch (e) { rethrow(e); }
}


