/**
 * หน้าที่: สัญญาการต่อสายข้ามชิป — ตัดสินว่า "ต่อได้ไหม" จาก registry ที่ประกาศไว้
 * ไม่ใช่จากภาพบนจอ และไม่ใช่จากความใกล้กันของกล่อง
 *
 * ทำไมต้องมี: ก่อนหน้านี้การรู้ว่าอะไรต่อกับอะไรมาจาก edge ในกราฟซึ่งสกัดมาจาก
 * import ของโค้ด — ใช้บอกอดีตได้ แต่ใช้ "เสียบของใหม่เข้าไป" ไม่ได้ เพราะไม่มีที่
 * ไหนประกาศว่าขาไหนเปิดรับอะไร ไฟล์นี้คือประกาศนั้น
 *
 * source of truth คือ chip-external-interface.json — ฟังก์ชันที่นี่ไม่เดาอะไรเพิ่ม
 * ถ้า schema ของขาเป็น UNKNOWN การต่อจะถูกปฏิเสธ ไม่ใช่ปล่อยผ่าน
 *
 * ไม่มีฟังก์ชันไหนในไฟล์นี้แก้ topology, ย้าย port, หรือเขียนกลับเข้า physical lock
 *
 * Output: ConnectionRequest, ConnectionResult, connect, loadInterface, REJECT_REASON
 * Dependency ที่อนุญาต: node:fs, node:path (อ่าน registry เท่านั้น)
 */

import { readFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

export const INTERFACE_REGISTRY = join(__dirname, "..", "data", "chip-external-interface.json");
export const CONNECTION_LOG = join(__dirname, "..", "data", "chip-connections.jsonl");

export type PortDirection = "IN" | "OUT";
export type SignalType = "COMMAND" | "EVENT" | "RESULT" | "DATA" | "UNKNOWN";

export interface RegisteredPort {
  PORT_ID: string;
  CHIP_ID: string;
  DIRECTION: PortDirection;
  ROLE: string;
  SIGNAL_TYPE: SignalType;
  SIGNAL_CLASS: string;
  SCHEMA: { schema_id: string; [k: string]: unknown };
  OWNER_MODEL: string;
  SOURCE_LOCATION: string;
  VALIDATION: readonly string[];
  POLICY_BOUNDARY: string;
  TARGET_BINDING: string;
  IS_CHIP_BOUNDARY_PORT: boolean;
  EXTERNAL_BY_DECLARATION: boolean;
  RUNTIME_STATUS: "RUNTIME_PROVEN" | "STATIC_ONLY" | "UNKNOWN";
  INTERFACE_VERSION: string;
}

export interface ChipInterface {
  interface_version: string;
  CHIP_ID: string;
  EXTERNAL_INPUT_PORTS: readonly string[];
  EXTERNAL_OUTPUT_PORTS: readonly string[];
  PORTS: readonly RegisteredPort[];
}

export interface ConnectionRequest {
  source_chip_id: string;
  source_port_id: string;
  target_chip_id: string;
  target_port_id: string;
  signal_type: SignalType;
  schema_id: string;
  interface_version: string;
}

export interface PortBinding {
  chip_id: string;
  port_id: string;
  direction: PortDirection;
  schema_id: string;
  interface_version: string;
  runtime_status: string;
}

export interface ConnectionResult {
  connection_id: string;
  accepted: boolean;
  reason: string;
  source_binding: PortBinding | null;
  target_binding: PortBinding | null;
  checks: Record<string, boolean>;
}

export const REJECT_REASON = {
  SOURCE_PORT_NOT_FOUND: "SOURCE_PORT_NOT_FOUND",
  TARGET_PORT_NOT_FOUND: "TARGET_PORT_NOT_FOUND",
  SOURCE_NOT_EXTERNAL: "SOURCE_NOT_EXTERNAL",
  TARGET_NOT_EXTERNAL: "TARGET_NOT_EXTERNAL",
  DIRECTION_INCOMPATIBLE: "DIRECTION_INCOMPATIBLE",
  SCHEMA_INCOMPATIBLE: "SCHEMA_INCOMPATIBLE",
  SCHEMA_UNKNOWN: "SCHEMA_UNKNOWN",
  VERSION_INCOMPATIBLE: "VERSION_INCOMPATIBLE",
  SIGNAL_TYPE_MISMATCH: "SIGNAL_TYPE_MISMATCH",
  POLICY_DENIED: "POLICY_DENIED",
  SAME_CHIP: "SAME_CHIP",
} as const;

export function loadInterface(path: string = INTERFACE_REGISTRY): ChipInterface {
  return JSON.parse(readFileSync(path, "utf8")) as ChipInterface;
}

/** major ต้องตรงกัน — minor/patch ต่างได้ (semver ปกติ) */
function versionCompatible(a: string, b: string): boolean {
  return a.split(".")[0] === b.split(".")[0];
}

/**
 * ตัดสินการต่อสาย — ตรวจครบหกข้อ ไม่ผ่านข้อใดข้อหนึ่งคือปฏิเสธทั้งเส้น
 * ไม่มีการสร้าง "สายครึ่งเดียว"
 */
export function connect(
  req: ConnectionRequest,
  registries: readonly ChipInterface[],
): ConnectionResult {
  const all = registries.flatMap((r) => r.PORTS);
  const find = (chip: string, port: string) =>
    all.find((p) => p.CHIP_ID === chip && p.PORT_ID === port) ?? null;

  const src = find(req.source_chip_id, req.source_port_id);
  const tgt = find(req.target_chip_id, req.target_port_id);
  const checks: Record<string, boolean> = {
    PORT_EXISTS: !!src && !!tgt,
    PORT_IS_EXTERNAL: false,
    DIRECTION_COMPATIBLE: false,
    SCHEMA_COMPATIBLE: false,
    VERSION_COMPATIBLE: false,
    POLICY_ALLOWED: false,
  };
  const reject = (reason: string): ConnectionResult => ({
    connection_id: "", accepted: false, reason,
    source_binding: null, target_binding: null, checks,
  });

  if (!src) return reject(REJECT_REASON.SOURCE_PORT_NOT_FOUND);
  if (!tgt) return reject(REJECT_REASON.TARGET_PORT_NOT_FOUND);

  if (!src.EXTERNAL_BY_DECLARATION) return reject(REJECT_REASON.SOURCE_NOT_EXTERNAL);
  if (!tgt.EXTERNAL_BY_DECLARATION) return reject(REJECT_REASON.TARGET_NOT_EXTERNAL);
  checks.PORT_IS_EXTERNAL = true;

  // OUT ต่อได้เฉพาะ IN — และห้ามต่อภายในชิปเดียวกัน (นั่นคือ internal wiring ไม่ใช่ interface)
  if (src.CHIP_ID === tgt.CHIP_ID) return reject(REJECT_REASON.SAME_CHIP);
  if (src.DIRECTION !== "OUT" || tgt.DIRECTION !== "IN") return reject(REJECT_REASON.DIRECTION_INCOMPATIBLE);
  checks.DIRECTION_COMPATIBLE = true;

  // schema ที่ยัง UNKNOWN ต่อไม่ได้ — ปฏิเสธดีกว่าปล่อยผ่านแล้วค่อยพัง
  const su = String(src.SCHEMA?.schema_id ?? "UNKNOWN");
  const tu = String(tgt.SCHEMA?.schema_id ?? "UNKNOWN");
  if (su === "UNKNOWN" || tu === "UNKNOWN") return reject(REJECT_REASON.SCHEMA_UNKNOWN);
  if (req.schema_id !== su && req.schema_id !== tu) return reject(REJECT_REASON.SCHEMA_INCOMPATIBLE);
  if (su !== tu) return reject(REJECT_REASON.SCHEMA_INCOMPATIBLE);
  checks.SCHEMA_COMPATIBLE = true;

  if (!versionCompatible(src.INTERFACE_VERSION, tgt.INTERFACE_VERSION) ||
      !versionCompatible(req.interface_version, src.INTERFACE_VERSION)) {
    return reject(REJECT_REASON.VERSION_INCOMPATIBLE);
  }
  checks.VERSION_COMPATIBLE = true;

  if (src.SIGNAL_TYPE !== tgt.SIGNAL_TYPE || req.signal_type !== src.SIGNAL_TYPE) {
    return reject(REJECT_REASON.SIGNAL_TYPE_MISMATCH);
  }

  // policy: ปลายทางที่ประกาศ POLICY_BOUNDARY เป็น UNKNOWN ยังไม่รับการต่อ
  if (tgt.POLICY_BOUNDARY === "UNKNOWN") return reject(REJECT_REASON.POLICY_DENIED);
  checks.POLICY_ALLOWED = true;

  const binding = (p: RegisteredPort): PortBinding => ({
    chip_id: p.CHIP_ID, port_id: p.PORT_ID, direction: p.DIRECTION,
    schema_id: String(p.SCHEMA.schema_id), interface_version: p.INTERFACE_VERSION,
    runtime_status: p.RUNTIME_STATUS,
  });
  // id เกิดจากคู่ที่ต่อ — คำขอเดิมได้ id เดิมเสมอ
  const connection_id = `conn:${req.source_chip_id}${req.source_port_id}=>${req.target_chip_id}${req.target_port_id}`;
  return { connection_id, accepted: true, reason: "ACCEPTED",
           source_binding: binding(src), target_binding: binding(tgt), checks };
}

/** บันทึกสายที่ผ่านแล้ว — append-only ให้ตรวจย้อนได้ */
export function recordConnection(result: ConnectionResult, logPath: string = CONNECTION_LOG): void {
  if (!result.accepted) return;
  if (!existsSync(dirname(logPath))) mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, `${JSON.stringify({ ...result, recorded_at: new Date().toISOString() })}\n`);
}
