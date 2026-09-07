/**
 * หน้าที่: นโยบายการเปิดเผยเครื่องมือของ DNA OS MCP server — ใครเห็นได้ ใครเรียกได้
 *
 * Owner, 2026-09-05: เดิม server ประกาศเครื่องมือทั้งเจ็ดให้ client ใดก็ได้เห็น
 * และเรียกได้เท่ากันหมด รวมถึง `submit_command` (สั่งงานเข้าระบบจริง)
 * นั่นคือชั้นควบคุมของระบบถูกเปิดออกโดยไม่มีนโยบาย
 * Registration / consent-approve / secret-get / arbitrary shell are not
 * model-callable MCP tools.
 *
 * ค่าเริ่มต้นคือ INTERNAL_ONLY เสมอ เครื่องมือที่ไม่ได้ประกาศไว้ในตารางนี้จะ
 * มองไม่เห็นและเรียกไม่ได้จากภายนอก — เพิ่มเครื่องมือใหม่แล้วลืมจัดชั้นจึงเป็น
 * การปิด ไม่ใช่การเปิด
 *
 * แยกสองสิทธิ์ออกจากกันโดยเจตนา: DISCOVER (เห็นใน tools/list) กับ INVOKE
 * (เรียกได้จริง) เพราะการรู้ว่าเครื่องมืออะไรมีอยู่ก็เป็นข้อมูลที่ไม่ควรแจก
 *
 * Input: ชื่อเครื่องมือ + ตัวตนผู้เรียก
 * Output: ExportClass, canDiscover, canInvoke
 * Dependency ที่อนุญาต: ../../control/owner-authentication/contract.ts
 * สิ่งที่ห้ามแตะ:
 * - ห้ามตั้งค่าเริ่มต้นเป็น EXTERNAL_ALLOWED
 * - ห้ามให้ผู้เรียกประกาศชั้นของตัวเอง
 * - ห้ามให้ OWNER_ONLY ผ่านด้วยแค่ชื่อผู้เรียก ต้องมี session ที่ยืนยันตัวจริง
 */

import { validateOwnerSession } from "../../control/owner-authentication/contract";

export type ExportClass = "INTERNAL_ONLY" | "OWNER_ONLY" | "ORGANIZATION" | "EXTERNAL_ALLOWED";
export const DEFAULT_EXPORT_CLASS: ExportClass = "INTERNAL_ONLY";

export interface ToolPolicy {
  readonly tool_name: string;
  readonly read_write_class: "READ_ONLY" | "MUTATES_DNA_OS";
  readonly side_effect_class: "NONE" | "REGISTRY_WRITE" | "COMMAND_EXECUTION" | "WORK_STATE_WRITE";
  readonly authority_requirement: "NONE" | "VERIFIED_OWNER_SESSION";
  readonly export_class: ExportClass;
  readonly reason: string;
}

/**
 * เครื่องมือที่มีอยู่จริง จัดชั้นจากสิ่งที่มันทำ ไม่ใช่จากชื่อ
 * อ่านคำอธิบายจริงใน ./tool-registry.ts เมื่อ 2026-09-05
 */
export const TOOL_POLICIES: readonly ToolPolicy[] = [
  { tool_name: "submit_command", read_write_class: "MUTATES_DNA_OS", side_effect_class: "COMMAND_EXECUTION",
    authority_requirement: "VERIFIED_OWNER_SESSION", export_class: "OWNER_ONLY",
    reason: "ส่งคำสั่งเข้า submitOwnerCommand จริงแล้ว DNA OS จะ route และลงมือ — เป็นชั้นควบคุม ไม่ใช่การอ่าน" },
  { tool_name: "submit_work_result", read_write_class: "MUTATES_DNA_OS", side_effect_class: "WORK_STATE_WRITE",
    authority_requirement: "VERIFIED_OWNER_SESSION", export_class: "OWNER_ONLY",
    reason: "เปลี่ยนสถานะงานจริงและสร้าง Registration Candidate ต่อเนื่อง" },
  { tool_name: "list_capabilities", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "INTERNAL_ONLY",
    reason: "อ่าน projection ของ command-router capability registry — ไม่มี secret หรือ endpoint" },
  { tool_name: "lookup_capability", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "INTERNAL_ONLY",
    reason: "อ่านอย่างเดียว แต่เปิดเผยโครงสร้างภายในของระบบ จึงยังไม่เปิดออกนอก" },
  { tool_name: "get_resource", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "INTERNAL_ONLY",
    reason: "อ่านอย่างเดียว เปิดเผยที่ตั้ง source ของทรัพยากร" },
  { tool_name: "get_task", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "INTERNAL_ONLY",
    reason: "อ่านสถานะงาน ซึ่งอาจมีบริบทงานของเจ้าของ" },
  { tool_name: "get_system_status", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "INTERNAL_ONLY",
    reason: "อ่านสภาพระบบสด เปิดเผยว่าอะไรรันอยู่บ้าง" },
];

/**
 * ชั้นของผู้เรียก — สามระดับที่แยกกันชัดเจน
 *
 * INTERNAL_DNA_OS มาจากการถือกุญแจของช่องทางภายใน (possession-based)
 * มันไม่ใช่และไม่มีวันกลายเป็น OWNER_VERIFIED ซึ่งต้องผ่านการยืนยันตัวตนของมนุษย์
 */
export type CallerClass = "UNAUTHENTICATED" | "INTERNAL_DNA_OS" | "OWNER_VERIFIED";

export interface CallerContext {
  /** ตัวตนของผู้เรียก — ใช้บันทึก ไม่ใช่ใช้ตัดสินสิทธิ์ */
  readonly caller: string;
  readonly caller_class?: CallerClass;
  /** ต้องเป็น session ที่ผ่านการยืนยันตัวตนจริงของเจ้าของเท่านั้น */
  readonly owner_session_id?: string | null;
  readonly channel: "INTERNAL" | "EXTERNAL";
}

function classOf(ctx: CallerContext): CallerClass {
  return ctx.caller_class ?? (ctx.channel === "INTERNAL" ? "OWNER_VERIFIED" : "UNAUTHENTICATED");
}

export function policyFor(toolName: string): ToolPolicy {
  return TOOL_POLICIES.find((p) => p.tool_name === toolName)
    ?? { tool_name: toolName, read_write_class: "MUTATES_DNA_OS", side_effect_class: "COMMAND_EXECUTION",
         authority_requirement: "VERIFIED_OWNER_SESSION", export_class: DEFAULT_EXPORT_CLASS,
         reason: "ไม่ได้ประกาศไว้ในนโยบาย — ถือเป็นชั้นปิดที่สุดโดยปริยาย" };
}

function hasVerifiedOwner(ctx: CallerContext): boolean {
  if (typeof ctx.owner_session_id !== "string" || ctx.owner_session_id === "") return false;
  const v = validateOwnerSession(ctx.owner_session_id) as { ok: boolean };
  return v.ok === true;
}

/** เห็นใน tools/list ได้ไหม — คนละสิทธิ์กับการเรียก */
export function canDiscover(toolName: string, ctx: CallerContext): { allowed: boolean; reason: string } {
  const p = policyFor(toolName);
  const klass = classOf(ctx);
  /**
   * ตัวตนของเครื่องเห็นได้เฉพาะเครื่องมืออ่าน — เครื่องมือที่เปลี่ยนสถานะระบบ
   * ยังต้องเป็นเจ้าของที่ยืนยันตัวตนแล้วเท่านั้น กุญแจของช่องทางไม่ใช่สิทธิ์ของคน
   */
  if (klass === "INTERNAL_DNA_OS") {
    return p.export_class === "INTERNAL_ONLY"
      ? { allowed: true, reason: "ตัวตนภายในของ DNA OS — เห็นได้เฉพาะเครื่องมืออ่าน" }
      : { allowed: false, reason: `${p.export_class} — ตัวตนของเครื่องไม่ใช่สิทธิ์ของเจ้าของ` };
  }
  if (klass === "OWNER_VERIFIED" && hasVerifiedOwner(ctx)) return { allowed: true, reason: "เจ้าของยืนยันตัวตนแล้ว" };
  if (ctx.channel === "INTERNAL" && hasVerifiedOwner(ctx)) return { allowed: true, reason: "ช่องทางภายในที่ยืนยันแล้ว" };
  if (p.export_class === "EXTERNAL_ALLOWED") return { allowed: true, reason: "ประกาศให้ภายนอกใช้ได้" };
  if (p.export_class === "OWNER_ONLY" && hasVerifiedOwner(ctx)) return { allowed: true, reason: "เจ้าของยืนยันตัวตนแล้ว" };
  return { allowed: false, reason: `${p.export_class} — ผู้เรียกภายนอกไม่มีสิทธิ์เห็นเครื่องมือนี้` };
}

/** เรียกได้ไหม — ตรวจก่อนถึง handler เสมอ */
export function canInvoke(toolName: string, ctx: CallerContext): { allowed: boolean; reason_code: string; reason: string } {
  const p = policyFor(toolName);
  if (p.authority_requirement === "VERIFIED_OWNER_SESSION" && !hasVerifiedOwner(ctx)) {
    return { allowed: false, reason_code: "VERIFIED_OWNER_SESSION_REQUIRED",
      reason: `"${toolName}" เป็น ${p.export_class} (${p.side_effect_class}) — ต้องมี session ที่เจ้าของยืนยันตัวตนแล้ว` };
  }
  if (p.export_class === "INTERNAL_ONLY" && classOf(ctx) === "UNAUTHENTICATED") {
    return { allowed: false, reason_code: "INTERNAL_ONLY", reason: `"${toolName}" เปิดเฉพาะภายใน` };
  }
  return { allowed: true, reason_code: "ALLOWED", reason: p.reason };
}

/** รายการที่ผู้เรียกนี้ควรเห็น — ใช้กรอง tools/list */
export function discoverableTools(toolNames: readonly string[], ctx: CallerContext): readonly string[] {
  return toolNames.filter((n) => canDiscover(n, ctx).allowed);
}
