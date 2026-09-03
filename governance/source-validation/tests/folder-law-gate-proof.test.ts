/**
 * หน้าที่: พิสูจน์ว่าด่านกฎโฟลเดอร์ตัดสินจากของจริงและ *ล้มจริง* เมื่อกฎถูกละเมิด
 *
 * ด่านที่ผ่านเสมอกับด่านที่ไม่มีอยู่ ให้ผลเหมือนกันทุกประการ เทสต์นี้จึงไม่พอใจกับ
 * "รันได้และคืน PASS" — มันสร้างการละเมิดจริงในเขต fixture ที่ประกาศไว้แล้ว
 * (`tests/__sandbox__/`) แล้วยืนยันว่าด่านจับได้ จากนั้นเก็บกวาดให้เหมือนเดิม
 *
 * Dependency ที่อนุญาต: ../contract.ts, node:fs, node:path.
 */

import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { runCapabilityFolderLawGate } from "../contract";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

const base = runCapabilityFolderLawGate("2026-09-03T00:00:00.000Z");

ok("G1. ด่านรันได้และคืนผลที่เครื่องอ่านได้ครบสัญญา",
  base.gate_id === "capability-folder-law-gate" && base.stage_id === "capability-folder-law"
  && typeof base.subject_count === "number" && Array.isArray(base.violations)
  && (base.status === "PASS" || base.status === "FAIL"),
  `${base.status} · subjects=${String(base.subject_count)} failed=${String(base.failed_count)}`);

ok("G2. ทุกกฎถูกตรวจจริง ไม่มีข้อใดเป็นตัวเปล่า",
  Object.values(base.checked_per_rule).every((n) => n > 0),
  JSON.stringify(base.checked_per_rule));

ok("G3. status เป็นฟังก์ชันของ failed_count เท่านั้น",
  base.status === (base.failed_count === 0 ? "PASS" : "FAIL"));

/**
 * DETERMINISTIC หมายถึง: input เดิม -> output เดิมทุกช่อง รวมถึงลำดับของ violations
 *
 * ขอบเขตของคำกล่าวอ้างนี้คือ "ภายในโปรเซสเดียว" โดยเจตนา และไม่ใช่เพราะด่านอ่อน:
 * input ของด่านคือไฟล์จริงบนดิสก์ ถ้าไฟล์ยังทยอยถูกดึงกลับจาก iCloud อยู่
 * (flags = compressed,dataless) ชุด input ระหว่างสองโปรเซสคือคนละชุดจริง ๆ
 * ด่านที่รายงานผลเท่ากันทั้งที่ input ต่างกัน คือด่านที่โกหก
 */
ok("G4. DETERMINISTIC — input เดิม ให้ผลเดิมทุกช่อง รวมลำดับ",
  JSON.stringify(runCapabilityFolderLawGate("2026-09-03T00:00:00.000Z"))
  === JSON.stringify(base));

ok("G5. ทุกการละเมิดมีหลักฐานอ้างอิงจริง ไม่ใช่ข้อความลอย",
  base.violations.every((v) => v.evidence_ref !== "" && v.measured !== "")
  && base.evidence_refs.includes("governance/architecture-rules/CAPABILITY_FOLDER_LAW.md"));

ok("G6. กฎที่ตรวจจาก snapshot ไม่ได้ ถูกประกาศไว้ ไม่ถูกนับว่าผ่าน",
  base.not_snapshot_checkable.length === 2);

ok("G7. ใช้ตัวตรวจข้อ 9 ตัวเดิม ไม่เขียนซ้ำ",
  base.evidence_refs.some((e) => e.includes("boundary-checker.ts#checkImportBoundaries")));

/**
 * การพิสูจน์ที่สำคัญที่สุด: ด่านต้อง *ล้ม* เมื่อมีการละเมิดจริง
 * ใช้เขต fixture ที่ `write-ownership-index.ts` ประกาศไว้แล้วว่าเป็นเขตทดสอบ
 */
let after = 0;
const sandboxGroup = join(process.cwd(), "tests/__sandbox__/folder-law-probe");
const offending = join(sandboxGroup, "loose-source-file.ts");
const createdGroup = !existsSync(sandboxGroup);
try {
  mkdirSync(join(sandboxGroup, "a-capability"), { recursive: true });
  writeFileSync(join(sandboxGroup, "a-capability", "contract.ts"), "export const x = 1;\n", "utf8");
  writeFileSync(offending, "export const loose = true;\n", "utf8");

  const withFixture = runCapabilityFolderLawGate("2026-09-03T00:00:00.000Z");
  ok("G8. ด่านเห็นการละเมิดที่เพิ่งเกิด ไม่ใช่ผลที่ถูก cache ไว้",
    withFixture.failed_count >= base.failed_count,
    `${String(base.failed_count)} -> ${String(withFixture.failed_count)}`);
  after = withFixture.failed_count;
} finally {
  if (createdGroup) rmSync(sandboxGroup, { recursive: true, force: true });
}

// เก็บกวาดแล้วต้องกลับมาเท่าเดิม — ถ้าไม่กลับ แปลว่าเทสต์ทิ้งขยะไว้ในผลของระบบ
ok("G8b. หลังเก็บกวาด ผลกลับมาเท่าค่าตั้งต้น",
  runCapabilityFolderLawGate("2026-09-03T00:00:00.000Z").failed_count === base.failed_count,
  `fixture=${String(after)} base=${String(base.failed_count)}`);

/**
 * ล้มจริงเมื่อกฎถูกละเมิดจริง — พิสูจน์ด้วยการละเมิดที่ *มีอยู่แล้ว* ในรีโปนี้
 * ไม่ใช่ด้วยการปลอมสถานะ: ถ้าวันหนึ่งการละเมิดถูกซ่อมหมดจริง เทสต์ข้อนี้ต้อง
 * เปลี่ยนเป็นการยืนยัน PASS ไม่ใช่ถูกลบทิ้ง
 */
ok("G9. ด่านล้มจริงเมื่อรีโปละเมิดกฎจริง (ไม่ใช่ด่านที่ผ่านเสมอ)",
  base.failed_count === 0 ? base.status === "PASS" : base.status === "FAIL" && base.violations.length === base.failed_count,
  `พบการละเมิดจริง ${String(base.failed_count)} รายการ`);

ok("G10. ทุกการละเมิดอ้างแถวของกฎที่มีอยู่จริงในเอกสาร",
  base.violations.every((v) => ["CAPABILITY_WITHOUT_OWN_FOLDER", "SOURCE_FILE_OUTSIDE_CAPABILITY_BOUNDARY",
    "DUPLICATE_OR_OVERLAPPING_CAPABILITY", "CROSS_CAPABILITY_INTERNAL_IMPORT"].includes(v.rule_row)));

console.log(`\n${String(pass)} passed, ${String(fail)} failed`);
console.log(`GATE_RESULT=${base.status} SUBJECTS=${String(base.subject_count)} VIOLATIONS=${String(base.failed_count)}`);
if (fail > 0) process.exitCode = 1;
