/**
 * Connector Loader — Dynamic Registry (Core reads live from Database)
 *
 * ต่างจาก registry/*.json (static, ต้อง deploy ใหม่ทุกครั้งที่แก้)
 * ตารางนี้คือ Dynamic Registry: เพิ่ม/แก้/ลบ Connector จากหน้า Connectors
 * แล้วใช้งานได้ทันที ไม่ต้อง deploy ใหม่ — registry/*.json ใช้เฉพาะ
 * bootstrap ค่าเริ่มต้นของระบบเท่านั้น
 *
 * มาตรฐาน Connector Lifecycle (ดู registry/connector-lifecycle.json — ห้ามมีข้อยกเว้น):
 *   Connect → Register → Test → Enable → Run
 *
 * ทุก AI / API / MCP / Webhook / Plugin / Service ที่ต้องการ "Run" (เรียกใช้ Connector
 * จริงเพื่อทำงาน) ต้องเรียกผ่าน requireConnector() เท่านั้น ห้ามเรียก getConnector()/
 * loadConnectors() ตรงแล้วเอาผลลัพธ์ไปใช้งานเองโดยไม่เช็ค status/enabled — นั่นคือ
 * การข้ามขั้นตอนซึ่งเป็นสิ่งต้องห้าม getConnectedConnector() มีไว้สำหรับเช็คสถานะ
 * แบบ soft (เช่น แสดงผล UI) เท่านั้น ไม่ใช่จุดที่อนุญาตให้ "Run" จริง
 *
 * ห้าม import @supabase/supabase-js ตรงเพื่ออ่าน connectors table เอง
 */

import { supabaseAdmin } from "@/services/supabase/queries";

export type ConnectorAuthType = "login" | "oauth" | "api_key" | "token" | "uri" | "mcp" | "webhook";
export type ConnectorStatus = "disconnected" | "connecting" | "connected" | "error";

export interface ConnectorRecord {
  id: string;
  name: string;
  slug: string;
  auth_type: ConnectorAuthType;
  status: ConnectorStatus;
  /** ขั้นที่ 4 ของ lifecycle: Connect → Register → Test → Enable — ต้องกดเปิดเองเสมอ ไม่มีการ auto-enable */
  enabled: boolean;
  config: Record<string, unknown>;
  secret: Record<string, unknown>;
  last_checked_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

let _cache: ConnectorRecord[] | null = null;
let _cacheExpiry = 0;
const CACHE_TTL = 60_000;

export function clearConnectorCache(): void {
  _cache = null;
  _cacheExpiry = 0;
}

export async function loadConnectors(): Promise<ConnectorRecord[]> {
  if (_cache && Date.now() < _cacheExpiry) return _cache;

  const { data, error } = await supabaseAdmin()
    .from("connectors")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) throw new Error(`connector-loader: ${error.message}`);

  _cache = (data ?? []) as ConnectorRecord[];
  _cacheExpiry = Date.now() + CACHE_TTL;
  return _cache;
}

export async function getConnector(slug: string): Promise<ConnectorRecord | null> {
  const all = await loadConnectors();
  return all.find((c) => c.slug === slug) ?? null;
}

/**
 * ใช้จาก Engine/Gateway ที่ต้องการเรียกบริการภายนอกจริง —
 * คืนค่าเฉพาะ Connector ที่ผ่านครบ 4 ขั้น: Connect → Register → Test → Enable
 * status = "connected" (Test ผ่าน) อย่างเดียวไม่พอ — ต้อง enabled = true ด้วย
 * (คนต้องกดเปิดเองเสมอ ไม่มี auto-enable แม้ test จะผ่านแล้วก็ตาม)
 */
export async function getConnectedConnector(slug: string): Promise<ConnectorRecord | null> {
  const c = await getConnector(slug);
  return c && c.status === "connected" && c.enabled ? c : null;
}

export async function listConnectorsByAuthType(authType: ConnectorAuthType): Promise<ConnectorRecord[]> {
  const all = await loadConnectors();
  return all.filter((c) => c.auth_type === authType);
}

// ── Lifecycle Audit Log — บันทึกลง audit_logs จริง (ไม่ใช่ in-memory) ──────────

export type ConnectorLifecycleAction =
  | "register" | "test_passed" | "test_failed" | "enabled" | "disabled" | "run" | "run_rejected";

export async function logConnectorLifecycleEvent(
  connectorId: string,
  action: ConnectorLifecycleAction,
  detail: { oldValue?: string | null; newValue?: string | null; note?: string } = {}
): Promise<void> {
  const { error } = await supabaseAdmin().from("audit_logs").insert({
    entity_type: "connector",
    entity_id: connectorId,
    action,
    field: detail.note ?? null,
    old_value: detail.oldValue ?? null,
    new_value: detail.newValue ?? null,
  });
  // การ log ล้มเหลวต้องไม่ทำให้ระบบหลักพัง — แค่แจ้งเตือนใน console
  if (error) console.error(`[connector-lifecycle] audit log failed for ${connectorId}/${action}:`, error.message);
}

// ── Run Gate — ทางเดียวที่อนุญาตให้ "Run" Connector จริง ──────────────────────

export class ConnectorRejectedError extends Error {
  constructor(public readonly slug: string, public readonly reason: string) {
    super(`Connector "${slug}" ถูกปฏิเสธ: ${reason}`);
    this.name = "ConnectorRejectedError";
  }
}

/**
 * ขั้นที่ 5 (สุดท้าย) ของ lifecycle: Run
 *
 * ปฏิเสธทันที (throw ConnectorRejectedError) ถ้า:
 *   - ไม่พบ Connector นี้ (ยังไม่ผ่าน Register)
 *   - status ไม่ใช่ "connected" (ยังไม่ผ่าน Test หรือ Test ล้มเหลว)
 *   - enabled ไม่เป็น true (ยังไม่ผ่าน Enable)
 * ไม่มีข้อยกเว้นสำหรับ Connector ใดหรือผู้เรียกประเภทไหนทั้งสิ้น
 *
 * @param caller ชื่อผู้เรียก (เช่น "cognitive.pipeline", "engines.tax", "plugin.line")
 *               ใช้เพื่อ trace ใน audit log เท่านั้น ไม่มีผลต่อการตัดสินใจอนุญาต/ปฏิเสธ
 */
export async function requireConnector(slug: string, caller: string): Promise<ConnectorRecord> {
  const c = await getConnector(slug);

  if (!c) {
    throw new ConnectorRejectedError(slug, "ไม่พบ Connector นี้ในระบบ — ต้อง Register ก่อน (สร้างจากหน้า /admin/connectors)");
  }
  if (c.status !== "connected") {
    await logConnectorLifecycleEvent(c.id, "run_rejected", { note: `caller=${caller}`, newValue: `status=${c.status}` });
    throw new ConnectorRejectedError(slug, `ยังไม่ผ่าน Test (status ปัจจุบัน: ${c.status})`);
  }
  if (!c.enabled) {
    await logConnectorLifecycleEvent(c.id, "run_rejected", { note: `caller=${caller}`, newValue: "enabled=false" });
    throw new ConnectorRejectedError(slug, "ยังไม่ได้ Enable — ต้องกด Enable จากหน้า /admin/connectors ก่อน");
  }

  await logConnectorLifecycleEvent(c.id, "run", { note: `caller=${caller}` });
  return c;
}
