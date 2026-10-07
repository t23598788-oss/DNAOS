/**
 * หน้าที่: บอกว่า "ฟิลด์ไหนของหลักฐานแถวไหน ใช้ตอบคำถามแบบไหนไม่ได้" —
 * โดยไม่แก้หลักฐานเดิมแม้ไบต์เดียว
 *
 * ── ทำไมอยู่ใน repair-loop ──
 * ไม่ใช่เพราะที่อยู่ไฟล์ แต่เพราะขอบเขตนี้เป็นเจ้าของแบบแผนนี้อยู่แล้วจริง:
 * `./supersede-classification.ts` เขียนระเบียนที่ "ตีความแถวเก่าใหม่โดยไม่แตะ
 * แถวเก่า" ไปแล้ว 291 แถวในระบบจริง ไฟล์นี้คือการทำให้แบบแผนนั้นมีชนิดข้อมูล
 * ใช้ซ้ำได้ และอ้างข้ามสโตร์ได้ ไม่ใช่ capability ใหม่
 *
 * ── ผิด != ใช้ตอบคำถามนี้ไม่ได้ ──
 * สองอย่างนี้ไม่เหมือนกันและต้องแยกที่ชนิดข้อมูล ฟิลด์หนึ่งอาจใช้ทำสถิติไม่ได้
 * แต่ยังมีค่าทางนิติวิทยาศาสตร์ (มันพิสูจน์ว่าเครื่องเขียนอะไรลงไปตอนนั้น)
 * `admissibility` จึงผูกกับ `interpretation_scope` เสมอ ไม่มีคำว่า "ฟิลด์นี้ผิด"
 * แบบลอย ๆ ในสัญญานี้
 *
 * ── ไม่ทำให้ทั้งแถวเป็นโมฆะ ──
 * แถว boot 64 แถวมี `health_before` ที่เชื่อไม่ได้ แต่ `service_id`,
 * `launchd_label`, `pid_after` และ `result` ในแถวเดียวกันยังจริง การตีตราทั้งแถว
 * คือการทิ้งข้อเท็จจริงที่ถูกต้องเพื่อกำจัดฟิลด์เดียวที่ผิด
 *
 * ── ไม่แต่งค่าที่ถูกต้องขึ้นมาแทน ──
 * ไฟล์นี้บันทึกว่า "เชื่อฟิลด์นี้เพื่อการตีความนี้ไม่ได้" เท่านั้น ไม่มี
 * corrected_* / estimated_* / inferred_* ค่าที่วัดไม่ได้ย้อนหลังคือวัดไม่ได้
 *
 * Input: `AnnotateInput`, `AdmissibilityQuery`
 * Output: `EvidenceAdmissibilityAnnotationV1`, `annotationIdOf`,
 * `appendAnnotation`, `listAnnotations`, `isEvidenceFieldAdmissible`
 * Dependency ที่อนุญาต: node:fs, node:path, node:crypto
 * สิ่งที่ห้ามแตะ: ห้ามแก้หรือลบ annotation ที่เขียนไปแล้ว — การแก้ความหมายต้อง
 * เป็น annotation ใหม่ที่ supersede ตัวเก่า และห้ามให้ UNKNOWN กลายเป็น
 * ADMISSIBLE เองโดยปริยาย
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";

/**
 * สโตร์ที่อ้างถึงได้ — ชุดปิด ไม่ใช่ชื่อไฟล์
 *
 * ชื่อไฟล์ไม่ใช่ตัวตนเชิงความหมาย: ไฟล์ย้ายที่ได้ ถูกคัดลอกได้ และมีสองสำเนาได้
 * การเพิ่มสโตร์ใหม่ต้องเป็นการแก้ชนิดข้อมูลที่เห็นใน diff
 */
export type EvidenceStoreId = "control/runtime-control#operations";

/** ชนิดของระเบียนในสโตร์นั้น — ชุดปิดเช่นกัน */
export type EvidenceRecordType = "OperationEvidence";

/**
 * ตัวชี้ข้ามสโตร์ที่เล็กที่สุดที่ระบุระเบียนหนึ่งแถวได้จริง
 *
 * ไม่มี `task_id` โดยเจตนา: `OperationEvidence` ไม่มีและไม่ควรมี การบังคับให้มี
 * คือการลาก runtime-control เข้าไปอยู่ในความหมายเรื่องงานของ agent-gateway
 */
export interface EvidenceSubject {
  readonly store_id: EvidenceStoreId;
  readonly record_type: EvidenceRecordType;
  readonly record_id: string;
}

export type Admissibility = "ADMISSIBLE" | "NOT_ADMISSIBLE";

/** คำถามที่คนจะเอาฟิลด์นั้นไปตอบ — ชุดปิด */
export type InterpretationScope =
  | "BOOT_FAILURE_STATISTICS"
  | "DUPLICATE_LISTENER_HISTORY"
  | "BOOT_ATTEMPT_DURATION_ANALYSIS"
  | "PRE_BOOT_LAUNCHD_STATE_HISTORY"
  | "READINESS_DURATION_HISTORY";

/** ชนิดของข้อบกพร่อง — ชุดปิด ไม่มีการจำแนกด้วย AI */
export type DefectClassification =
  | "FABRICATED_MEASUREMENT"
  | "INFERRED_NOT_MEASURED"
  | "INACCURATE_TIMESTAMP"
  | "CONFIGURED_VALUE_RECORDED_AS_OBSERVED"
  | "MEASURED_VALUE_DISCARDED_AND_REPLACED";

export interface EvidenceAdmissibilityAnnotationV1 {
  readonly annotation_id: string;
  readonly annotation_version: 1;
  readonly evidence_subject: EvidenceSubject;
  /** เส้นทางฟิลด์ตรงตัว เรียงแล้วเพื่อให้ id ไม่ขึ้นกับลำดับที่ผู้เรียกส่งมา */
  readonly affected_fields: readonly string[];
  readonly admissibility: Admissibility;
  readonly interpretation_scope: InterpretationScope;
  readonly defect_classification: DefectClassification;
  /** ทำไมถึงรู้ — ตัวชี้ไปยังสิ่งที่พิสูจน์ ไม่ใช่ที่มาของอำนาจ */
  readonly evidence_refs: readonly string[];
  readonly created_at: string;
  /** annotation ที่ระเบียนนี้แทนที่ ตัวเก่ายังอยู่ครบและไม่ถูกแก้ */
  readonly supersedes_annotation_id?: string;
}

export type AnnotateInput = Omit<EvidenceAdmissibilityAnnotationV1, "annotation_id" | "annotation_version">;

/**
 * ตัวตนของ annotation คำนวณจากความหมายเท่านั้น
 *
 * รวม: subject, ฟิลด์ (เรียงแล้ว), admissibility, scope, defect_classification
 * ไม่รวม: `created_at`, `evidence_refs`, `supersedes_annotation_id`, ลำดับคีย์,
 * รูปแบบการ serialize และชื่อไฟล์ที่เขียน
 *
 * `defect_classification` ถูกรวมเข้าไปโดยตั้งใจ: มันคือส่วนหนึ่งของสิ่งที่
 * annotation ยืนยัน ถ้าไม่รวม การแก้การจำแนกให้ถูกต้องขึ้นจะได้ id เดิม แล้ว
 * annotation ที่แก้ไขจะชนกับตัวเดิมจนไม่มีทาง supersede ได้
 */
export function annotationIdOf(input: Pick<EvidenceAdmissibilityAnnotationV1,
  "evidence_subject" | "affected_fields" | "admissibility" | "interpretation_scope" | "defect_classification">): string {
  const canonical = JSON.stringify([
    input.evidence_subject.store_id,
    input.evidence_subject.record_type,
    input.evidence_subject.record_id,
    [...input.affected_fields].sort(),
    input.admissibility,
    input.interpretation_scope,
    input.defect_classification,
  ]);
  return `adm-${createHash("sha256").update(canonical).digest("hex").slice(0, 32)}`;
}

function storeFile(): string {
  const override = process.env.EVIDENCE_ADMISSIBILITY_STORE;
  if (override !== undefined && override.length > 0) return override;
  return join(__dirname, "data", "evidence-admissibility.jsonl");
}

/** path ที่จะถูกเขียนจริง ณ ขณะนี้ — ใช้ยืนยันการแยกสโตร์ก่อนเขียน */
export function admissibilityStoreFile(): string { return storeFile(); }

export function listAnnotations(): readonly EvidenceAdmissibilityAnnotationV1[] {
  const p = storeFile();
  if (!existsSync(p)) return [];
  const rows: EvidenceAdmissibilityAnnotationV1[] = [];
  for (const line of readFileSync(p, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line) as EvidenceAdmissibilityAnnotationV1); } catch { /* แถวเสียข้ามไป ไม่ลบ */ }
  }
  return rows;
}

export type AppendOutcome =
  | { readonly ok: true; readonly annotation: EvidenceAdmissibilityAnnotationV1; readonly written: true }
  | { readonly ok: true; readonly annotation: EvidenceAdmissibilityAnnotationV1; readonly written: false; readonly reason: "ALREADY_PRESENT" };

/**
 * เพิ่มหนึ่ง annotation — append-only เสมอ
 *
 * annotation ที่มี id เดิมอยู่แล้วจะไม่ถูกเขียนซ้ำและไม่ถูกแก้ การรันซ้ำจึง
 * ไม่ทำให้สโตร์บวม และไม่มีเส้นทางใดในไฟล์นี้ที่แก้หรือลบแถวที่เขียนไปแล้ว
 */
export function appendAnnotation(input: AnnotateInput): AppendOutcome {
  const annotation: EvidenceAdmissibilityAnnotationV1 = {
    annotation_id: annotationIdOf(input),
    annotation_version: 1,
    ...input,
    affected_fields: [...input.affected_fields].sort(),
  };
  const existing = listAnnotations().find((a) => a.annotation_id === annotation.annotation_id);
  if (existing !== undefined) return { ok: true, annotation: existing, written: false, reason: "ALREADY_PRESENT" };
  const p = storeFile();
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, `${JSON.stringify(annotation)}\n`, "utf-8");
  return { ok: true, annotation, written: true };
}

export interface AdmissibilityQuery {
  readonly evidence_subject: EvidenceSubject;
  readonly field: string;
  readonly interpretation_scope: InterpretationScope;
}

export type AdmissibilityVerdict = Admissibility | "UNKNOWN";

/**
 * ตอบว่าฟิลด์นี้ของแถวนี้ ใช้ตอบคำถามแบบนี้ได้หรือไม่
 *
 * ไม่มี annotation ที่ตรง -> UNKNOWN **ไม่ใช่ ADMISSIBLE** เพราะสถิติที่สร้างจาก
 * "ไม่มีใครเคยบอกว่าเชื่อไม่ได้" คือสถิติที่ตั้งอยู่บนความเงียบ ผู้เรียกที่ทำงาน
 * เชิงสถิติหรือเชิงความปลอดภัยต้องตัดสินใจเองว่าจะทำอย่างไรกับ UNKNOWN
 *
 * annotation ที่ถูก supersede แล้วจะไม่ถูกนับ แต่ยังอยู่ในสโตร์ครบ
 */
export function isEvidenceFieldAdmissible(query: AdmissibilityQuery): AdmissibilityVerdict {
  const all = listAnnotations();
  const superseded = new Set(all.map((a) => a.supersedes_annotation_id).filter((id): id is string => typeof id === "string"));
  const matching = all.filter((a) =>
    !superseded.has(a.annotation_id)
    && a.evidence_subject.store_id === query.evidence_subject.store_id
    && a.evidence_subject.record_type === query.evidence_subject.record_type
    && a.evidence_subject.record_id === query.evidence_subject.record_id
    && a.interpretation_scope === query.interpretation_scope
    && a.affected_fields.includes(query.field));
  return matching.at(-1)?.admissibility ?? "UNKNOWN";
}
