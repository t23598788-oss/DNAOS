/**
 * หน้าที่: ด่านที่รันได้จริงของ Governance Gate ใน
 * `../architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 10 — เติมสามข้อที่
 * `./README.md` (G-VAL-004) ประกาศไว้เองว่า "ยังไม่มี mechanical checker"
 *
 * ทำไมอยู่ในโฟลเดอร์นี้ ไม่ใช่โฟลเดอร์ใหม่: G-VAL-004 คืองานของโฟลเดอร์นี้
 * และ `checkImportBoundaries()` ที่ตรวจข้อ 9 ก็อยู่ที่นี่แล้ว การตั้ง capability
 * ใหม่ขึ้นมาตรวจกฎเดียวกันคือ DUPLICATE ตามกฎข้อ 4/5 — ด่านที่ละเมิดกฎที่ตัวเอง
 * บังคับใช้ย่อมพิสูจน์อะไรไม่ได้
 *
 * ไม่มีการตัดสินของ AI ในเส้นทางนี้: ทุกข้อสรุปมาจากแถวในทะเบียนจริงหรือจาก
 * สิ่งที่มีอยู่บนดิสก์จริง `status` เป็นฟังก์ชันของ `failed_count` ล้วน ๆ
 *
 * "กลุ่มหลัก" ถูก *อนุมาน* จากทะเบียน ไม่ใช่รายชื่อที่พิมพ์ไว้: โฟลเดอร์แม่ของ
 * source_location ของ capability ที่ลงทะเบียนแล้ว คือกลุ่มหลักตามนิยามข้อ 3
 * การพิมพ์รายชื่อกลุ่มเองจะเป็นการเพิ่มกฎใหม่ที่เอกสารไม่ได้เขียนไว้
 *
 * ข้อ 10 แถว "ลบ capability ที่ยังมี dependency ค้าง" ตรวจจาก snapshot ไม่ได้
 * เพราะเป็นกฎของ *เหตุการณ์ลบ* ไม่ใช่คุณสมบัติของสถานะ — จึงประกาศไว้ใน
 * `not_snapshot_checkable` ไม่ใช่แกล้งนับว่าผ่าน
 *
 * Input: ทะเบียนจริง + ไฟล์จริงบนดิสก์.
 * Output: `runCapabilityFolderLawGate`.
 * Dependency ที่อนุญาต: ./boundary-checker.ts, ./types.ts,
 * ../../software/capability-registrar/contract.ts (public contract เท่านั้น),
 * node:fs, node:path.
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่มกฎโฟลเดอร์ที่เอกสารไม่ได้ประกาศ, ห้ามให้ผู้เรียก
 * ยกเว้นการละเมิด, ห้ามให้ status ขึ้นกับอย่างอื่นนอกจาก failed_count.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { inspectWriteOwnershipIndex } from "../../software/capability-registrar/contract";
import { checkImportBoundaries } from "./boundary-checker";
import type { FolderLawGateResult, FolderLawViolation, FolderLawRootCause } from "./types";

type RawFolderLawViolation = Omit<FolderLawViolation, "classification" | "classification_reason" | "root_cause"> & { root_cause?: FolderLawRootCause };

const GATE_ID = "capability-folder-law-gate";
const STAGE_ID = "capability-folder-law";
const LAW = "governance/architecture-rules/CAPABILITY_FOLDER_LAW.md";

/** นามสกุลที่นับว่าเป็น source ตามข้อ 2 — ไม่รวมเอกสารและข้อมูล */
const SOURCE_EXT = [".ts", ".tsx", ".mjs", ".cjs", ".js", ".py"];

function isSourceFile(name: string): boolean {
  return SOURCE_EXT.some((e) => name.endsWith(e));
}

/**
 * รันด่านทั้งด่านหนึ่งครั้ง
 *
 * `now` รับเข้ามาได้เพื่อให้เทสต์ประทับเวลาเองได้ ไม่ใช่เพื่อให้ผู้เรียกย้อนเวลา
 */
export function runCapabilityFolderLawGate(now: string = new Date().toISOString()): FolderLawGateResult {
  const violations: RawFolderLawViolation[] = [];
  const evidenceRefs = new Set<string>([LAW]);
  const index = inspectWriteOwnershipIndex();
  evidenceRefs.add("software/capability-registrar/write-ownership-index.ts#inspectWriteOwnershipIndex");

  // ── แถว 1: capability ที่ลงทะเบียนแล้วต้องมีโฟลเดอร์ของตัวเองที่มีอยู่จริง
  const subjectsRow1 = index.entries;
  for (const entry of subjectsRow1) {
    const abs = join(process.cwd(), entry.OWNED_PATH);
    const exists = existsSync(abs);
    const isDir = exists && statSync(abs).isDirectory();
    if (exists && isDir) continue;
    violations.push({
      rule_row: "CAPABILITY_WITHOUT_OWN_FOLDER", verdict: "REJECT",
      subject: entry.OWNED_PATH, capability_id: entry.CAPABILITY_ID,
      resource_id: entry.RESOURCE_ID, source_location: entry.OWNED_PATH,
      measured: exists ? "source_location ชี้ไปที่ไฟล์ ไม่ใช่โฟลเดอร์" : "โฟลเดอร์ที่ลงทะเบียนไว้ไม่มีอยู่จริงใน checkout นี้",
      evidence_ref: entry.OWNERSHIP_EVIDENCE_REF,
    });
  }

  // ── แถว 3: โฟลเดอร์เดียวถูกอ้างเป็นเจ้าของโดย capability ที่ต่างกัน
  for (const amb of index.ambiguous_paths) {
    violations.push({
      rule_row: "DUPLICATE_OR_OVERLAPPING_CAPABILITY", verdict: "BLOCK_AND_REVIEW",
      subject: amb.path, capability_id: amb.owners.join(" | "),
      resource_id: null, source_location: amb.path,
      measured: `${String(amb.owners.length)} capability อ้างเป็นเจ้าของเส้นทางเดียวกัน`,
      evidence_ref: "software/capability-registrar/write-ownership-index.ts#ambiguous_paths",
    });
  }

  /**
   * ── แถว 2: source file ที่อยู่นอกขอบเขต capability
   *
   * กลุ่มหลักถูกอนุมานจากทะเบียน: โฟลเดอร์แม่ของ source_location ที่ลงทะเบียนแล้ว
   * ไฟล์ source ที่วางอยู่ตรง ๆ ในกลุ่มหลัก (ไม่ได้อยู่ในโฟลเดอร์ความสามารถใด)
   * คือสิ่งที่ข้อ 2 ห้ามไว้ตรงตัว
   */
  const groups = new Set<string>();
  for (const entry of subjectsRow1) {
    const parent = dirname(entry.OWNED_PATH.replace(/\/$/, ""));
    if (parent !== "." && parent !== "" && parent !== "/") groups.add(parent);
  }
  let looseChecked = 0;
  let groupsScanned = 0;
  for (const group of [...groups].sort()) {
    const abs = join(process.cwd(), group);
    if (!existsSync(abs)) continue;
    groupsScanned++;
    for (const name of readdirSync(abs)) {
      if (!isSourceFile(name)) continue;
      const full = join(abs, name);
      if (!statSync(full).isFile()) continue;
      looseChecked++;
      violations.push({
        rule_row: "SOURCE_FILE_OUTSIDE_CAPABILITY_BOUNDARY", verdict: "REJECT",
        subject: `${group}/${name}`, capability_id: null, resource_id: null,
        source_location: `${group}/${name}`,
        measured: `ไฟล์ source วางอยู่ในกลุ่มหลัก ${group}/ โดยตรง ไม่ได้อยู่ในโฟลเดอร์ความสามารถใด`,
        evidence_ref: `${LAW}#ข้อ2`,
      });
    }
  }

  // ── แถว 4: ใช้ตัวตรวจเดิมที่มีอยู่แล้ว ไม่เขียนซ้ำ
  const boundary = checkImportBoundaries();
  evidenceRefs.add("governance/source-validation/boundary-checker.ts#checkImportBoundaries");
  for (const b of boundary) {
    violations.push({
      rule_row: "CROSS_CAPABILITY_INTERNAL_IMPORT", verdict: "REJECT",
      subject: b.from_file, capability_id: null, resource_id: null,
      source_location: b.from_file,
      measured: `${b.from_capability} import ตรงเข้า ${b.to_file} ของ ${b.to_capability} (${b.import_specifier})`,
      evidence_ref: `${LAW}#ข้อ9`,
      root_cause: b.to_file.includes("/adapters/") ? "ADAPTER_BYPASS" : b.to_file.endsWith("/types.ts") ? "INTERNAL_TYPE_BYPASS" : "PUBLIC_CONTRACT_BYPASS",
    });
  }
  for (const v of violations) evidenceRefs.add(v.evidence_ref);

  // No current exemption registry exists. Every finding is therefore a real
  // violation until an Owner-approved rule change supplies evidence for a
  // stale rule or legacy exemption. Classification is explicit so a future
  // exemption cannot silently turn a finding into PASS.
  const classifiedViolations = violations.map((v) => ({
    ...v,
    classification: "REAL_VIOLATION" as const,
    classification_reason: "current locked law applies; no approved stale-rule or legacy-exemption evidence exists",
    root_cause: v.root_cause ?? (v.rule_row === "DUPLICATE_OR_OVERLAPPING_CAPABILITY" ? "DUPLICATE_OWNERSHIP_REGISTRATION" : "PUBLIC_CONTRACT_BYPASS"),
  }));
  const classification_counts = {
    REAL_VIOLATION: classifiedViolations.length,
    STALE_RULE: 0,
    LEGACY_EXEMPTION: 0,
  } as const;
  const root_cause_counts = classifiedViolations.reduce((counts, violation) => {
    counts[violation.root_cause] += 1;
    return counts;
  }, {
    DUPLICATE_OWNERSHIP_REGISTRATION: 0,
    ADAPTER_BYPASS: 0,
    INTERNAL_TYPE_BYPASS: 0,
    PUBLIC_CONTRACT_BYPASS: 0,
  } as Record<FolderLawRootCause, number>);

  const subjectCount = subjectsRow1.length + index.ambiguous_paths.length + looseChecked + boundary.length;
  const failedCount = violations.length;

  return {
    gate_id: GATE_ID, stage_id: STAGE_ID, checked_at: now,
    subject_count: subjectCount,
    passed_count: Math.max(0, subjectCount - failedCount),
    failed_count: failedCount,
    violations: classifiedViolations, evidence_refs: [...evidenceRefs].sort(),
    checked_per_rule: {
      CAPABILITY_WITHOUT_OWN_FOLDER: subjectsRow1.length,
      SOURCE_FILE_OUTSIDE_CAPABILITY_BOUNDARY: groupsScanned,
      DUPLICATE_OR_OVERLAPPING_CAPABILITY: index.entries.length,
      CROSS_CAPABILITY_INTERNAL_IMPORT: boundary.length,
    },
    // สถานะเป็นฟังก์ชันของจำนวนการละเมิดเท่านั้น ไม่มีทางอื่นที่ทำให้ PASS
    status: failedCount === 0 ? "PASS" : "FAIL",
    classification_counts,
    root_cause_counts,
    not_snapshot_checkable: [
      "ลบ capability ที่ยังมี dependency ค้างไม่ได้ตรวจ (BLOCK) — เป็นกฎของเหตุการณ์ลบ ไม่ใช่คุณสมบัติของ snapshot",
      "ลบ capability หลัง dependency validation ผ่านแล้ว (อนุญาต) — เช่นเดียวกัน",
    ],
  };
}
