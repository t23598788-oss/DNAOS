/**
 * CASE A–N: การรับฟังหลักฐานระดับฟิลด์
 *
 * เทสต์ทั้งหมดใช้สโตร์ annotation ในไดเรกทอรีชั่วคราว และยืนยัน path ก่อนเขียน
 * แถวแรก ตามบทเรียน 2026-08-28 ที่หลักฐาน 187 แถวหายเพราะ path ถูกผูกตอน import
 */
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  annotationIdOf, appendAnnotation, listAnnotations, isEvidenceFieldAdmissible, admissibilityStoreFile,
} from "../evidence-admissibility";
import type { AnnotateInput, EvidenceSubject } from "../evidence-admissibility";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail?: unknown): void => {
  if (ok) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}`); if (detail !== undefined) console.log(`      ${JSON.stringify(detail)}`); }
};

const PROD_OPS = join(process.cwd(), "control/runtime-control/data/operations.jsonl");
const opsRaw = existsSync(PROD_OPS) ? readFileSync(PROD_OPS, "utf-8") : "";
const opsDigestBefore = createHash("sha256").update(opsRaw).digest("hex");
const opsLinesBefore = opsRaw.split("\n").filter((l) => l.trim()).length;

const SANDBOX = mkdtempSync(join(tmpdir(), "dna-adm-"));
process.env.EVIDENCE_ADMISSIBILITY_STORE = join(SANDBOX, "annotations.jsonl");
const active = admissibilityStoreFile();
check("ISOLATION  สโตร์ annotation ที่ใช้จริงอยู่ในแซนด์บ็อกซ์", active.startsWith(SANDBOX), active);
if (!active.startsWith(SANDBOX)) {
  console.log("\nหยุดทันที: การแยกสโตร์ล้มเหลว จะไม่เขียนอะไรทั้งสิ้น");
  console.log(`${pass} passed, ${fail + 1} failed`); process.exit(1);
}

const SUBJECT: EvidenceSubject = {
  store_id: "control/runtime-control#operations", record_type: "OperationEvidence", record_id: "op-abc-123",
};
const base = (over: Partial<AnnotateInput> = {}): AnnotateInput => ({
  evidence_subject: SUBJECT,
  affected_fields: ["health_before"],
  admissibility: "NOT_ADMISSIBLE",
  interpretation_scope: "BOOT_FAILURE_STATISTICS",
  defect_classification: "MEASURED_VALUE_DISCARDED_AND_REPLACED",
  evidence_refs: ["ref-1"],
  created_at: "2026-08-29T00:00:00.000Z",
  ...over,
});

// ---- A/B/C/D: ตัวตนที่กำหนดผลได้ ------------------------------------------
check("CASE A  ความหมายเดียวกัน -> annotation_id เดียวกัน",
  annotationIdOf(base()) === annotationIdOf(base({ created_at: "2027-01-01T00:00:00.000Z", evidence_refs: ["อื่น"] })));
{
  const reordered = { ...base(), affected_fields: ["health_before"] };
  const keysSwapped = {
    defect_classification: base().defect_classification, evidence_subject: base().evidence_subject,
    interpretation_scope: base().interpretation_scope, admissibility: base().admissibility,
    affected_fields: base().affected_fields,
  } as AnnotateInput;
  check("CASE B  สลับลำดับคีย์/ลำดับฟิลด์ -> annotation_id เดิม",
    annotationIdOf(reordered) === annotationIdOf(keysSwapped)
    && annotationIdOf(base({ affected_fields: ["b", "a"] })) === annotationIdOf(base({ affected_fields: ["a", "b"] })));
}
check("CASE C  ฟิลด์ต่างกัน -> annotation_id ต่างกัน",
  annotationIdOf(base()) !== annotationIdOf(base({ affected_fields: ["duplicate_check"] })));
check("CASE D  ขอบเขตการตีความต่างกัน -> annotation_id ต่างกัน",
  annotationIdOf(base()) !== annotationIdOf(base({ interpretation_scope: "DUPLICATE_LISTENER_HISTORY" })));
check("       ระเบียนต่างแถว -> annotation_id ต่างกัน",
  annotationIdOf(base()) !== annotationIdOf(base({ evidence_subject: { ...SUBJECT, record_id: "op-other" } })));
check("       การจำแนกข้อบกพร่องต่างกัน -> annotation_id ต่างกัน (แก้ให้ถูกแล้ว supersede ได้)",
  annotationIdOf(base()) !== annotationIdOf(base({ defect_classification: "FABRICATED_MEASUREMENT" })));

// ---- E: เขียน annotation ไม่แตะหลักฐานเดิม ----------------------------------
appendAnnotation(base());
appendAnnotation(base({ affected_fields: ["duplicate_check"], interpretation_scope: "DUPLICATE_LISTENER_HISTORY", defect_classification: "FABRICATED_MEASUREMENT" }));
const opsAfterAppend = existsSync(PROD_OPS) ? readFileSync(PROD_OPS, "utf-8") : "";
check("CASE E  เขียน annotation แล้วสโตร์หลักฐานเดิมไม่ถูกแก้",
  opsAfterAppend.length >= opsRaw.length && opsAfterAppend.startsWith(opsRaw),
  { before: opsRaw.length, after: opsAfterAppend.length });

// ---- F/G/H: ระดับฟิลด์ ไม่ลามทั้งแถว -----------------------------------------
check("CASE F  health_before + BOOT_FAILURE_STATISTICS -> NOT_ADMISSIBLE",
  isEvidenceFieldAdmissible({ evidence_subject: SUBJECT, field: "health_before", interpretation_scope: "BOOT_FAILURE_STATISTICS" }) === "NOT_ADMISSIBLE");
check("CASE G  service_id ในแถวเดียวกันไม่ถูกปฏิเสธอัตโนมัติ",
  isEvidenceFieldAdmissible({ evidence_subject: SUBJECT, field: "service_id", interpretation_scope: "BOOT_FAILURE_STATISTICS" }) === "UNKNOWN");
check("CASE H  duplicate_check เชื่อไม่ได้ ไม่ทำให้ result เชื่อไม่ได้",
  isEvidenceFieldAdmissible({ evidence_subject: SUBJECT, field: "duplicate_check", interpretation_scope: "DUPLICATE_LISTENER_HISTORY" }) === "NOT_ADMISSIBLE"
  && isEvidenceFieldAdmissible({ evidence_subject: SUBJECT, field: "result", interpretation_scope: "DUPLICATE_LISTENER_HISTORY" }) === "UNKNOWN");
check("       ฟิลด์เดิม ขอบเขตอื่น -> UNKNOWN (ไม่ลามข้ามการตีความ)",
  isEvidenceFieldAdmissible({ evidence_subject: SUBJECT, field: "health_before", interpretation_scope: "READINESS_DURATION_HISTORY" }) === "UNKNOWN");

// ---- I/J: ไม่รู้ ต้องเป็น UNKNOWN ไม่ใช่ ADMISSIBLE ---------------------------
check("CASE I  ระเบียนที่ไม่มี annotation -> UNKNOWN",
  isEvidenceFieldAdmissible({ evidence_subject: { ...SUBJECT, record_id: "op-ไม่เคยมี" }, field: "health_before", interpretation_scope: "BOOT_FAILURE_STATISTICS" }) === "UNKNOWN");
check("CASE J  ฟิลด์/ขอบเขตที่ไม่รู้จัก -> UNKNOWN ไม่ใช่ ADMISSIBLE",
  isEvidenceFieldAdmissible({ evidence_subject: SUBJECT, field: "ฟิลด์ที่ไม่มีอยู่", interpretation_scope: "BOOT_ATTEMPT_DURATION_ANALYSIS" }) === "UNKNOWN");

// ---- K: supersede ไม่ทับของเดิม ---------------------------------------------
{
  const original = listAnnotations().find((a) => a.affected_fields[0] === "health_before")!;
  const rowsBefore = listAnnotations().length;
  appendAnnotation(base({ admissibility: "ADMISSIBLE", defect_classification: "INFERRED_NOT_MEASURED", supersedes_annotation_id: original.annotation_id }));
  const after = listAnnotations();
  const stillThere = after.find((a) => a.annotation_id === original.annotation_id);
  check("CASE K  annotation ใหม่ที่ supersede ไม่ลบและไม่แก้ตัวเดิม",
    after.length === rowsBefore + 1 && JSON.stringify(stillThere) === JSON.stringify(original), { rowsBefore, after: after.length });
  check("CASE K  ตัวที่ถูก supersede ไม่ถูกนับในคำตอบอีกต่อไป",
    isEvidenceFieldAdmissible({ evidence_subject: SUBJECT, field: "health_before", interpretation_scope: "BOOT_FAILURE_STATISTICS" }) === "ADMISSIBLE");
}
{
  const before = listAnnotations().length;
  const again = appendAnnotation(base());
  check("       เขียนซ้ำ id เดิม -> ไม่เพิ่มแถว ไม่แก้ของเดิม",
    !again.written && listAnnotations().length === before, { before, after: listAnnotations().length });
}

// ---- L: ไม่มีการแต่งค่าที่ถูกต้องขึ้นมา -----------------------------------------
check("CASE L  ไม่มีฟิลด์ใดในสโตร์ที่เป็นค่าที่สร้างขึ้นแทนค่าเดิม",
  !/corrected_|estimated_|inferred_value|reconstructed_|actual_health_before/.test(readFileSync(active, "utf-8")));

// ---- M/N: production ---------------------------------------------------------
{
  const raw = existsSync(PROD_OPS) ? readFileSync(PROD_OPS, "utf-8") : "";
  const markers = (raw.match(/pre-boot probe/g) ?? []).length;
  check("CASE M  แถวที่มีลายเซ็นข้อบกพร่องยังเป็น 64 แถวเท่าเดิม", markers === 64, markers);
  check("CASE N  สโตร์หลักฐาน production: prefix เดิมไม่ถูกแก้ และไม่มีแถวหาย",
    raw.startsWith(opsRaw) && raw.split("\n").filter((l) => l.trim()).length >= opsLinesBefore,
    { before: opsLinesBefore, after: raw.split("\n").filter((l) => l.trim()).length });
  check("CASE N  ไม่มี annotation รั่วเข้าไปในสโตร์หลักฐาน",
    !raw.includes("annotation_id") && !raw.includes("NOT_ADMISSIBLE"));
  check("       digest ของ prefix เดิมยังตรงกัน",
    createHash("sha256").update(raw.slice(0, opsRaw.length)).digest("hex") === opsDigestBefore);
}

console.log(`\nแซนด์บ็อกซ์: ${active}  (${listAnnotations().length} annotation)`);
console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
