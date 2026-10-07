/**
 * หน้าที่: ประกาศชั้นทั้งสิบเจ็ดของเครื่อง และผูกแต่ละชั้นเข้ากับแหล่งที่มีอยู่จริง
 *
 * ── ทำไมต้องประกาศชั้นก่อนมีข้อมูล ──
 * ถ้าให้โมเดลเกิดจาก "อะไรที่บังเอิญมีไฟล์อยู่" ชั้นที่ยังไม่มีใครเก็บจะหายไป
 * เงียบ ๆ แล้วระบบจะดูครบทั้งที่มันไม่ครบ ชั้นทั้งสิบเจ็ดจึงถูกประกาศไว้ก่อน
 * และชั้นที่ยังไม่มีแหล่งต้องรายงานตัวเองว่า `NOT_REPRESENTED` — ไม่ใช่หายไป
 *
 * ── ห้ามให้ AI อ่านไฟล์เพื่อสร้างโมเดลใหม่ทุกครั้ง ──
 * ทุกชั้นผูกกับ "แหล่งที่เขียนไว้แล้ว" (`source_store`) การอ่านซอร์สเพื่อเดา
 * ว่ามีอะไรอยู่บนเครื่อง ไม่นับเป็นแหล่ง ชั้นที่ยังไม่มีใครบันทึกให้ ต้องขึ้นว่า
 * ยังไม่มี ไม่ใช่ให้ตัวอ่านไปสแกนหามาเอง
 *
 * Input: ไม่มี
 * Output: `MACHINE_LAYERS`, `LayerId`, `LayerDeclaration`
 * Dependency ที่อนุญาต: none
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่มชั้นที่ไม่มีในลำดับที่ Owner ประกาศ
 *                ห้ามผูกชั้นกับ "การสแกนซอร์ส" เป็นแหล่ง
 */

export type LayerId =
  | "MACHINE" | "HARDWARE_OS" | "INSTALLED_SOFTWARE" | "PROCESSES_SERVICES"
  | "FILES_PACKAGES" | "REPOSITORIES" | "RUNTIME" | "LOCAL_DATABASES"
  | "CONNECTED_EXTERNAL_RESOURCES" | "CREDENTIAL_POINTERS" | "CAPABILITIES"
  | "CONTRACTS" | "DEPENDENCIES" | "OWNERSHIP" | "PURPOSE" | "HISTORY"
  | "CURRENT_STATE";

export interface LayerDeclaration {
  readonly layer_id: LayerId;
  /** ลำดับตามที่ Owner ประกาศ — ชั้นล่างรองรับชั้นบน */
  readonly order: number;
  readonly question: string;
  /** แหล่งที่ "เขียนไว้แล้ว" ที่ชั้นนี้อ่านได้ — `null` = ยังไม่มีใครเก็บ */
  readonly source_store: string | null;
  readonly identity_form: string;
}

export const MACHINE_LAYERS: readonly LayerDeclaration[] = [
  { layer_id: "MACHINE", order: 1, question: "เครื่องนี้คือเครื่องไหน",
    source_store: "execution/installation-initialization", identity_form: "installation_id" },
  { layer_id: "HARDWARE_OS", order: 2, question: "ฮาร์ดแวร์และระบบปฏิบัติการอะไร",
    source_store: null, identity_form: "ยังไม่มีรูปแบบตัวตน" },
  { layer_id: "INSTALLED_SOFTWARE", order: 3, question: "มีซอฟต์แวร์อะไรติดตั้งอยู่",
    source_store: null, identity_form: "ยังไม่มีรูปแบบตัวตน" },
  { layer_id: "PROCESSES_SERVICES", order: 4, question: "อะไรกำลังรันอยู่",
    source_store: "control/machine-observation/data/observations.jsonl", identity_form: "pid + executable" },
  { layer_id: "FILES_PACKAGES", order: 5, question: "มีไฟล์และแพ็กเกจอะไรที่ระบบรู้จัก",
    source_store: "software/registry-database/data/canonical/resources.jsonl", identity_form: "resource_id" },
  { layer_id: "REPOSITORIES", order: 6, question: "โค้ดมาจากที่ไหน",
    source_store: "software/repository-registry/data/repositories.jsonl", identity_form: "repository_id" },
  { layer_id: "RUNTIME", order: 7, question: "รันด้วยอะไร",
    source_store: "control/machine-observation/data/runtime-targets.jsonl", identity_form: "runtime_target_id" },
  { layer_id: "LOCAL_DATABASES", order: 8, question: "เก็บสถานะไว้ที่ไหนบนเครื่องนี้",
    // `credentials/registry/database-credential-registry.ts` เก็บ "วิธีต่อ" ไม่ใช่ "ฐานข้อมูลบนเครื่องนี้"
    // และคลัง jsonl ทั้งหมดของระบบยังไม่มีใครประกาศตัวเองเป็นฐานข้อมูลท้องถิ่น
    source_store: null, identity_form: "ยังไม่มีรูปแบบตัวตน" },
  { layer_id: "CONNECTED_EXTERNAL_RESOURCES", order: 9, question: "ต่อออกไปข้างนอกที่ไหนบ้าง",
    source_store: "connections/connection-registry/data/connections.jsonl", identity_form: "connection_id" },
  { layer_id: "CREDENTIAL_POINTERS", order: 10, question: "กุญแจอยู่ที่ไหน (ตัวชี้ ไม่ใช่ค่า)",
    source_store: "credentials/registry/data/api-credential-references.jsonl", identity_form: "credential reference" },
  { layer_id: "CAPABILITIES", order: 11, question: "ระบบทำอะไรได้",
    source_store: "software/registry-database/data/canonical/capabilities.jsonl", identity_form: "capability_id" },
  { layer_id: "CONTRACTS", order: 12, question: "แต่ละความสามารถรับอะไรและคืนอะไร",
    source_store: "software/registry-database/data/canonical/capabilities.jsonl", identity_form: "input/output_contract ของ capability" },
  { layer_id: "DEPENDENCIES", order: 13, question: "อะไรพึ่งอะไร",
    source_store: "software/registry-database/data/canonical/relationships.jsonl", identity_form: "relationship_id" },
  { layer_id: "OWNERSHIP", order: 14, question: "ใครเป็นเจ้าของอะไร",
    source_store: "software/registry-database/data/canonical/resource_capabilities.jsonl", identity_form: "resource -> capability" },
  { layer_id: "PURPOSE", order: 15, question: "มีไว้ทำไม",
    source_store: "software/registry-database/data/canonical/capabilities.jsonl", identity_form: "purpose ของ capability" },
  { layer_id: "HISTORY", order: 16, question: "เคยเกิดอะไรขึ้นมาแล้วบ้าง",
    source_store: "software/registry-database/data/canonical/registration_events.jsonl", identity_form: "registration event" },
  { layer_id: "CURRENT_STATE", order: 17, question: "ตอนนี้เป็นอย่างไร",
    source_store: "control/machine-observation/data/observations.jsonl", identity_form: "observation event" },
];
