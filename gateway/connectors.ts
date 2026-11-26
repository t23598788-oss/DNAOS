/**
 * Connectors Gateway — ประตูเดียวสำหรับเขียนตาราง connectors
 *
 * ทุก write operation (create/update/delete/บันทึกผล test) ต้องผ่านที่นี่เท่านั้น
 * หน้า Connectors (UI) และ API routes เรียกผ่านนี้ ไม่คุย @supabase/supabase-js ตรง
 */

import { randomBytes, randomUUID } from "crypto";
import { supabaseAdmin } from "@/services/supabase/queries";
import { clearConnectorCache, logConnectorLifecycleEvent, type ConnectorAuthType, type ConnectorRecord } from "@/core/connector-loader";
import { normalizeSignatureHeader, requireSignatureHeader } from "@/core/webhook-signature";
import { testConnector } from "@/engines/connectors/tester";

export interface CreateConnectorInput {
  name: string;
  auth_type: ConnectorAuthType;
  /**
   * The provider this connector belongs to, declared at Connect time (Connect
   * Core, 2026-09-20). Optional so every existing caller keeps working; when
   * present it is stored as config.provider and becomes the connector's real
   * identity instead of a display-name/slug guess.
   */
  provider?: string;
  /**
   * ชื่อ header ที่ผู้ส่งแนบลายเซ็น (webhook เท่านั้น). บังคับสำหรับ auth_type =
   * "webhook" — connector ที่ไม่มีค่านี้จะตรวจลายเซ็นไม่ได้เลย (owner audit
   * 2026-10-26, C3: ของเดิมไม่เคยเขียนค่านี้ ทำให้ทุก connector เกิดมา fail-open).
   * รับได้ทั้งทาง input.signature_header และ input.config.signature_header.
   */
  signature_header?: string;
  /** dot-path ของ event id ใน payload ใช้ทำ idempotency key เช่น "event.id" */
  event_id_path?: string;
  config?: Record<string, unknown>;
  secret?: Record<string, unknown>;
}

/**
 * ปกปิดค่า secret ก่อนส่งออกจาก API — เก็บไว้แค่ชื่อ field ให้ UI รู้ว่ามีค่าอยู่
 * ใช้กับทุก response ที่ออกไปหา browser ยกเว้นตอน create ครั้งแรก (ให้ copy ค่าที่ auto-gen ได้ครั้งเดียว)
 */
export function redactConnector<T extends ConnectorRecord>(c: T): T {
  const redactedSecret: Record<string, boolean> = {};
  for (const key of Object.keys(c.secret ?? {})) redactedSecret[key] = true;
  return { ...c, secret: redactedSecret as any };
}

export function redactConnectors<T extends ConnectorRecord>(list: T[]): T[] {
  return list.map(redactConnector);
}

function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9ก-๙]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "connector"}-${randomUUID().slice(0, 6)}`;
}

export async function listConnectors(): Promise<ConnectorRecord[]> {
  const { data, error } = await supabaseAdmin()
    .from("connectors")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ConnectorRecord[];
}

export async function getConnectorById(id: string): Promise<ConnectorRecord | null> {
  const { data, error } = await supabaseAdmin()
    .from("connectors")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return null;
  return data as ConnectorRecord;
}

/**
 * Find the single Connector that DECLARES this provider (config.provider — the
 * declared Connect Core provider identity, 2026-09-20). Read-only lookup for
 * the Provider Credentials routes so Guard A of the Connector Lifecycle Law
 * holds: those routes never touch the connectors table themselves — every
 * read/write goes through this module.
 */
export async function findConnectorIdByProvider(providerId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from("connectors")
    .select("id")
    .filter("config->>provider", "eq", providerId)
    .limit(1);
  if (error) return null;
  return (data?.[0] as { id: string } | undefined)?.id ?? null;
}

export async function createConnector(input: CreateConnectorInput): Promise<ConnectorRecord> {
  const slug = slugify(input.name);
  const config: Record<string, unknown> = { ...(input.config ?? {}) };
  const secret: Record<string, unknown> = { ...(input.secret ?? {}) };

  // Declared provider identity (Connect Core, 2026-09-20) — stored with the
  // record so every later reader resolves the provider from a declared value
  // instead of guessing it from a display name or a slug.
  if (input.provider) config.provider = input.provider.trim().toLowerCase();

  if (input.auth_type === "webhook") {
    // Fail closed at the source: a webhook connector that cannot verify a
    // signature must not be creatable (throws SIGNATURE_HEADER_REQUIRED).
    config.signature_header = requireSignatureHeader(input.signature_header ?? input.config?.signature_header);
    if (input.event_id_path) config.event_id_path = String(input.event_id_path);
    config.receiving_path = `/api/connectors/webhook/${slug}`;
    secret.signing_secret = randomBytes(24).toString("hex");
  }
  if (input.auth_type === "oauth") {
    config.redirect_uri = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/connectors/oauth/callback/${slug}`;
  }

  const { data, error } = await supabaseAdmin()
    .from("connectors")
    .insert({
      name: input.name,
      slug,
      auth_type: input.auth_type,
      status: "disconnected",
      config,
      secret,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  clearConnectorCache();

  const created = data as ConnectorRecord;
  // ขั้นที่ 2: Register — เกิดขึ้นอัตโนมัติทันทีที่ insert สำเร็จ (Dynamic Registry)
  await logConnectorLifecycleEvent(supabaseAdmin(), created.id, "register", { newValue: created.auth_type });

  // Webhook ไม่มี handshake ขาออก — พร้อมรับ event ทันทีที่สร้าง
  if (created.auth_type === "webhook") {
    return recordConnectorTest(created.id, { ok: true });
  }
  return created;
}

export async function updateConnector(
  id: string,
  patch: { name?: string; config?: Record<string, unknown>; secret?: Record<string, unknown> }
): Promise<ConnectorRecord> {
  const existing = await getConnectorById(id);
  if (!existing) throw new Error("ไม่พบ Connector นี้");

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name) updates.name = patch.name;
  if (patch.config) updates.config = { ...existing.config, ...patch.config };
  if (patch.secret) updates.secret = { ...existing.secret, ...patch.secret };

  const { data, error } = await supabaseAdmin()
    .from("connectors")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  clearConnectorCache();
  return data as ConnectorRecord;
}

export async function deleteConnector(id: string): Promise<void> {
  const { error } = await supabaseAdmin().from("connectors").delete().eq("id", id);
  if (error) throw new Error(error.message);
  clearConnectorCache();
}

/**
 * ขั้นที่ 4: Enable — ต้องกดเองเสมอ ไม่มี auto-enable แม้ status จะ "connected" แล้ว
 * ห้าม enable connector ที่ยังไม่ผ่าน Test (status ต้อง "connected" เท่านั้น)
 */
export async function setConnectorEnabled(id: string, enabled: boolean): Promise<ConnectorRecord> {
  const existing = await getConnectorById(id);
  if (!existing) throw new Error("ไม่พบ Connector นี้");
  if (enabled && existing.status !== "connected") {
    throw new Error("เปิดใช้งานไม่ได้ — Connector นี้ยังไม่ผ่าน Test (ต้องกด \"ทดสอบใหม่\" ให้ผ่านก่อน)");
  }

  const { data, error } = await supabaseAdmin()
    .from("connectors")
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  clearConnectorCache();
  await logConnectorLifecycleEvent(supabaseAdmin(), id, enabled ? "enabled" : "disabled", {
    oldValue: String(existing.enabled),
    newValue: String(enabled),
  });
  return data as ConnectorRecord;
}

// ── จุดเขียนสถานะหลังทดสอบ (ตัวส่ง → ลงดิน/G) ───────────────────
// @io in  tester.probe              meter=verify_calls
// @io out ext.supabase.connectors   meter=db_writes
// @io out ext.supabase.audit_logs   meter=db_writes
export async function recordConnectorTest(
  id: string,
  result: { ok: boolean; error?: string }
): Promise<ConnectorRecord> {
  const before = await getConnectorById(id);

  const updates: Record<string, unknown> = {
    status: result.ok ? "connected" : "error",
    last_checked_at: new Date().toISOString(),
    last_error: result.ok ? null : result.error ?? "unknown error",
    updated_at: new Date().toISOString(),
  };
  // Test ล้มเหลว = ปิด Enable อัตโนมัติ — connector ที่พังห้ามยังถูก Core เรียกใช้อยู่เงียบๆ
  // ต้องแก้ปัญหาแล้วกลับมากด Enable ใหม่เองเสมอ
  if (!result.ok) updates.enabled = false;

  const { data, error } = await supabaseAdmin()
    .from("connectors")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  clearConnectorCache();

  // ถ้า Test ไม่ผ่าน: Error → Auto Disable (ทำไปแล้วข้างบน) → แจ้งสถานะ → บันทึก Log
  // "แจ้งสถานะ" = status/last_error พร้อม query ได้ทันทีจาก GET /api/admin/connectors (ด้านล่าง)
  // "บันทึก Log" = audit_logs แถวนี้
  if (!result.ok) {
    await logConnectorLifecycleEvent(supabaseAdmin(), id, "test_failed", {
      oldValue: before?.status ?? null,
      newValue: `error: ${result.error ?? "unknown"}`,
    });
  } else {
    await logConnectorLifecycleEvent(supabaseAdmin(), id, "test_passed", {
      oldValue: before?.status ?? null,
      newValue: "connected",
    });
  }

  return data as ConnectorRecord;
}

// ── จุดส่งออกจริง (ตัวส่ง): ส่งต่อให้ tester แล้วเก็บผล ────────────
// @io in  tester.l2                 meter=verify_calls
// @io out tester.probe              meter=verify_calls
export async function runConnectorTest(id: string): Promise<ConnectorRecord> {
  const connector = await getConnectorById(id);
  if (!connector) throw new Error("ไม่พบ Connector นี้");

  await supabaseAdmin().from("connectors").update({ status: "connecting" }).eq("id", id);
  clearConnectorCache();

  const result = await testConnector(connector.auth_type, connector.config, connector.secret);
  return recordConnectorTest(id, result);
}

export async function recordWebhookEvent(
  connectorId: string,
  headers: Record<string, unknown>,
  payload: unknown,
  verified: boolean,
  /**
   * Idempotency key ของ event นี้ (จาก webhookGate.deriveEventKey) — unique ตาม
   * (connector_id, event_key). ของเดิม insert เปล่า ทำให้ webhook ที่ถูกส่งซ้ำ
   * บันทึกซ้ำได้ไม่จำกัด (owner audit 2026-10-26, C5).
   */
  eventKey: string
): Promise<void> {
  // ignoreDuplicates: การส่งซ้ำต้องไม่เป็น error และต้องไม่สร้างแถวใหม่
  const { error } = await supabaseAdmin().from("connector_webhook_events").upsert(
    {
      connector_id: connectorId,
      headers,
      payload: payload ?? {},
      verified,
      event_key: eventKey,
    },
    { onConflict: "connector_id,event_key", ignoreDuplicates: true }
  );
  if (error) throw new Error(error.message);

  await supabaseAdmin()
    .from("connectors")
    .update({ status: "connected", last_checked_at: new Date().toISOString(), last_error: null })
    .eq("id", connectorId);
  clearConnectorCache();
}
