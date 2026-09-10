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
 * Dependency ที่อนุญาต: ../../control/owner-authentication/contract.ts,
 * ../../control/mcp-code-knowledge/contract.ts (least-privilege coding-tool filter)
 * สิ่งที่ห้ามแตะ:
 * - ห้ามตั้งค่าเริ่มต้นเป็น EXTERNAL_ALLOWED
 * - ห้ามให้ผู้เรียกประกาศชั้นของตัวเอง
 * - ห้ามให้ OWNER_ONLY ผ่านด้วยแค่ชื่อผู้เรียก ต้องมี session ที่ยืนยันตัวจริง
 */

import { validateOwnerSession } from "../../control/owner-authentication/contract";
import { CANONICAL_PROMOTION_TOOLS, filterMcpTools, SOURCE_MUTATION_TOOLS } from "../../control/mcp-code-knowledge/contract";
import { grantedToolsForAiClient, isRawRailwayMcpTool } from "../../control/owner-client-runtime/ai-queen-grants";
import { mcpMutationRequiresTaskScope } from "../../control/agent-physical-scope/contract";
import { liveRegistryFromExistingStores } from "../../control/agent-physical-scope/live-registry";
import { resolveCanonicalTaskScope } from "../../control/agent-physical-scope/task-scope";

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
  { tool_name: "dna_os.get_runtime_identity", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่านตัวตนรันไทม์ของ DNA OS — ไม่มี secret" },
  { tool_name: "dna_os.get_system_health", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่านสุขภาพระบบจาก registry/runtime ของ DNA OS" },
  { tool_name: "dna_os.get_latest_work", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่านงานล่าสุดจาก lifecycle ที่ DNA OS บันทึกไว้" },
  { tool_name: "dna_os.get_current_work_context", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่านบริบทงานวิศวกรรมจาก journal/git/runtime ไม่ใช่จาก memory ของ AI" },
  { tool_name: "dna_os.resolve_current_source", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่าน checkout ปัจจุบันจาก Git + repository-registry ไม่ใช่จาก snapshot ที่เดา" },
  { tool_name: "dna_os.lookup_code_references", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่าน path อ้างอิงจาก capability registry / work journal ไม่ใช่การฝังทั้ง repo" },
  { tool_name: "dna_os.get_work_status", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่านสถานะงานจากหลักฐานของ DNA OS ไม่ใช่จาก GitHub โดยตรง" },
  { tool_name: "dna_os.get_work_evidence", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่านหลักฐานงานที่ DNA OS persist ไว้ หลังกรอง secret" },
  { tool_name: "dna_os.get_capability_status", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่านสถานะความสามารถจาก registry ที่มีอยู่" },
  { tool_name: "dna_os.list_local_resources", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "ค้นพบทรัพยากรท้องถิ่นที่ Owner grant แล้วเท่านั้น — ไม่มี grant แล้วรายการว่าง" },
  { tool_name: "dna_os.get_local_resource", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่านทรัพยากรท้องถิ่นที่ session ได้รับอนุญาต" },
  { tool_name: "dna_os.get_local_capabilities", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่านแคตตาล็อกความสามารถท้องถิ่น ไม่ใช่การลงมือใช้เครื่อง" },
  { tool_name: "dna_os.create_scoped_workspace", read_write_class: "MUTATES_DNA_OS", side_effect_class: "WORK_STATE_WRITE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "สร้าง workspace ภายใต้ Owner grant — ไม่มี grant แล้ว DENY" },
  { tool_name: "dna_os.invoke_local_capability", read_write_class: "MUTATES_DNA_OS", side_effect_class: "COMMAND_EXECUTION",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "ลงมือใช้ความสามารถท้องถิ่นหลัง Owner policy — default DENY" },
  { tool_name: "dna_os.get_local_execution_status", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่านสถานะการลงมือใช้ทรัพยากรท้องถิ่น" },
  { tool_name: "dna_os.get_local_execution_evidence", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่านหลักฐาน DNA_OS_LOCAL_EXECUTION โดยไม่มี secret" },
  { tool_name: "dna_os.get_machine_inventory", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่าน inventory ของเครื่องหลัง discovery — ไม่ให้สิทธิ์ใหม่" },
  { tool_name: "dna_os.list_applications", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "รายการแอปที่ค้นพบโดยไม่ grant" },
  { tool_name: "dna_os.get_application_capabilities", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่านความสามารถที่ประกาศของแอปที่ลงทะเบียน" },
  { tool_name: "dna_os.list_remote_services", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "รายการบริการระยะไกลตาม binding จริงหรือ CONTRACT_ONLY" },
  { tool_name: "dna_os.get_remote_service_capabilities", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่าน mapping ความสามารถของบริการระยะไกล" },
  { tool_name: "dna_os.get_capability_binding_status", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่านสถานะ DECLARED/ADAPTER/AUTH/VERIFIED/OWNER_ENABLED" },
  { tool_name: "dna_os.list_local_tools", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่าน adapter fabric — discovery ไม่ให้สิทธิ์" },
  { tool_name: "dna_os.get_local_tool", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่าน adapter หนึ่งตัว ไม่ execute" },
  { tool_name: "dna_os.list_tool_capabilities", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่านความสามารถที่ตรวจแล้ว ไม่สมมติจากหมวดแอป" },
  { tool_name: "dna_os.get_tool_health", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่านสุขภาพติดตั้ง/adapter/verified/authorized" },
  { tool_name: "dna_os.list_devices", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่าน DEVICE_RESOURCE_V1 — discovery ไม่ให้สิทธิ์" },
  { tool_name: "dna_os.get_device", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่านอุปกรณ์หนึ่งชิ้นโดยไม่ mutate" },
  { tool_name: "dna_os.resolve_local_tool_route", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "จัดอันดับ native-first โดยไม่ execute" },
  { tool_name: "dna_os.render_canonical_view", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "เรนเดอร์มุมมองตาม schema ที่ลงทะเบียน ไม่ใช่ HTML จาก AI" },
  { tool_name: "dna_os.normalize_ai_view", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "ตรวจ structured output ของ AI กับ canonical view" },
  { tool_name: "dna_os.open_owner_review", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "เปิดพื้นผิว Owner review โดยไม่ลงมือทำ" },
  { tool_name: "dna_os.create_action_preview", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "สร้าง ACTION_PREVIEW_V1 โดยไม่ execute" },
  { tool_name: "dna_os.apply_owner_review", read_write_class: "MUTATES_DNA_OS", side_effect_class: "COMMAND_EXECUTION",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "APPROVE ไปทาง invoke_local_capability ที่มีอยู่ — UI ไม่สมมติผล" },
  { tool_name: "dna_os.list_launcher", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "รายการ launcher จาก discovery — ไม่ให้สิทธิ์" },
  { tool_name: "dna_os.get_activity_view", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "ACTIVITY_VIEW_V1 จาก event ที่มีอยู่" },
  { tool_name: "dna_os.list_document_templates", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "รายการ document template แบบ fixture" },
  { tool_name: "dna_os.get_site_tool_catalog", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "แคตตาล็อก site-tool — discovery ไม่ลงมือทำ" },
  { tool_name: "dna_os.get_ai_client_discovery", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "discovery ของ client โดยไม่ให้สิทธิ์" },
  { tool_name: "dna_os.inspect_local_for_client", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "ค้นในเครื่องแล้วคืนชุดทำงานที่ย่อแล้ว" },
  { tool_name: "dna_os.route_search", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "แยก LOCAL/WEB/remote search โดยนโยบายเจ้าของมาก่อน" },
  { tool_name: "dna_os.create_ai_handoff", read_write_class: "MUTATES_DNA_OS", side_effect_class: "WORK_STATE_WRITE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "สร้าง AI_HANDOFF_V1 โดยไม่มี transcript" },
  { tool_name: "dna_os.invoke_site_tool", read_write_class: "MUTATES_DNA_OS", side_effect_class: "COMMAND_EXECUTION",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "site-tool เรียก gateway เดิม — ไม่ใช่ทางลงมือทำเส้นที่สอง" },
  { tool_name: "dna_os.list_clients", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "discovery ของ client — ไม่ให้สิทธิ์" },
  { tool_name: "dna_os.get_client_status", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "สถานะ client โดยแยก authenticated กับ authorized" },
  { tool_name: "dna_os.list_owner_environments", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "รายการสภาพแวดล้อมของเจ้าของ" },
  { tool_name: "dna_os.get_owner_environment", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่านสภาพแวดล้อมหนึ่งรายการ" },
  { tool_name: "dna_os.get_resource_handle", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "handle เชิงตรรกะ ไม่ส่งไฟล์ดิบ" },
  { tool_name: "dna_os.resolve_capability_route", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "เส้นทาง OWNER_COMPUTE_FIRST โดยไม่ execute" },
  { tool_name: "dna_os.get_work_context", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่าน WORK_CONTEXT_V1" },
  { tool_name: "dna_os.submit_owner_intent", read_write_class: "MUTATES_DNA_OS", side_effect_class: "COMMAND_EXECUTION",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "รับ intent แล้วเดินทางเดิมของ Owner" },
  { tool_name: "dna_os.get_owner_work_surface", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "snapshot ของหน้าจาน Owner — ไม่ให้สิทธิ์" },
  { tool_name: "dna_os.get_owner_response", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่าน owner_response_state — ข้อเท็จจริงที่อ่านได้อย่างเดียวไม่ใช่ error ของ MCP" },
  { tool_name: "dna_os.list_app_launcher", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "ไอคอนนำทาง ไม่ให้สิทธิ์" },
  { tool_name: "dna_os.owner_search", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "ค้นหาในแหล่งที่ได้รับอนุญาต โดย local-first" },
  { tool_name: "dna_os.open_owner_work", read_write_class: "MUTATES_DNA_OS", side_effect_class: "WORK_STATE_WRITE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "เปิดมุมมอง canonical บนหน้าจาน Owner" },
  { tool_name: "dna_os.request_owner_work_action", read_write_class: "MUTATES_DNA_OS", side_effect_class: "WORK_STATE_WRITE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "สร้าง ACTION_PREVIEW ไม่ execute" },
  { tool_name: "dna_os.get_macos_bridge_status", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่านสถานะ native bridge — discovery ไม่ให้สิทธิ์" },
  { tool_name: "dna_os.list_macos_capabilities", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "รายการความสามารถ native ที่ตรวจแล้ว" },
  { tool_name: "dna_os.get_macos_permission_state", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "สถานะ TCC/entitlement โดยไม่ขอสิทธิ์ใหม่" },
  { tool_name: "dna_os.get_command_queue", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่านคิวคำสั่ง Owner" },
  { tool_name: "dna_os.get_command_status", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่านคำสั่งหนึ่งรายการในคิว" },
  { tool_name: "dna_os.get_system_activity", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่าน correlation ของเหตุการณ์ระบบแบบ observe" },
  { tool_name: "dna_os.get_capability_drift", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่าน drift ของความสามารถ โดยไม่ auto-enable" },
  { tool_name: "dna_os.get_development_work", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่านงานพัฒนา — discovery ไม่ให้สิทธิ์" },
  { tool_name: "dna_os.get_development_status", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่านสถานะ artifact — ไม่ execute" },
  { tool_name: "dna_os.get_production_pipeline", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่าน pipeline — ไม่เลี่ยง Owner path" },
  { tool_name: "dna_os.get_artifact_status", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่านสถานะ artifact" },
  { tool_name: "dna_os.get_verification_status", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่านผลการตรวจเครื่อง" },
  { tool_name: "dna_os.get_promotion_status", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่านสถานะ promotion" },
  { tool_name: "dna_os.get_deployment_status", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่านสถานะ deploy — ไม่ deploy" },
  { tool_name: "dna_os.get_runtime_verification", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่าน runtime verification" },
  { tool_name: "dna_os.get_capability_lineage", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่าน lineage จาก intent ถึง capability" },
  { tool_name: "dna_os.list_development_notifications", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่านการแจ้งเตือนงานพัฒนา" },
  { tool_name: "dna_os.get_owner_surface", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่าน operational/development surface โดยไม่ให้สิทธิ์ข้ามโดเมน" },
  { tool_name: "dna_os.route_owner_surface_request", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "จัดเส้นทางตาม surface — ไม่ยกระดับสิทธิ์" },
  { tool_name: "dna_os.submit_development_control", read_write_class: "MUTATES_DNA_OS", side_effect_class: "WORK_STATE_WRITE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "สร้างข้อเสนอพัฒนาบน Development Control เท่านั้น — ยังไม่แก้ source" },
  { tool_name: "dna_os.modify_source", read_write_class: "MUTATES_DNA_OS", side_effect_class: "COMMAND_EXECUTION",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "mutation ของ source ต้องมี development lease" },
  { tool_name: "dna_os.create_worktree", read_write_class: "MUTATES_DNA_OS", side_effect_class: "COMMAND_EXECUTION",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "worktree ไม่ได้อยู่ใน source-write lease โดยอัตโนมัติ" },
  { tool_name: "dna_os.invoke_coding_worker", read_write_class: "MUTATES_DNA_OS", side_effect_class: "COMMAND_EXECUTION",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "coding worker เฉพาะ development lease" },
  { tool_name: "dna_os.commit_source", read_write_class: "MUTATES_DNA_OS", side_effect_class: "COMMAND_EXECUTION",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "commit ยังอยู่ที่ production pipeline" },
  { tool_name: "dna_os.publish_source", read_write_class: "MUTATES_DNA_OS", side_effect_class: "COMMAND_EXECUTION",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "publish ยังอยู่ที่ production pipeline" },
  { tool_name: "dna_os.apply_scoped_source_write", read_write_class: "MUTATES_DNA_OS", side_effect_class: "COMMAND_EXECUTION",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "mutation ใน scoped worktree หลัง development lease เท่านั้น" },
  { tool_name: "dna_os.create_scoped_development_workspace", read_write_class: "MUTATES_DNA_OS", side_effect_class: "WORK_STATE_WRITE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "สร้าง isolated development worktree หลัง lease" },
  { tool_name: "dna_os.read_scoped_source", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่าน source ตาม handle ใน scoped worktree — อ่านไม่ให้สิทธิ์เขียน" },
  { tool_name: "dna_os.get_development_context", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "structured development context จาก canonical facts" },
  { tool_name: "dna_os.get_coding_knowledge", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "registered-fact-first สำหรับ coding client" },
  { tool_name: "dna_os.create_scoped_source_file", read_write_class: "MUTATES_DNA_OS", side_effect_class: "COMMAND_EXECUTION",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "สร้างไฟล์ใน scoped worktree หลัง lease" },
  { tool_name: "dna_os.delete_scoped_source_file", read_write_class: "MUTATES_DNA_OS", side_effect_class: "COMMAND_EXECUTION",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "ลบไฟล์ใน scoped worktree หลัง lease" },
  { tool_name: "dna_os.get_information_entity", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่าน canonical entity" },
  { tool_name: "dna_os.list_information_entities", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "list canonical entities" },
  { tool_name: "dna_os.get_information_facts", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่าน canonical facts" },
  { tool_name: "dna_os.get_information_relationships", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่าน canonical relationships" },
  { tool_name: "dna_os.get_information_boundaries", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่าน canonical boundaries" },
  { tool_name: "dna_os.get_information_state", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่าน canonical state" },
  { tool_name: "dna_os.get_recent_events", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่าน canonical events" },
  { tool_name: "dna_os.get_active_activity", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่าน canonical activity" },
  { tool_name: "dna_os.get_owner_information_projection", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "Owner information projection" },
  { tool_name: "dna_os.get_consumer_payload", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "structured consumer payload" },
  { tool_name: "dna_os.list_notifications", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่านประวัติการแจ้งเตือนเจ้าของ" },
  { tool_name: "dna_os.get_notification", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่านการแจ้งเตือนหนึ่งรายการ" },
  { tool_name: "dna_os.get_notification_summary", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "ดัชนีความสนใจของเจ้าของ" },
  { tool_name: "dna_os.get_active_work", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่านงานที่กำลังทำ ไม่ใช่ประวัติแจ้งเตือน" },
  { tool_name: "dna_os.get_owner_attention_required", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "รายการที่ต้องให้เจ้าของตัดสิน ไม่ให้สิทธิ์ source" },
  { tool_name: "dna_os.get_notification_delivery_status", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "หลักฐานการส่ง ไม่ใช่หลักฐานว่าเจ้าของเห็นแล้ว" },
  { tool_name: "dna_os.get_macos_notification_permission", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่าน UNNotificationSettings โดยไม่ขอสิทธิ์" },
  { tool_name: "dna_os.list_inbound_adapters", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "ค้นพบ inbound adapter — discovery ไม่ให้สิทธิ์" },
  { tool_name: "dna_os.get_inbound_adapter", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่าน adapter หนึ่งตัว" },
  { tool_name: "dna_os.get_submitted_work", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่านงานที่เจ้าของส่ง แม้จะออกจาก coding client" },
  { tool_name: "dna_os.list_active_work", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "งานที่กำลังทำและความคืบหน้า" },
  { tool_name: "dna_os.get_work_output_summary", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "นับรายงาน/ผลลัพธ์" },
  { tool_name: "dna_os.get_owner_work_notification_summary", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "สรุปงานและการแจ้งเตือน" },
  { tool_name: "dna_os.get_provider_event_status", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "สุขภาพ inbound provider โดยไม่ปลอม connectivity" },
  { tool_name: "dna_os.get_production_checkpoint", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่าน PRODUCTION_CHECKPOINT_V1 — ไม่ใช่สิทธิ์รันงาน" },
  { tool_name: "dna_os.list_production_checkpoints", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "รายการ checkpoint จากหลักฐานเครื่อง" },
  { tool_name: "dna_os.get_work_completion_readiness", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "งานเสร็จเมื่อ lane checkpoint ครบ ไม่ใช่เมื่อเอเจนต์บอกว่าเสร็จ" },
  { tool_name: "dna_os.get_work_completion_report", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "รายงานรวม ไม่ใช่ log ดิบ" },
  { tool_name: "dna_os.get_source_lineage_status", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "เทียบ revision โดยไม่ซ่อม lineage เอง" },
  { tool_name: "dna_os.get_production_readiness_summary", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "สรุปความพร้อม production โดยไม่เรียก LOCAL_FIXTURE ว่า cloud" },
  { tool_name: "dna_os.get_lineage_closure_status", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "ปิด lineage report — ไม่ซ่อม divergence เอง" },
  { tool_name: "dna_os.list_admission_ready_work", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "งานที่ผ่านเกณฑ์ admission จากหลักฐานเครื่อง" },
  { tool_name: "dna_os.get_deployment_target_status", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "ทะเบียน deployment target จริง ไม่สมมติ cloud" },
  { tool_name: "dna_os.get_github_protection_status", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "สถานะ GitHub environment protection ตามที่มีจริง" },
  { tool_name: "dna_os.list_remote_production_resources", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "รายการ remote production ที่ค้นพบแล้ว ไม่ใช่สิทธิ์สร้างหรือ deploy" },
  { tool_name: "dna_os.get_remote_production_binding", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่าน binding ของ production เดิม" },
  { tool_name: "dna_os.get_real_production_lineage", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "lineage จริงโดยตัด fixture revision" },
  { tool_name: "dna_os.get_existing_deployment_method", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "วิธี deploy ที่มีอยู่แล้ว" },
  { tool_name: "dna_os.get_remote_authentication_status", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "สถานะ authentication ของ remote โดยไม่คืน secret" },
  { tool_name: "dna_os.get_railway_deploy_capability_status", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "สถานะความสามารถ deploy ของ Railway โดยไม่ใช่สิทธิ์ deploy" },
  { tool_name: "dna_os.get_remote_deployment", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่าน deployment record ล่าสุด" },
  { tool_name: "dna_os.get_remote_deployment_revision", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "revision จากหลักฐานผู้ให้บริการ" },
  { tool_name: "dna_os.get_runtime_revision_alignment", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "alignment ของ runtime revision โดยไม่ถือ HTTP 200 เป็นหลักฐาน revision" },
  { tool_name: "dna_os.get_ai_queen_status", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "สถานะ AI Queen ในฐานะ MCP client ไม่ใช่ trusted core" },
  { tool_name: "dna_os.get_ai_queen_capability_profile", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "โปรไฟล์เครื่องมือที่ Owner grant ให้ AI Queen" },
  { tool_name: "dna_os.get_railway_provider_interface_status", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "สถานะ Railway ในฐานะ provider interface หลัง DNA OS ไม่ใช่ mutation catalog" },
  { tool_name: "dna_os.get_railway_mcp_status", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "ค้นพบ Railway CLI/MCP โดยไม่คืน credential" },
  { tool_name: "dna_os.get_github_main_governance", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่านสถานะ governance ของ GitHub main โดยไม่เปลี่ยนกฎ" },
  { tool_name: "dna_os.get_github_ruleset_status", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่านสถานะ ruleset โดยไม่สร้างหรือ activate" },
  { tool_name: "dna_os.get_required_status_checks", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "รายการ check/status ที่ค้นพบจริง ไม่ใช่การตั้ง required checks" },
  { tool_name: "dna_os.get_github_bypass_policy", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "นโยบาย bypass ของ GitHub main ไม่ใช่สิทธิ์ bypass" },
  { tool_name: "dna_os.get_remote_admission_gate_status", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "สถานะ DNA OS remote admission โดยไม่ rerun AI" },
  { tool_name: "dna_os.resolve_tool_grant", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "DNA OS เป็นผู้ตัดสิน tool grant จาก export-policy + capability-gate + descriptor — ไม่มี secret" },
  { tool_name: "dna_os.inspect_tool_descriptor", read_write_class: "READ_ONLY", side_effect_class: "NONE",
    authority_requirement: "NONE", export_class: "EXTERNAL_ALLOWED",
    reason: "อ่าน canonical tool descriptor (references only) — fail closed เมื่อ tool ไม่รู้จักหรือถูก revoke" },
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
  readonly surface_id?: "OPERATIONAL_OWNER_SURFACE" | "DEVELOPMENT_CONTROL_SURFACE";
  readonly authority_domain?: "OPERATIONAL" | "DEVELOPMENT";
  readonly lease_active?: boolean;
  readonly work_id?: string;
  readonly agent_execution_id?: string;
  readonly client_id?: string;
  readonly granted_tools?: readonly string[];
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
  if (isRawRailwayMcpTool(toolName)) {
    return { allowed: false, reason: "NOT_EXPOSED — Railway MCP mutation is a provider interface behind DNA OS" };
  }
  const grants = grantedToolsForAiClient({
    client_id: ctx.client_id,
    authority_domain: ctx.authority_domain,
    lease_active: ctx.lease_active,
    granted_tools: ctx.granted_tools,
  });
  if (grants && !grants.includes(toolName)) {
    return { allowed: false, reason: "NOT_EXPOSED — caller grant profile does not include this tool" };
  }
  const filtered = filterMcpTools({
    authority_domain: ctx.authority_domain,
    lease_active: ctx.lease_active === true,
    tool_names: [toolName],
  });
  if (!filtered.AVAILABLE_TOOLS.includes(toolName)) {
    return { allowed: false, reason: "MCP_SURFACE_TOOL_FILTER_V1 — tool is not on this surface/lease" };
  }
  const p = policyFor(toolName);
  const klass = classOf(ctx);
  /**
   * ตัวตนของเครื่องเห็นได้เฉพาะเครื่องมืออ่าน — เครื่องมือที่เปลี่ยนสถานะระบบ
   * ยังต้องเป็นเจ้าของที่ยืนยันตัวตนแล้วเท่านั้น กุญแจของช่องทางไม่ใช่สิทธิ์ของคน
   */
  if (klass === "INTERNAL_DNA_OS") {
    if (p.export_class === "INTERNAL_ONLY" || (p.export_class === "EXTERNAL_ALLOWED" && p.read_write_class === "READ_ONLY")) {
      return { allowed: true, reason: "ตัวตนภายในของ DNA OS — เห็นได้เฉพาะเครื่องมืออ่าน" };
    }
    return { allowed: false, reason: `${p.export_class} — ตัวตนของเครื่องไม่ใช่สิทธิ์ของเจ้าของ` };
  }
  if (klass === "OWNER_VERIFIED" && hasVerifiedOwner(ctx)) return { allowed: true, reason: "เจ้าของยืนยันตัวตนแล้ว" };
  if (ctx.channel === "INTERNAL" && hasVerifiedOwner(ctx)) return { allowed: true, reason: "ช่องทางภายในที่ยืนยันแล้ว" };
  if (p.export_class === "EXTERNAL_ALLOWED") return { allowed: true, reason: "ประกาศให้ภายนอกใช้ได้" };
  if (p.export_class === "OWNER_ONLY" && hasVerifiedOwner(ctx)) return { allowed: true, reason: "เจ้าของยืนยันตัวตนแล้ว" };
  return { allowed: false, reason: `${p.export_class} — ผู้เรียกภายนอกไม่มีสิทธิ์เห็นเครื่องมือนี้` };
}

/** เรียกได้ไหม — ตรวจก่อนถึง handler เสมอ */
export function canInvoke(toolName: string, ctx: CallerContext): { allowed: boolean; reason_code: string; reason: string } {
  if (isRawRailwayMcpTool(toolName)) {
    return { allowed: false, reason_code: "NOT_EXPOSED", reason: "raw Railway MCP production tools are not exposed to AI clients" };
  }
  const grants = grantedToolsForAiClient({
    client_id: ctx.client_id,
    authority_domain: ctx.authority_domain,
    lease_active: ctx.lease_active,
    granted_tools: ctx.granted_tools,
  });
  if (grants && !grants.includes(toolName)) {
    return { allowed: false, reason_code: "NOT_EXPOSED", reason: "caller grant profile does not include this tool" };
  }
  if ((CANONICAL_PROMOTION_TOOLS as readonly string[]).includes(toolName) || toolName === "write_file" || toolName === "dna_os.write_file") {
    return { allowed: false, reason_code: "NOT_EXPOSED", reason: "canonical commit/push/worktree and generic write are DNA OS authority, not coding-client tools" };
  }
  if (ctx.authority_domain !== "DEVELOPMENT" && (toolName === "dna_os.submit_development_control" || (SOURCE_MUTATION_TOOLS as readonly string[]).includes(toolName))) {
    return { allowed: false, reason_code: "CROSS_SURFACE_EXECUTION_BARRIER", reason: "operational surface cannot invoke development mutation tools" };
  }
  if ((SOURCE_MUTATION_TOOLS as readonly string[]).includes(toolName) && ctx.lease_active !== true) {
    return { allowed: false, reason_code: "DEVELOPMENT_AUTHORITY_REQUIRED", reason: "source mutation tools require an active scoped lease" };
  }
  if (mcpMutationRequiresTaskScope(toolName)) {
    const agentTask = ctx.work_id;
    const agentExec = ctx.agent_execution_id;
    if (!agentTask || agentTask === "" || !agentExec || agentExec === "") {
      return { allowed: false, reason_code: "SCOPE_UNRESOLVED", reason: "coding-agent mutation requires resolved task scope on the request context" };
    }
    const decision = resolveCanonicalTaskScope(
      { task_id: agentTask, agent_execution_id: agentExec },
      liveRegistryFromExistingStores(),
    );
    if (!decision.ok) {
      return { allowed: false, reason_code: "SCOPE_UNRESOLVED", reason: decision.detail ?? "coding-agent mutation requires a registered assignment" };
    }
  }
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
