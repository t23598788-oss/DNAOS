/**
 * หน้าที่: ประกาศว่าฟิลด์ใดของแถวหลักฐาน boot ในอดีตใช้ตอบคำถามใดไม่ได้
 * โดยไม่แตะแถวเดิม
 *
 * ── ทำไมต้องมี ──
 * ตัวเขียนหลักฐาน boot รุ่นก่อน 2026-08-29 แต่งค่าไว้ห้าจุด ผลที่ร้ายที่สุดคือ
 * `health_before` ถูกเขียนตายตัวเป็น `healthy:false` ทุกแถว ทั้งที่ 63 จาก 64 แถว
 * เป็นกรณี "วัดแล้วว่า healthy จึงไม่แตะ" ใครที่อ่านประวัตินี้เพื่อนับว่าบริการ
 * ล่มตอนบูตกี่ครั้ง จะนับเจอ 63 ครั้งที่ไม่เคยเกิดขึ้น
 *
 * ── ค้นแถวด้วยเครื่องหมายที่กำหนดผลได้ ไม่ใช่การเดาด้วยเวลา ──
 * ตัวเขียนรุ่นเก่าใส่ `health_before.error === "pre-boot probe"` ตรงตัวทุกแถว
 * นั่นคือลายเซ็นของมันเอง การจับกลุ่มด้วยช่วงเวลาให้คำตอบที่ขัดกัน (แถวบอก 8 รอบ
 * log บอก 6 เวลาบอก 7) จึงใช้ไม่ได้
 *
 * ── ไม่แต่งค่าที่ถูกต้อง ──
 * ไม่มี corrected_health_before ไม่มี estimated_timestamp_started ค่าที่วัด
 * ย้อนหลังไม่ได้คือวัดไม่ได้
 *
 * Input: `--dry-run` (ไม่เขียน), ไม่มีอย่างอื่น
 * Output: สรุป และแถว annotation ที่เขียนผ่าน ./evidence-admissibility.ts
 * Dependency ที่อนุญาต: ./evidence-admissibility.ts, node:fs, node:path, node:crypto
 * สิ่งที่ห้ามแตะ: ห้ามเปิดไฟล์หลักฐานเพื่อเขียน ห้ามตีตราแถวที่ไม่มีลายเซ็นนี้
 * และห้าม annotate ฟิลด์ที่หลักฐานไม่ได้พิสูจน์ว่าเสีย
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { appendAnnotation, admissibilityStoreFile } from "./evidence-admissibility";
import type { AnnotateInput, DefectClassification, InterpretationScope } from "./evidence-admissibility";

const OPS_STORE = process.env.RUNTIME_CONTROL_DATA_DIR
  ? join(process.env.RUNTIME_CONTROL_DATA_DIR, "operations.jsonl")
  : join(process.cwd(), "control/runtime-control/data/operations.jsonl");

/** ลายเซ็นของตัวเขียนรุ่นที่มีข้อบกพร่อง — ตรงตัว ไม่ใช่การเดา */
const DEFECT_MARKER = "pre-boot probe";

const EVIDENCE_REFS = [
  "control/runtime-control/boot-orchestrator.ts#writeBootEvidence (รุ่นก่อน 2026-08-29)",
  "control/runtime-control/tests/boot-evidence-parity.test.ts",
];

interface FieldPlan {
  readonly field: string;
  readonly scope: InterpretationScope;
  readonly defect: DefectClassification;
  /** จริงเมื่อแถวนี้ได้รับผลจากข้อบกพร่องนี้จริง — ไม่ตีตราค่าที่วัดมาถูกต้อง */
  readonly appliesTo: (row: Record<string, unknown>) => boolean;
}

const PLANS: readonly FieldPlan[] = [
  {
    // ค่าที่วัดมาแล้วถูกทิ้งแล้วเขียนค่าคงที่ทับ — ไม่ใช่แค่ค่าที่ไม่ได้วัด
    field: "health_before", scope: "BOOT_FAILURE_STATISTICS",
    defect: "MEASURED_VALUE_DISCARDED_AND_REPLACED", appliesTo: () => true,
  },
  {
    // ไม่เคยเรียก getListeningPids เลย ผลการตรวจที่รายงานไว้จึงไม่เคยเกิดขึ้น
    field: "duplicate_check", scope: "DUPLICATE_LISTENER_HISTORY",
    defect: "FABRICATED_MEASUREMENT", appliesTo: () => true,
  },
  {
    // ประทับตอนเขียน ไม่ใช่ตอนเริ่ม — แถว start พิสูจน์ตัวเอง: ช่วงเวลา 6ms
    // แต่ readiness_wait_ms = 1027
    field: "timestamp_started", scope: "BOOT_ATTEMPT_DURATION_ANALYSIS",
    defect: "INACCURATE_TIMESTAMP", appliesTo: () => true,
  },
  {
    // อนุมานจาก pid ทั้งที่ launchd.loaded ถูกวัดมาแล้วและถูกทิ้ง
    field: "launchd_loaded_before", scope: "PRE_BOOT_LAUNCHD_STATE_HISTORY",
    defect: "INFERRED_NOT_MEASURED", appliesTo: () => true,
  },
  {
    // ข้อบกพร่องนี้อยู่ในเส้นทาง FAILED เท่านั้น (คัดลอก readiness_timeout_ms
    // ลงช่องที่สัญญาบอกว่าเป็นค่าที่สังเกตได้) แถว SUCCESS ถือค่าที่วัดจริง
    // การตีตราแถว SUCCESS ด้วยจะเป็นการประกาศว่าค่าที่ถูกต้องนั้นเชื่อไม่ได้
    field: "readiness_wait_ms", scope: "READINESS_DURATION_HISTORY",
    defect: "CONFIGURED_VALUE_RECORDED_AS_OBSERVED",
    appliesTo: (row) => row.result === "FAILED",
  },
];

function main(): void {
  const dryRun = process.argv.includes("--dry-run");
  if (!existsSync(OPS_STORE)) { console.log(`ไม่พบสโตร์หลักฐาน: ${OPS_STORE}`); process.exit(1); }

  const raw = readFileSync(OPS_STORE, "utf-8");
  const digestBefore = createHash("sha256").update(raw).digest("hex");
  const rows = raw.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as Record<string, unknown>);
  const affected = rows.filter((r) => ((r.health_before as { error?: string } | undefined)?.error) === DEFECT_MARKER);

  console.log(`สโตร์หลักฐาน   : ${OPS_STORE}`);
  console.log(`สโตร์ annotation: ${admissibilityStoreFile()}`);
  console.log(`แถวทั้งหมด      : ${rows.length}`);
  console.log(`แถวที่มีลายเซ็น  : ${affected.length}  (health_before.error === "${DEFECT_MARKER}")`);

  let written = 0, already = 0, skipped = 0;
  for (const row of affected) {
    for (const plan of PLANS) {
      if (!plan.appliesTo(row)) { skipped += 1; continue; }
      const input: AnnotateInput = {
        evidence_subject: {
          store_id: "control/runtime-control#operations",
          record_type: "OperationEvidence",
          record_id: String(row.operation_id),
        },
        affected_fields: [plan.field],
        admissibility: "NOT_ADMISSIBLE",
        interpretation_scope: plan.scope,
        defect_classification: plan.defect,
        evidence_refs: EVIDENCE_REFS,
        created_at: new Date().toISOString(),
      };
      if (dryRun) { written += 1; continue; }
      const outcome = appendAnnotation(input);
      if (outcome.written) written += 1; else already += 1;
    }
  }

  const digestAfter = createHash("sha256").update(readFileSync(OPS_STORE, "utf-8")).digest("hex");
  console.log(`\nannotation เขียนใหม่ : ${written}`);
  console.log(`มีอยู่แล้ว ไม่เขียนซ้ำ : ${already}`);
  console.log(`ข้าม (ข้อบกพร่องไม่ตรงกับแถวนี้) : ${skipped}`);
  console.log(`แถวหลักฐานเดิมที่ถูกแก้ : 0`);
  console.log(`แถวหลักฐานเดิมที่ถูกลบ  : 0`);
  console.log(`digest สโตร์หลักฐาน ${digestBefore === digestAfter ? "เท่าเดิม" : "เปลี่ยน (!!)"} : ${digestBefore.slice(0, 16)}`);
  if (digestBefore !== digestAfter) process.exit(1);
}

main();
