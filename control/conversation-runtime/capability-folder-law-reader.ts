/**
 * หน้าที่: PERSIST_FIRST_REAL_DNA_OS_MEASUREMENT PHASE 8/9 — the
 * CONVERSATION-SIDE reader for the Capability Folder Law compliance metric.
 * Reads ONLY `../conversation-read-model/contract.ts`'s stored
 * measurements — never `governance/source-validation/folder-law-gate.ts`
 * or its publisher, which never enter this process (see
 * `./tests/dependency-gate.test.ts`).
 *
 * Every number in every answer here is copied out of stored
 * `CapabilityFolderLawMeasurement` records or derived by
 * `compareCapabilityFolderLawMeasurements()` (pure arithmetic over stored
 * counts) — never the language model, never re-run against the real repo.
 *
 * Input: raw Owner text.
 * Output: `detectCapabilityFolderLawQuery`, `answerCapabilityFolderLawQuery`.
 * Dependency ที่อนุญาต: ../conversation-read-model/contract.ts.
 * สิ่งที่ห้ามแตะ: ห้าม import governance/source-validation/ เข้าไฟล์นี้ไม่ว่า
 * ทางใด. ห้ามเรียก runCapabilityFolderLawGate() จากที่นี่ไม่ว่ากรณีใด. ห้าม
 * เดา "อะไรเปลี่ยน" จาก count delta เพียงอย่างเดียว.
 */

import {
  compareCapabilityFolderLawMeasurements,
  latestCapabilityFolderLawMeasurement,
  previousCapabilityFolderLawMeasurement,
  type CapabilityFolderLawMeasurement,
} from "../conversation-read-model/contract";

export type CapabilityFolderLawQuestionKind = "CURRENT" | "PREVIOUS" | "TREND" | "CHANGES";

const KIND_PATTERNS: readonly { kind: CapabilityFolderLawQuestionKind; pattern: RegExp }[] = [
  { kind: "TREND", pattern: /ดีขึ้น.{0,10}หรือ.{0,10}แย่ลง|better or worse|improving/i },
  { kind: "CHANGES", pattern: /อะไรเปลี่ยน|what changed/i },
  { kind: "PREVIOUS", pattern: /ครั้งก่อน|previous (measurement|result)/i },
  { kind: "CURRENT", pattern: /folder law.{0,20}(ผ่าน|กี่)|capability folder law/i },
];

export function detectCapabilityFolderLawQuery(text: string): CapabilityFolderLawQuestionKind | null {
  for (const { kind, pattern } of KIND_PATTERNS) {
    if (pattern.test(text)) return kind;
  }
  return null;
}

function pct(m: CapabilityFolderLawMeasurement): number {
  return m.subject_count > 0 ? Math.round((m.passed_count / m.subject_count) * 10000) / 100 : 0;
}

function describeMeasurement(m: CapabilityFolderLawMeasurement): string {
  return `Capability Folder Law ตอนนี้ผ่าน ${m.passed_count} จาก ${m.subject_count} รายการ หรือ ${pct(m)}% `
    + `ยังไม่ผ่าน ${m.failed_count} รายการ วัดเมื่อ ${m.measured_at} จาก source revision ${m.source_revision ?? "UNKNOWN"}${m.source_dirty ? " (dirty)" : ""} `
    + `สถานะ gate โดยรวมยังเป็น ${m.gate_status}`;
}

export interface CapabilityFolderLawAnswer {
  readonly answer: string;
  readonly status: "ANSWERED" | "UNRESOLVED" | "DENIED";
  readonly evidence_refs: readonly string[];
  readonly measurement: unknown;
}

export function answerCapabilityFolderLawQuery(kind: CapabilityFolderLawQuestionKind): CapabilityFolderLawAnswer {
  const latest = latestCapabilityFolderLawMeasurement();
  if (!latest) {
    return {
      answer: "ยังไม่เคยมีการวัด Capability Folder Law compliance เลย — ต้องรัน governance/source-validation/publish-capability-folder-law-measurement.ts ก่อน",
      status: "DENIED",
      evidence_refs: [],
      measurement: null,
    };
  }

  if (kind === "CURRENT") {
    return { answer: describeMeasurement(latest), status: "ANSWERED", evidence_refs: [`measurement_id=${latest.measurement_id}`], measurement: latest };
  }

  const previous = previousCapabilityFolderLawMeasurement();
  if (!previous) {
    return {
      answer: `${describeMeasurement(latest)} — นี่เป็นการวัดครั้งแรก ยังไม่มีการวัดครั้งก่อนให้เทียบ`,
      status: "ANSWERED",
      evidence_refs: [`measurement_id=${latest.measurement_id}`],
      measurement: latest,
    };
  }

  const cmp = compareCapabilityFolderLawMeasurements(previous, latest);

  if (kind === "PREVIOUS") {
    return { answer: describeMeasurement(previous), status: "ANSWERED", evidence_refs: [`measurement_id=${previous.measurement_id}`], measurement: previous };
  }

  if (kind === "TREND") {
    const direction = cmp.percent_delta > 0 ? "ดีขึ้น" : cmp.percent_delta < 0 ? "แย่ลง" : "เท่าเดิม";
    return {
      answer: `ครั้งก่อนผ่าน ${previous.passed_count} จาก ${previous.subject_count} รายการ (${cmp.percent_a}%) ครั้งนี้ผ่าน ${latest.passed_count} จาก ${latest.subject_count} รายการ (${cmp.percent_b}%) — ${direction} ${Math.abs(cmp.percent_delta)} จุดเปอร์เซ็นต์ (จำนวนที่ผ่านเปลี่ยน ${cmp.passed_count_delta >= 0 ? "+" : ""}${cmp.passed_count_delta} รายการ, จำนวน subject ทั้งหมดเปลี่ยน ${cmp.subject_count_delta >= 0 ? "+" : ""}${cmp.subject_count_delta} รายการ)`,
      status: "ANSWERED",
      evidence_refs: [`measurement_id=${previous.measurement_id}`, `measurement_id=${latest.measurement_id}`],
      measurement: cmp,
    };
  }

  // CHANGES
  if (cmp.newly_passing === "UNKNOWN" || cmp.newly_failing === "UNKNOWN") {
    return {
      answer: "UNKNOWN — ไม่สามารถระบุได้แน่ชัดว่า requirement ตัวไหนเปลี่ยนสถานะ (ไม่เดาจาก count delta เพียงอย่างเดียว)",
      status: "UNRESOLVED",
      evidence_refs: [`measurement_id=${previous.measurement_id}`, `measurement_id=${latest.measurement_id}`],
      measurement: cmp,
    };
  }
  const parts: string[] = [];
  for (const ref of cmp.newly_passing) parts.push(`${ref}: FAIL → PASS`);
  for (const ref of cmp.newly_failing) parts.push(`${ref}: PASS → FAIL`);
  return {
    answer: parts.length > 0 ? `รายการที่เปลี่ยนสถานะ: ${parts.join("; ")}` : "ไม่มี requirement ใดเปลี่ยนสถานะระหว่างสองครั้งนี้",
    status: "ANSWERED",
    evidence_refs: [`measurement_id=${previous.measurement_id}`, `measurement_id=${latest.measurement_id}`],
    measurement: cmp,
  };
}
