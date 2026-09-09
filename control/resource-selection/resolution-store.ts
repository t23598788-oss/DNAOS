/**
 * หน้าที่: บันทึกผลการหาทรัพยากรของแต่ละคำสั่ง ให้ /owner/activity อ่านได้
 *
 * Owner, 2026-09-05 ข้อ 8: หน้าจอห้ามประกอบสถานะขึ้นจาก transcript ของ Agent
 * สถานะจึงต้องมีที่เก็บของตัวเอง คีย์ด้วย command_id ซึ่งเป็นคีย์เดียวกับที่
 * ทุกชั้นใช้อยู่แล้ว
 *
 * Input: ผลการ resolve เจตนา + ผลการเลือกทรัพยากร
 * Output: แถวใน ./data/resource-resolutions.jsonl (append-only, แถวหลังชนะ)
 * Dependency ที่อนุญาต: node built-ins
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเก็บ token/credential/หัวข้อเมลจริง — เก็บได้แค่ตัวนับและตัวชี้
 * - ห้ามลบแถว
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const RESOLUTION_FILE: string = join(HERE, "data", "resource-resolutions.jsonl");

export interface ResourceExecution {
  readonly resource_execution_id: string;
  readonly resource_id: string;
  readonly capability_id: string;
  readonly tool_name: string;
  readonly started_at: string;
  readonly finished_at: string | null;
  readonly duration_ms: number | null;
  readonly status: "STARTED" | "COMPLETED" | "FAILED" | "BLOCKED";
  readonly read_write_class: string;
  readonly result_summary: string | null;
  readonly error_code: string | null;
}

export interface ResourceResolutionRecord {
  readonly selection_id: string;
  readonly command_id: string;
  readonly work_id: string | null;
  readonly intent_status: "RESOLVED" | "UNRESOLVED";
  readonly required_capabilities: readonly string[];
  readonly selected_resources: readonly { resource_id: string; capability_id: string; canonical_name: string; access_method: string; reason_selected: string }[];
  readonly unresolved_capabilities: readonly string[];
  readonly executions: readonly ResourceExecution[];
  readonly agent_invoked: boolean;
  readonly recorded_at: string;
}

export function recordResolution(record: ResourceResolutionRecord): void {
  mkdirSync(dirname(RESOLUTION_FILE), { recursive: true });
  appendFileSync(RESOLUTION_FILE, `${JSON.stringify(record)}\n`, "utf-8");
}

/** แถวหลังชนะสำหรับ command นี้ — ไม่มีแถว = คำสั่งนี้ไม่เคยผ่านการหาทรัพยากร */
export function resolutionFor(commandId: string): ResourceResolutionRecord | null {
  if (!existsSync(RESOLUTION_FILE)) return null;
  let found: ResourceResolutionRecord | null = null;
  for (const line of readFileSync(RESOLUTION_FILE, "utf-8").split("\n")) {
    if (line.trim() === "") continue;
    try { const r = JSON.parse(line) as ResourceResolutionRecord; if (r.command_id === commandId) found = r; }
    catch { /* แถวเสียข้ามไป */ }
  }
  return found;
}
