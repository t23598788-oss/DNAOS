/**
 * หน้าที่: ดัชนีย้อนกลับจาก "ขั้น" ไปยังของจริงที่ผูกกับขั้นนั้น — งานที่กำลังทำ
 * เหตุที่เปิดอยู่ และการตัดสินที่รอเจ้าของ (Owner, GENERIC INVARIANT).
 *
 * ทำไมเป็นดัชนีไม่ใช่ที่เก็บ: งาน เหตุ และการตัดสิน มีเจ้าของอยู่แล้วคนละที่
 * (work-continuation, incident-remediation, owner-command) การย้ายมาเก็บซ้ำที่นี่
 * จะสร้างความจริงชุดที่สองทันที ไฟล์นี้เก็บเฉพาะ "เส้นเชื่อม" คือ stage_id คู่กับ
 * ตัวชี้ไปของเดิม และมันเป็น append-only เหมือนดัชนีอื่นในระบบ
 *
 * เส้นเชื่อมถูกเขียนโดยผู้ที่รู้ตอนนั้น (ผู้สังเกตที่รายงานเหตุ) ไม่ใช่โดยการเดา
 * ย้อนหลังจากข้อความ — นั่นคือเหตุผลที่ผู้สังเกตต้องบันทึก lifecycle_stage_id
 *
 * Input: data/stage-links.jsonl.
 * Output: `recordStageLink`, `linksForStage`, `STAGE_LINKS_PATH`.
 * Dependency ที่อนุญาต: node:fs, node:path.
 * สิ่งที่ห้ามแตะ: ห้ามเก็บเนื้อของเหตุหรือของงานที่นี่, ห้ามแก้แถวเดิม.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const STAGE_LINKS_PATH = "control/operational-lifecycle/data/stage-links.jsonl";

/** ชนิดของสิ่งที่ผูกกับขั้น — ปิดตาย เพื่อให้ค่าคงที่ของ ORPHANED ตรวจได้แน่นอน */
export type StageLinkKind = "ACTIVE_WORK" | "INCIDENT" | "OWNER_DECISION";

export interface StageLink {
  readonly stage_id: string;
  readonly kind: StageLinkKind;
  /** ตัวชี้ไปที่ของเดิม: work_id / incident_id / decision_id */
  readonly ref: string;
  /** OPEN = ยังผูกอยู่, CLOSED = ปิดแล้ว ไม่นับเป็นทางออกอีก */
  readonly state: "OPEN" | "CLOSED";
  readonly recorded_at: string;
  readonly recorded_by: string;
}

export function recordStageLink(link: Omit<StageLink, "recorded_at"> & { recorded_at?: string }): StageLink {
  const row: StageLink = { ...link, recorded_at: link.recorded_at ?? new Date().toISOString() };
  const path = join(process.cwd(), STAGE_LINKS_PATH);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(row)}\n`, "utf8");
  return row;
}

export function loadStageLinks(): readonly StageLink[] {
  const path = join(process.cwd(), STAGE_LINKS_PATH);
  if (!existsSync(path)) return [];
  const out: StageLink[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try { out.push(JSON.parse(line) as StageLink); } catch { /* ข้ามแถวเสีย */ }
  }
  return out;
}

/**
 * เส้นเชื่อมที่ยังเปิดอยู่ของขั้นหนึ่ง
 * แถวหลังสุดของแต่ละ (kind, ref) เป็นตัวจริง — วิธีลดรูปเดียวกับ checkpoint เดิม
 */
export function linksForStage(stageId: string, rows: readonly StageLink[] = loadStageLinks()): readonly StageLink[] {
  const latest = new Map<string, StageLink>();
  for (const r of rows) {
    if (r.stage_id !== stageId) continue;
    latest.set(`${r.kind}:${r.ref}`, r);
  }
  return [...latest.values()].filter((r) => r.state === "OPEN");
}
