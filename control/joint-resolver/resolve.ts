/**
 * หน้าที่: ตัดสินว่า "ความสามารถที่งานต้องการ" กับ "ของที่มีอยู่จริง" ต่อกันได้
 * แบบไหน — ต่อตรง ประกอบ ต้องเขียนตัวแปลง ติดสิทธิ์ สัญญาไม่ตรง หรือไม่มีเลย
 *
 * Owner, 2026-09-05: ห้าม BUILD-FIRST ลำดับบังคับคือ DISCOVER -> DESCRIBE ->
 * MATCH -> REUSE -> COMPOSE -> ADAPT -> BUILD LAST ไฟล์นี้คือขั้น MATCH ซึ่ง
 * เป็นด่านที่ตอบว่า "ต้องเขียนโค้ดไหม" ก่อนใครจะเริ่มเขียน
 *
 * DIRECT_MATCH แปลว่า code generation = 0 — ถ้าตัวนี้ตอบ DIRECT_MATCH แล้วยัง
 * มีคนเขียนโค้ดใหม่ แปลว่าข้ามด่านนี้ไป
 *
 * ตัวตัดสินไม่เรียกโมเดลและไม่อ่านข้อความของ Agent อ่านแต่ทะเบียนกลางกับ
 * ทะเบียนสิทธิ์ ซึ่งเป็นข้อเท็จจริงที่ตรวจย้อนได้
 *
 * Input: ชื่อความสามารถที่ต้องการ (canonical) + composition ที่ประกาศไว้
 * Output: JointResolution
 * Dependency ที่อนุญาต: ../resource-selection/contract.ts, credentials/registry/
 * สิ่งที่ห้ามแตะ:
 * - ห้ามตอบ DIRECT_MATCH เมื่อสิทธิ์ยังไม่พร้อม — นั่นคือ AUTH_REQUIRED
 * - ห้ามเดาว่าความสามารถที่ไม่พบ "น่าจะใช้ตัวใกล้เคียงแทนได้"
 * - ห้ามให้ผู้เรียกส่งรายชื่อ resource เข้ามาเอง
 */

import { selectResourcesFor } from "../resource-selection/contract";
import { findApiCredential } from "../../credentials/registry/api-credential-registry";

export type JointVerdict =
  | "DIRECT_MATCH" | "COMPOSITION_MATCH" | "ADAPTER_REQUIRED"
  | "AUTH_REQUIRED" | "CONTRACT_MISMATCH"
  /** ทรัพยากรที่เชื่อมอยู่มีความสามารถนี้จริง แต่ยังไม่ถูกแตกลงทะเบียน — ไม่ใช่ของที่ขาด */
  | "REGISTRY_INCOMPLETE"
  /** พบว่ามีในเอกสาร/ทรัพยากร แต่ยังไม่เคยพิสูจน์ว่าเรียกได้จริง */
  | "RESOURCE_UNPROVEN"
  /** ไม่มีทั้งในทะเบียน ในทรัพยากรที่เชื่อมอยู่ และในของเดิม — ตัวเดียวที่เขียนใหม่ได้ */
  | "TRUE_MISSING";

export interface JointResolution {
  readonly required_capability: string;
  readonly verdict: JointVerdict;
  readonly resource_id: string | null;
  readonly resource_name: string | null;
  readonly entrypoint: string | null;
  readonly credential_ref: string | null;
  readonly credential_status: string | null;
  /** ความสามารถย่อยที่ต้องใช้เมื่อ verdict = COMPOSITION_MATCH */
  readonly composed_of: readonly string[];
  readonly code_generation_required: boolean;
  readonly reason: string;
}

/**
 * composition ที่ระบบประกาศไว้ — เป็นกราฟของสัญญา ไม่ใช่แอปใหม่ต่อหนึ่ง workflow
 * ความสามารถรวมหนึ่งตัวประกอบจากความสามารถย่อยที่ต้องมีอยู่จริงทั้งหมด
 */
export const COMPOSITIONS: Readonly<Record<string, readonly string[]>> = {
  "briefing.daily_business": ["calendar.list_events", "email.list_labels"],
};

/** ใบอนุญาตที่ทรัพยากรนี้ต้องใช้ — อนุมานจาก provider ในชื่อความสามารถ ไม่ใช่จากชื่อสินค้า */
function credentialRefFor(capability: string, owner: string): string | null {
  const provider = capability.startsWith("email.") || capability.startsWith("calendar.") ? "google" : null;
  return provider === null ? null : `credential://${provider}/${owner}/readonly`;
}

/**
 * ทรัพยากรที่ "เชื่อมอยู่จริง" กับเครื่องมือที่มันประกาศ — อ่านจากแถวทรัพยากรใน
 * ทะเบียนที่บันทึกความสามารถของ connector ไว้ตอน census ไม่ใช่จากเอกสาร
 *
 * ตารางนี้เก็บเฉพาะสิ่งที่ census พิสูจน์ว่า connector ประกาศไว้จริง
 * (claude mcp list = Connected + tool schema ของมันเอง)
 */
const CONNECTED_TOOLS: Readonly<Record<string, { resource: string; tool: string; entrypoint: string }>> = {
  "slack.channel_read": { resource: "anthropic-connector-slack", tool: "slack_read_channel", entrypoint: "https://mcp.slack.com/mcp" },
  "slack.message_send": { resource: "anthropic-connector-slack", tool: "slack_send_message", entrypoint: "https://mcp.slack.com/mcp" },
  "drive.file_search": { resource: "anthropic-connector-google-drive", tool: "search_files", entrypoint: "https://drivemcp.googleapis.com/mcp/v1" },
  "drive.file_read": { resource: "anthropic-connector-google-drive", tool: "read_file_content", entrypoint: "https://drivemcp.googleapis.com/mcp/v1" },
  "design.export_design": { resource: "anthropic-connector-canva", tool: "export-design", entrypoint: "https://mcp.canva.com/mcp" },
  "pdf.read_pdf_bytes": { resource: "anthropic-connector-pdf-viewer", tool: "read_pdf_bytes", entrypoint: "https://example-server.modelcontextprotocol.io/pdf/mcp" },
};
function connectedResourceFor(capability: string): { resource: string; tool: string; entrypoint: string } | null {
  return CONNECTED_TOOLS[capability] ?? null;
}

export function resolveJoint(requiredCapability: string, owner = "t23598788@gmail.com"): JointResolution {
  const base = { required_capability: requiredCapability, resource_id: null as string | null,
    resource_name: null as string | null, entrypoint: null as string | null,
    credential_ref: null as string | null, credential_status: null as string | null,
    composed_of: [] as string[] };

  // [1] มีทรัพยากรที่ประกาศความสามารถนี้ตรง ๆ ไหม
  const direct = selectResourcesFor([requiredCapability]);
  const hit = direct.selected[0] ?? null;

  if (hit === null) {
    // [2] ประกอบจากของที่มีได้ไหม — ทุกชิ้นย่อยต้องมีจริง ไม่ใช่บางชิ้น
    const parts = COMPOSITIONS[requiredCapability];
    if (parts !== undefined) {
      const sub = selectResourcesFor(parts);
      if (sub.missing.length === 0) {
        return { ...base, verdict: "COMPOSITION_MATCH", composed_of: [...parts], code_generation_required: false,
          reason: `ประกอบได้จาก ${parts.length} ความสามารถที่ลงทะเบียนแล้วทั้งหมด — ไม่ต้องเขียนโค้ดใหม่` };
      }
      return { ...base, verdict: "ADAPTER_REQUIRED", composed_of: [...parts], code_generation_required: true,
        reason: `เป็น composition แต่ยังขาดชิ้นย่อย: ${sub.missing.join(", ")}` };
    }
    /**
     * MISSING ไม่เท่ากับ BUILD (Owner, 2026-09-05 ข้อ 7)
     *
     * ก่อนหน้านี้ทุกอย่างที่ไม่อยู่ในทะเบียนถูกตอบว่าต้องเขียนใหม่ ซึ่งผิด:
     * Slack เชื่อมอยู่จริงและมีเครื่องมืออ่านห้องอยู่แล้ว แต่ยังไม่ถูกแตกลง
     * canonical registry การตอบว่า "ไม่มี" จึงชวนให้ไปเขียน Slack client ซ้ำ
     *
     * ที่นี่จึงถามต่ออีกชั้น: ทรัพยากรที่ "เชื่อมอยู่แล้ว" ประกาศความสามารถนี้ไหม
     * ถ้ามี = ช่องว่างของทะเบียน ไม่ใช่ช่องว่างของความสามารถ -> ห้ามเขียนโค้ด
     */
    const connected = connectedResourceFor(requiredCapability);
    if (connected !== null) {
      return { ...base, resource_name: connected.resource, entrypoint: connected.entrypoint,
        verdict: "REGISTRY_INCOMPLETE", code_generation_required: false,
        reason: `ทรัพยากร "${connected.resource}" เชื่อมอยู่แล้วและประกาศเครื่องมือ "${connected.tool}" ซึ่งครอบความสามารถนี้ — ขาดแค่การแตกลงทะเบียน ไม่ใช่ขาดความสามารถ` };
    }
    return { ...base, verdict: "TRUE_MISSING", code_generation_required: true,
      reason: "ไม่พบทั้งในทะเบียน ในทรัพยากรที่เชื่อมอยู่ และไม่มี composition ที่ประกาศไว้" };
  }

  // [3] มีของ แต่สิทธิ์พร้อมหรือยัง — ยังไม่พร้อมคือ AUTH_REQUIRED ไม่ใช่ DIRECT_MATCH
  const ref = credentialRefFor(requiredCapability, owner);
  const found = ref === null ? null : (findApiCredential as (r: string) => { status?: string } | null)(ref);
  const status = found?.status ?? null;
  const withResource = { ...base, resource_id: hit.resource_id, resource_name: hit.resource_name,
    entrypoint: hit.entrypoint, credential_ref: ref, credential_status: status };

  if (ref !== null && status !== "ACTIVE") {
    return { ...withResource, verdict: "AUTH_REQUIRED", code_generation_required: false,
      reason: status === null
        ? `ทรัพยากรพร้อม แต่ DNA OS ยังไม่มีสิทธิ์ของตัวเอง (${ref})`
        : `ใบอนุญาตอยู่ในสถานะ ${status} ไม่ใช่ ACTIVE` };
  }
  return { ...withResource, verdict: "DIRECT_MATCH", code_generation_required: false,
    reason: `ทะเบียนประกาศความสามารถนี้ที่ ${hit.resource_name} และสิทธิ์พร้อม — ต่อตรงได้ ไม่ต้องเขียนโค้ด` };
}

export function resolveJoints(required: readonly string[], owner?: string): readonly JointResolution[] {
  return required.map((c) => resolveJoint(c, owner));
}
