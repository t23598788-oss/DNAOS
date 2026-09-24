/**
 * Device Registry metadata layer (2026-09-25) — the ONE read/write path for
 * device_registry + device_pairing_codes. Secrets = sha256 hashes of the
 * device's OWN token/code — never an owner/admin/service-role secret.
 * Reads fail OPEN to migrated:false; mutations FAIL CLOSED (META_TABLES_MISSING).
 * Pairing codes: sha256 · 10-min expiry · attempt cap · single use.
 * The paired account's role is re-read on every auth (install ≠ permanent right).
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const DEVICE_GRANTS = ["device.health", "printers.read"] as const;
export type DeviceGrant = (typeof DEVICE_GRANTS)[number];
/** Server→device command allowlist (no shell, no free-form commands). */
export const DEVICE_COMMANDS = ["probe_printers"] as const;
export type DeviceCommand = (typeof DEVICE_COMMANDS)[number];

export interface DeviceRow {
  id: string;
  device_name: string;
  paired_user_id: string;
  paired_email: string;
  paired_role: string;
  status: "paired" | "revoked";
  device_token_hash: string | null;
  grants: string[];
  os: string | null;
  os_release: string | null;
  arch: string | null;
  cpu_count: number | null;
  ram_bytes: number | null;
  disk_free_bytes: number | null;
  node_version: string | null;
  tools: Record<string, unknown>;
  pending_probe: string | null;
  last_seen_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface HealthInput {
  os?: string;
  osRelease?: string;
  arch?: string;
  cpuCount?: number;
  ramBytes?: number;
  diskFreeBytes?: number;
  nodeVersion?: string;
  tools?: Record<string, unknown>;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function isMissingTable(err: unknown): boolean {
  // PostgrestError in this supabase-js build is a plain object (NOT an Error
  // subclass) — caught by the live pair probe (500 instead of the designed
  // 409): read .message from any shape, and honor the PGRST205 code directly.
  if (typeof err === "object" && err !== null && (err as { code?: unknown }).code === "PGRST205") return true;
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err !== null && typeof (err as { message?: unknown }).message === "string"
        ? (err as { message: string }).message
        : String(err);
  return /Could not find the table|relation .* does not exist|PGRST205|schema cache/i.test(msg);
}

function missingTables(): Error & { code?: string } {
  const e = new Error(
    "ตาราง device_registry ยังไม่ถูกสร้างบนฐานข้อมูลนี้ (รัน migration 20260925000001_device_registry ก่อนใช้งานอุปกรณ์)",
  ) as Error & { code?: string };
  e.code = "META_TABLES_MISSING";
  return e;
}

export async function loadDevices(db: SupabaseClient): Promise<{ rows: DeviceRow[]; migrated: boolean }> {
  try {
    const { data, error } = await db.from("device_registry").select("*").order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { rows: (data ?? []) as DeviceRow[], migrated: true };
  } catch (e) {
    if (isMissingTable(e)) return { rows: [], migrated: false };
    throw e;
  }
}

/** Admin mints a one-time pairing code; plain code returned ONCE, only sha256 stored. */
export async function createPairingCode(
  db: SupabaseClient,
  input: { deviceName: string; requestedBy: { id: string; email: string; role: string } },
): Promise<{ device: DeviceRow; code: string; expiresAt: string }> {
  const deviceName = input.deviceName.trim();
  if (!deviceName || deviceName.length > 80) {
    throw Object.assign(new Error("device_name ต้องมี1-80อักษร"), { code: "INVALID_DEVICE_NAME" });
  }
  const code = randomBytes(6).toString("base64url");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const { data: device, error: devErr } = await db
    .from("device_registry")
    .insert({
      device_name: deviceName,
      paired_user_id: input.requestedBy.id,
      paired_email: input.requestedBy.email,
      paired_role: input.requestedBy.role,
      status: "paired",
      grants: [...DEVICE_GRANTS],
    })
    .select("*")
    .single();
  if (devErr) {
    if (isMissingTable(devErr)) throw missingTables();
    throw new Error(devErr.message);
  }
  const { error: codeErr } = await db.from("device_pairing_codes").insert({
    code_hash: sha256Hex(code),
    device_id: (device as DeviceRow).id,
    requested_by: input.requestedBy.id,
    expires_at: expiresAt,
  });
  if (codeErr) {
    if (isMissingTable(codeErr)) throw missingTables();
    throw new Error(codeErr.message);
  }
  return { device: device as DeviceRow, code, expiresAt };
}

export type PairResult =
  | { ok: true; deviceId: string; token: string; grants: string[] }
  | { ok: false; code: "INVALID_CODE" | "CODE_EXPIRED" | "CODE_CONSUMED" | "ATTEMPTS_EXCEEDED" | "DEVICE_REVOKED"; error: string };

/** Machine exchanges a one-time code for ITS OWN device token (returned once). */
export async function pairDevice(
  db: SupabaseClient,
  input: { code: string; health?: HealthInput },
): Promise<PairResult> {
  // Atomic exchange lives in SQL (device_pair_code): single-statement CAS —
  // proven live by tmp/device_pair_proof.py (two concurrent clients → exactly
  // one winner; retry → CODE_UNUSABLE). The plain token exists only in this
  // response; only its sha256 was written (by the function) to the device row.
  const token = `dnad_${randomBytes(24).toString("base64url")}`;
  const pCodeHash = sha256Hex(input.code);
  const pTokenHash = sha256Hex(token);
  type PairRpc = { data: { device_id?: string; grants?: string[] } | null; error: { message?: string } | null };
  let data: PairRpc["data"] = null;
  let error: PairRpc["error"] = null;
  try {
    const res = (await db.rpc("device_pair_code", { p_code_hash: pCodeHash, p_token_hash: pTokenHash })) as unknown as PairRpc;
    data = res.data;
    error = res.error;
  } catch (e) {
    if (isMissingTable(e) || /device_pair_code|schema cache|Could not find/i.test(String(e))) throw missingTables();
    throw e;
  }
  if (error) {
    const msg = error.message ?? "";
    if (isMissingTable(error) || /device_pair_code|schema cache|Could not find the function/i.test(msg)) throw missingTables();
    if (msg.includes("INVALID_CODE")) return { ok: false, code: "INVALID_CODE", error: "ไม่พบโค้ดจับคู่นี้" };
    if (msg.includes("DEVICE_REVOKED")) return { ok: false, code: "DEVICE_REVOKED", error: "อุปกรณ์นี้ถูกเพิกถอนแล้ว" };
    if (msg.includes("CODE_UNUSABLE")) {
      return { ok: false, code: "CODE_CONSUMED", error: "โค้ดถูกใช้ไปแล้ว/หมดอายุ/ถูกล็อก — ขอโค้ดใหม่จากหน้าอุปกรณ์" };
    }
    return { ok: false, code: "INVALID_CODE", error: msg || "แลกโค้ดไม่สำเร็จ" };
  }
  if (!data?.device_id) return { ok: false, code: "INVALID_CODE", error: "แลกโค้ดไม่สำเร็จ" };

  // Hardware facts are SOFT state — refreshed best-effort after the atomic
  // exchange (the next heartbeat overwrites them anyway).
  if (input.health) {
    try {
      await db.from("device_registry").update({
        os: input.health.os ?? null,
        os_release: input.health.osRelease ?? null,
        arch: input.health.arch ?? null,
        cpu_count: input.health.cpuCount ?? null,
        ram_bytes: input.health.ramBytes ?? null,
        disk_free_bytes: input.health.diskFreeBytes ?? null,
        node_version: input.health.nodeVersion ?? null,
        tools: input.health.tools ?? {},
      }).eq("id", data.device_id);
    } catch { /* heartbeat will refresh */ }
  }
  return {
    ok: true,
    deviceId: data.device_id,
    token,
    grants: Array.isArray(data.grants) ? data.grants : [...DEVICE_GRANTS],
  };
}


export type DeviceAuth =
  | { ok: true; device: DeviceRow; accountRole: string | null }
  | { ok: false; error: string; status: 401 | 403 | 409 };

/**
 * Device-token auth for internal routes: token → sha256 → paired row →
 * paired account must still exist with a role (install ≠ permanent right).
 * Never logs or echoes the token.
 */
export async function authenticateDevice(db: SupabaseClient, token: string): Promise<DeviceAuth> {
  if (!token) return { ok: false, error: "缺少 device token", status: 401 };
  const tokenHash = sha256Hex(token);
  let device: DeviceRow | null = null;
  try {
    const { data, error } = await db
      .from("device_registry")
      .select("*")
      .eq("device_token_hash", tokenHash)
      .limit(1);
    if (error) throw new Error(error.message);
    device = ((data ?? []) as DeviceRow[])[0] ?? null;
  } catch (e) {
    if (isMissingTable(e)) {
      return { ok: false, error: "ตาราง device_registry ยังไม่ถูกสร้างบนฐานข้อมูลนี้", status: 409 };
    }
    throw e;
  }
  if (!device) return { ok: false, error: "device token ไม่ถูกต้อง", status: 401 };
  if (device.status === "revoked") return { ok: false, error: "อุปกรณ์ถูกเพิกถอนแล้ว", status: 403 };

  const a = Buffer.from(device.device_token_hash ?? "", "utf8");
  const b = Buffer.from(tokenHash, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, error: "device token ไม่ถูกต้อง", status: 401 };
  }

  let accountRole: string | null = null;
  try {
    const { data: profile } = await db.from("profiles").select("role").eq("id", device.paired_user_id).maybeSingle();
    accountRole = (profile?.role as string | null) ?? null;
  } catch {
    accountRole = null;
  }
  if (!accountRole) {
    return { ok: false, error: "บัญชีที่ผูกกับอุปกรณ์นี้ถูกลบ/ระงับแล้ว — จับคู่ใหม่ด้วยบัญชีที่ยังใช้งาน", status: 403 };
  }
  return { ok: true, device, accountRole };
}

/** Health upsert from the device loop; consumes a pending command once delivered. */
export async function recordDeviceHealth(
  db: SupabaseClient,
  deviceId: string,
  health: HealthInput,
): Promise<{ pendingCommand: DeviceCommand | null }> {
  const nowIso = new Date().toISOString();
  const { data: current, error: curErr } = await db
    .from("device_registry")
    .select("pending_probe")
    .eq("id", deviceId)
    .maybeSingle();
  if (curErr) {
    if (isMissingTable(curErr)) throw missingTables();
    throw new Error(curErr.message);
  }
  const pending = (current?.pending_probe as string | null) ?? null;
  const { error } = await db
    .from("device_registry")
    .update({
      os: health.os ?? null,
      os_release: health.osRelease ?? null,
      arch: health.arch ?? null,
      cpu_count: health.cpuCount ?? null,
      ram_bytes: health.ramBytes ?? null,
      disk_free_bytes: health.diskFreeBytes ?? null,
      node_version: health.nodeVersion ?? null,
      tools: health.tools ?? {},
      last_seen_at: nowIso,
      updated_at: nowIso,
      ...(pending ? { pending_probe: null } : {}),
    })
    .eq("id", deviceId);
  if (error) {
    if (isMissingTable(error)) throw missingTables();
    throw new Error(error.message);
  }
  const known = (DEVICE_COMMANDS as readonly string[]).includes(pending ?? "");
  return { pendingCommand: known ? (pending as DeviceCommand) : null };
}

/** Admin: queue a server→device probe command (allowlisted kinds only). */
export async function queueDeviceProbe(db: SupabaseClient, deviceId: string, kind: DeviceCommand): Promise<DeviceRow> {
  const { data, error } = await db
    .from("device_registry")
    .update({ pending_probe: kind, updated_at: new Date().toISOString() })
    .eq("id", deviceId)
    .eq("status", "paired")
    .select("*")
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) throw missingTables();
    throw new Error(error.message);
  }
  if (!data) throw Object.assign(new Error("ไม่พบอุปกรณ์ที่ยังจับคู่อยู่"), { code: "DEVICE_NOT_FOUND" });
  return data as DeviceRow;
}

/** Admin: revoke — token stops authenticating immediately (hash kept for audit). */
export async function revokeDevice(db: SupabaseClient, deviceId: string): Promise<void> {
  const nowIso = new Date().toISOString();
  const { error } = await db
    .from("device_registry")
    .update({ status: "revoked", revoked_at: nowIso, pending_probe: null, updated_at: nowIso })
    .eq("id", deviceId);
  if (error) {
    if (isMissingTable(error)) throw missingTables();
    throw new Error(error.message);
  }
  // step7 "revoke ระหว่างงาน": in-flight commands die with the device —
  // any later ack/result from this device is rejected by status check too.
  try {
    await db
      .from("device_commands")
      .update({ status: "revoked", finished_at: nowIso, error: "device revoked mid-flight", updated_at: nowIso })
      .eq("device_id", deviceId)
      .in("status", ["dispatched", "running"]);
  } catch (e) {
    if (!isMissingTable(e)) console.error("[devices] cancel commands on revoke failed:", e instanceof Error ? e.message : e);
  }
}
