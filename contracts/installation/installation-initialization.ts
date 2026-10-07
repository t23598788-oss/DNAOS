/**
 * หน้าที่: สัญญาของ "เหตุการณ์ที่ทำให้ DNA OS ชุดนี้ถือกำเนิด" — ไม่ใช่ตัวตนเอง
 * และไม่ใช่ที่เก็บ
 *
 * สามสิ่งนี้ห้ามใช้แทนกัน:
 *   InstallationIdentity          ตัวตนที่เสถียรของการติดตั้งหนึ่งชุด
 *   InstallationInitializationV1  หลักฐานที่บอกว่าตัวตนนั้นเกิดขึ้นได้อย่างไร (ไฟล์นี้)
 *   LocalStateRoot                ขอบเขตทางกายภาพที่หลักฐานนั้นไปวางอยู่
 *
 * ── ไฟล์นี้ไม่ทำพิธี ──
 * ไม่สร้าง installation_id ไม่อ่านนาฬิกา ไม่แตะระบบไฟล์ และไม่รู้ว่าการติดตั้งนี้
 * เริ่มต้นแล้วหรือยัง มันตอบคำถามเดียว: **ระเบียนแบบไหนที่นับว่าใช้ได้**
 *
 * ── สิ่งที่ระเบียนนี้ไม่ได้ให้ ──
 * ไม่ให้การยืนยันตัวตน ไม่ให้สิทธิ์ ไม่ทำให้ใครเป็น Owner และไม่ให้อำนาจสั่ง
 * runtime ใด ๆ เชื้อสายคือ Initialization -> Identity -> BootstrapEnrollment ->
 * Principal และแต่ละลูกศรต้องมีสไลซ์ของตัวเอง
 *
 * ── ขีดจำกัดที่ต้องคงไว้ตรง ๆ ──
 * `machine_binding_evidence` มีค่าเดียวที่เป็นไปได้คือ `NOT_ESTABLISHED` เพราะ
 * วันนี้ไม่มี primitive ที่ไม่ใช่ความลับตัวใดในเครื่องนี้ที่แยก "อ่านสถานะของ
 * ตัวเอง" ออกจาก "อ่านสถานะที่ถูกคัดลอกมาทั้งชุด" ได้ การมีระเบียนนี้ **ไม่ได้
 * เปลี่ยน** ข้อสรุปนั้น: ตรวจการคัดลอกยังไม่ได้ และความหมายของการคัดลอกสถานะ
 * ทั้งชุดยังไม่ถูกตัดสิน
 *
 * Input: `BuildInitializationInput`, ค่า unknown สำหรับการตรวจสอบ
 * Output: `InstallationInitializationV1`, `buildInitializationRecord`,
 * `validateInitializationRecord`, `initializationIdOf`, `recordDigestOf`
 * Dependency ที่อนุญาต: node:crypto
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่มค่าให้ `MachineBindingEvidenceV1` โดยไม่มี primitive
 * จริงรองรับ ห้ามเรียก Date.now()/randomUUID() ในไฟล์นี้ และห้ามแตะระบบไฟล์
 */

import { createHash } from "node:crypto";

export const INSTALLATION_INITIALIZATION_SCHEMA = "dna-os.installation-initialization.v1";
export type InstallationInitializationSchema = typeof INSTALLATION_INITIALIZATION_SCHEMA;

/**
 * รุ่นของพิธี — ไม่ใช่เวอร์ชันของแอปหรือของแพ็กเกจ
 *
 * มันบอกว่าตัวตนนี้เกิดใต้ **สมมติฐานความเชื่อถือชุดไหน** พิธีรุ่นถัดไปจะมี
 * หลักฐานที่แข็งกว่า และผู้อ่านในอนาคตต้องแยกได้โดยไม่ต้องเดาจากวันที่
 */
export const CEREMONY_VERSION_V1 = "installation-ceremony-v1";
export type CeremonyVersion = typeof CEREMONY_VERSION_V1;

/**
 * วิธีเดียวที่พิสูจน์แล้วใน V1: พิธีที่คนสั่งให้เกิดขึ้นในเครื่องนี้
 * ไม่มี CLONE/IMPORT/MIGRATION/RECOVERY เพราะยังไม่มีหลักฐานว่าจะแยกมันออกจาก
 * กันได้อย่างไร การประกาศไว้ล่วงหน้าจะเป็นคำศัพท์ที่ไม่มีใครผลิตได้
 */
export const CREATION_METHOD_V1 = "EXPLICIT_LOCAL_INITIALIZATION_CEREMONY";
export type CreationMethod = typeof CREATION_METHOD_V1;

/**
 * ค่าเดียวที่เป็นไปได้ ไม่ใช่ค่าเริ่มต้นของ union ที่มีค่าอื่น
 *
 * ห้ามใช้ hostname, MAC address, hardware UUID, ความลับใน Keychain หรือ path
 * ของรีโปมาแต่งเป็นตัวตนของเครื่อง — ทั้งหมดนั้นเปลี่ยนได้ ถูกคัดลอกได้ หรือ
 * ไม่ได้พิสูจน์สิ่งที่มันดูเหมือนจะพิสูจน์
 */
export interface MachineBindingEvidenceV1 { readonly status: "NOT_ESTABLISHED" }
export const MACHINE_BINDING_NOT_ESTABLISHED: MachineBindingEvidenceV1 = Object.freeze({ status: "NOT_ESTABLISHED" });

export interface InstallationInitializationV1 {
  readonly schema: InstallationInitializationSchema;
  readonly initialization_id: string;
  readonly installation_id: string;
  readonly ceremony_version: CeremonyVersion;
  readonly created_at: string;
  readonly creation_method: CreationMethod;
  readonly machine_binding_evidence: MachineBindingEvidenceV1;
  readonly evidence_refs: readonly string[];
  readonly record_digest: string;
}

/** ผู้เรียกส่ง installation_id มาเอง — ไฟล์นี้ตรวจ ไม่สร้าง */
export interface BuildInitializationInput {
  readonly installation_id: string;
  readonly created_at: string;
  readonly evidence_refs: readonly string[];
  readonly ceremony_version?: CeremonyVersion;
  readonly creation_method?: CreationMethod;
  readonly machine_binding_evidence?: MachineBindingEvidenceV1;
}

export type InitializationReasonCode =
  | "MALFORMED_INSTALLATION_ID"
  | "INVALID_TIMESTAMP"
  | "UNKNOWN_CREATION_METHOD"
  | "UNKNOWN_CEREMONY_VERSION"
  | "UNKNOWN_SCHEMA"
  | "MALFORMED_MACHINE_BINDING"
  | "MALFORMED_EVIDENCE_REFS"
  | "INSUFFICIENT_EVIDENCE"
  | "DIGEST_MISMATCH"
  | "INCONSISTENT_INITIALIZATION_ID"
  | "NOT_AN_OBJECT";

// installation-<uuid> ตัวพิมพ์เล็กเท่านั้น — ห้าม derive จากเครื่อง/รีโป/เนื้อหา
const INSTALLATION_ID_PATTERN = /^installation-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ISO-8601 UTC พร้อมมิลลิวินาที — รูปแบบเดียว ไม่มี offset ไม่มีรูปแบบย่อ
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * ตัวชี้ที่มีชนิด ไม่ใช่ข้อความบรรยาย
 *
 * ต้องมี `#` หรือ `:` ตามแบบแผนที่ระบบใช้อยู่แล้ว (`runtime-control:<op_id>`,
 * `path/file.ts#symbol`) — ประโยคภาษาคนที่อธิบายว่า "ทำพิธีแล้ว" ตามรอยกลับ
 * ไม่ได้ และเป็นสิ่งที่ระเบียนนี้มีไว้เพื่อไม่ให้เกิด
 */
const EVIDENCE_REF_PATTERN = /^[^\s]*[#:][^\s]*$/;

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !TIMESTAMP_PATTERN.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function normalizeEvidenceRefs(refs: readonly string[]): string[] {
  // เรียงและตัดซ้ำ: ลำดับที่ผู้เรียกส่งมาไม่ใช่ความหมาย จึงต้องไม่เปลี่ยนตัวตน
  return [...new Set(refs)].sort();
}

/** JSON ที่คีย์ถูกเรียงในทุกระดับ — ลำดับคีย์ต้องไม่เปลี่ยนผลลัพธ์ */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
}

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

interface SemanticCore {
  readonly schema: string;
  readonly installation_id: string;
  readonly ceremony_version: string;
  readonly created_at: string;
  readonly creation_method: string;
  readonly machine_binding_evidence: MachineBindingEvidenceV1;
  readonly evidence_refs: readonly string[];
}

function coreOf(r: {
  schema: string; installation_id: string; ceremony_version: string; created_at: string;
  creation_method: string; machine_binding_evidence: MachineBindingEvidenceV1; evidence_refs: readonly string[];
}): SemanticCore {
  return {
    schema: r.schema, installation_id: r.installation_id, ceremony_version: r.ceremony_version,
    created_at: r.created_at, creation_method: r.creation_method,
    machine_binding_evidence: { status: r.machine_binding_evidence.status },
    evidence_refs: normalizeEvidenceRefs(r.evidence_refs),
  };
}

/**
 * ตัวตนของเหตุการณ์ คำนวณจากความหมายของมันเอง
 *
 * ไม่สุ่มตัวตนที่สองขึ้นมา: เหตุการณ์การเริ่มต้นหนึ่งเหตุการณ์ถูกนิยามครบแล้ว
 * ด้วยเนื้อหาของมัน การให้ id สุ่มจะทำให้ระเบียนที่มีเนื้อหาเดียวกันสองใบมี
 * ตัวตนต่างกันโดยไม่มีเหตุผลเชิงความหมาย
 */
export function initializationIdOf(core: SemanticCore): string {
  return `init-${sha256(canonicalize(core)).slice(0, 32)}`;
}

/** ครอบทุกช่องเชิงความหมาย **รวม** initialization_id ตัดออกเฉพาะ record_digest เอง */
export function recordDigestOf(core: SemanticCore, initializationId: string): string {
  return sha256(canonicalize({ ...core, initialization_id: initializationId }));
}

function deepFreeze(record: InstallationInitializationV1): InstallationInitializationV1 {
  Object.freeze(record.machine_binding_evidence);
  Object.freeze(record.evidence_refs);
  return Object.freeze(record);
}

export type BuildOutcome =
  | { readonly ok: true; readonly record: InstallationInitializationV1 }
  | { readonly ok: false; readonly reason_code: InitializationReasonCode; readonly detail: string };

/**
 * ประกอบระเบียนหนึ่งใบจากค่าที่ผู้เรียกส่งมา — ไม่เขียนลงที่ใด
 *
 * `created_at` ต้องถูกส่งเข้ามา ไฟล์นี้ไม่อ่านนาฬิกา เพราะเวลาคือ **หลักฐาน**
 * ของพิธี ไม่ใช่ผลข้างเคียงของการประกอบระเบียน ระเบียนเดียวกันที่ประกอบซ้ำ
 * คนละวินาทีต้องได้ผลเหมือนกันทุกไบต์
 */
export function buildInitializationRecord(input: BuildInitializationInput): BuildOutcome {
  if (typeof input.installation_id !== "string" || !INSTALLATION_ID_PATTERN.test(input.installation_id)) {
    return { ok: false, reason_code: "MALFORMED_INSTALLATION_ID", detail: `installation_id ต้องตรงรูป installation-<uuid> ตัวพิมพ์เล็ก: ${String(input.installation_id)}` };
  }
  if (!isCanonicalTimestamp(input.created_at)) {
    return { ok: false, reason_code: "INVALID_TIMESTAMP", detail: `created_at ต้องเป็น ISO-8601 UTC พร้อมมิลลิวินาที: ${String(input.created_at)}` };
  }
  // ใช้ `=== undefined` ไม่ใช่ `??` โดยตั้งใจ: ค่า null ที่ผู้เรียกส่งมาอย่าง
  // ชัดแจ้งคือการตั้งค่าที่ผิด ไม่ใช่การไม่ตั้งค่า การแทนด้วยค่าเริ่มต้นเงียบ ๆ
  // จะทำให้ระเบียนที่ผิดกลายเป็นระเบียนที่ถูกโดยไม่มีใครเห็น
  const ceremony = input.ceremony_version === undefined ? CEREMONY_VERSION_V1 : input.ceremony_version;
  if (ceremony !== CEREMONY_VERSION_V1) {
    return { ok: false, reason_code: "UNKNOWN_CEREMONY_VERSION", detail: `รุ่นพิธีที่ไม่รู้จัก: ${String(ceremony)}` };
  }
  const method = input.creation_method === undefined ? CREATION_METHOD_V1 : input.creation_method;
  if (method !== CREATION_METHOD_V1) {
    return { ok: false, reason_code: "UNKNOWN_CREATION_METHOD", detail: `วิธีการสร้างที่ไม่รู้จัก: ${String(method)}` };
  }
  const binding = input.machine_binding_evidence === undefined ? MACHINE_BINDING_NOT_ESTABLISHED : input.machine_binding_evidence;
  if (binding === null || typeof binding !== "object" || (binding as MachineBindingEvidenceV1).status !== "NOT_ESTABLISHED") {
    return { ok: false, reason_code: "MALFORMED_MACHINE_BINDING", detail: "V1 รองรับเฉพาะ { status: \"NOT_ESTABLISHED\" } — ยังไม่มี primitive ที่ผูกเครื่องได้จริง" };
  }
  if (!Array.isArray(input.evidence_refs) || input.evidence_refs.some((r) => typeof r !== "string" || !EVIDENCE_REF_PATTERN.test(r))) {
    return { ok: false, reason_code: "MALFORMED_EVIDENCE_REFS", detail: "evidence_refs ทุกตัวต้องเป็นตัวชี้ที่มีชนิด (มี # หรือ : และไม่มีช่องว่าง)" };
  }
  const refs = normalizeEvidenceRefs(input.evidence_refs);
  if (refs.length === 0) {
    return { ok: false, reason_code: "INSUFFICIENT_EVIDENCE", detail: "ต้องมีตัวชี้หลักฐานของพิธีอย่างน้อยหนึ่งตัว — ระเบียนที่พิสูจน์ตัวเองอย่างเดียวแยกไม่ออกจากค่าคงที่ในซอร์ส" };
  }

  const core = coreOf({
    schema: INSTALLATION_INITIALIZATION_SCHEMA, installation_id: input.installation_id,
    ceremony_version: ceremony, created_at: input.created_at, creation_method: method,
    machine_binding_evidence: binding, evidence_refs: refs,
  });
  const initialization_id = initializationIdOf(core);
  return {
    ok: true,
    record: deepFreeze({
      schema: INSTALLATION_INITIALIZATION_SCHEMA,
      initialization_id,
      installation_id: core.installation_id,
      ceremony_version: CEREMONY_VERSION_V1,
      created_at: core.created_at,
      creation_method: CREATION_METHOD_V1,
      machine_binding_evidence: { status: "NOT_ESTABLISHED" },
      evidence_refs: refs,
      record_digest: recordDigestOf(core, initialization_id),
    }),
  };
}

export type ValidationOutcome =
  | { readonly status: "VALID"; readonly record: InstallationInitializationV1 }
  | { readonly status: "CORRUPT"; readonly reason_code: InitializationReasonCode; readonly detail: string };

/**
 * ตรวจระเบียนที่อ่านมาจากที่อื่น — VALID หรือ CORRUPT เท่านั้น
 *
 * สถานะที่เป็นเรื่องของ *ระบบไฟล์* (UNINITIALIZED, CONFLICT,
 * MACHINE_BINDING_MISMATCH) ไม่อยู่ที่นี่ ระเบียนหนึ่งใบไม่รู้ว่ามีใบอื่นอยู่ไหม
 * และไม่รู้ว่าตัวเองถูกอ่านมาจากเครื่องไหน
 */
export function validateInitializationRecord(value: unknown): ValidationOutcome {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { status: "CORRUPT", reason_code: "NOT_AN_OBJECT", detail: "ระเบียนต้องเป็นอ็อบเจกต์" };
  }
  const r = value as Record<string, unknown>;
  if (r.schema !== INSTALLATION_INITIALIZATION_SCHEMA) {
    return { status: "CORRUPT", reason_code: "UNKNOWN_SCHEMA", detail: `schema ที่ไม่รู้จัก: ${String(r.schema)}` };
  }
  const rebuilt = buildInitializationRecord({
    installation_id: r.installation_id as string,
    created_at: r.created_at as string,
    evidence_refs: (Array.isArray(r.evidence_refs) ? r.evidence_refs : []) as string[],
    ceremony_version: r.ceremony_version as CeremonyVersion,
    creation_method: r.creation_method as CreationMethod,
    machine_binding_evidence: r.machine_binding_evidence as MachineBindingEvidenceV1,
  });
  if (!rebuilt.ok) return { status: "CORRUPT", reason_code: rebuilt.reason_code, detail: rebuilt.detail };

  if (r.initialization_id !== rebuilt.record.initialization_id) {
    return { status: "CORRUPT", reason_code: "INCONSISTENT_INITIALIZATION_ID", detail: `initialization_id ไม่ตรงกับเนื้อหา: มี ${String(r.initialization_id)} ควรเป็น ${rebuilt.record.initialization_id}` };
  }
  if (r.record_digest !== rebuilt.record.record_digest) {
    return { status: "CORRUPT", reason_code: "DIGEST_MISMATCH", detail: "record_digest ไม่ตรงกับเนื้อหาเชิงความหมายของระเบียน" };
  }
  return { status: "VALID", record: rebuilt.record };
}
