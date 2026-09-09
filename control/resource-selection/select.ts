/**
 * หน้าที่: จับคู่ "ความสามารถที่งานต้องการ" กับ "ทรัพยากรที่ Owner มีจริง"
 * โดยอ่านจากทะเบียนกลาง ไม่ใช่จากรายชื่อที่ผู้เรียกหรือ Agent เขียนมา
 *
 * Owner, 2026-09-05: ห้าม Agent เลือก tool เอง และห้าม preload เครื่องมือทั้งหมด
 * ก่อนเข้าใจเจตนา ที่นี่จึงรับ "ความสามารถที่ต้องใช้" เข้ามา แล้วคืนเฉพาะ
 * ทรัพยากรที่ประกาศความสามารถนั้นไว้จริงและสถานะยัง REGISTERED
 *
 * ความสามารถที่ไม่มีใครประกาศไว้ = ช่องว่างจริง ต้องรายงานเป็น MISSING
 * ไม่ใช่เลือกตัวที่ใกล้เคียงมาแทน
 *
 * Input: รายชื่อความสามารถที่ต้องใช้
 * Output: SelectionResult — ที่เลือกได้ กับที่ขาด
 * Dependency ที่อนุญาต: node built-ins (อ่านทะเบียน canonical)
 * สิ่งที่ห้ามแตะ:
 * - ห้ามรับ resource_id จากผู้เรียก
 * - ห้ามคืนทรัพยากรที่สถานะไม่ใช่ REGISTERED
 * - ห้ามเดาว่าความสามารถที่ไม่พบ "น่าจะใช้ตัวนี้ได้"
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const CANONICAL = join(process.cwd(), "software/registry-database/data/canonical");

export interface SelectedResource {
  readonly capability: string;
  readonly resource_id: string;
  readonly resource_name: string;
  readonly entrypoint: string;
}

export interface SelectionResult {
  readonly required: readonly string[];
  readonly selected: readonly SelectedResource[];
  readonly missing: readonly string[];
  readonly considered_count: number;
}

interface Row { resource_id?: string; source_location?: string; status?: string; module?: unknown }

/** แถวหลังชนะ — ทรัพยากรที่ถูกแทนแล้วต้องไม่ถูกเลือก */
function lastWins(file: string, key: string): Map<string, any> {
  const out = new Map<string, any>();
  try {
    for (const line of readFileSync(join(CANONICAL, file), "utf-8").split("\n")) {
      if (line.trim() === "") continue;
      try { const r = JSON.parse(line); const id = r[key]; if (id) out.set(id, r); } catch { /* แถวเสียข้ามไป */ }
    }
  } catch { /* ไม่มีไฟล์ = ไม่มีทรัพยากร ไม่ใช่มีทุกอย่าง */ }
  return out;
}

/**
 * ความสามารถของทรัพยากรถูกบันทึกไว้ในฟิลด์ output ของ capability ที่ผูกกับมัน
 * (ดูการลงทะเบียนใน control/registration-pipeline/) จึงอ่านจากที่นั่น
 */
export function selectResourcesFor(required: readonly string[]): SelectionResult {
  const resources = lastWins("resources.jsonl", "resource_id");
  const capabilities = lastWins("capabilities.jsonl", "capability_id");
  const links: { resource_id?: string; capability_id?: string }[] = [];
  try {
    for (const line of readFileSync(join(CANONICAL, "resource_capabilities.jsonl"), "utf-8").split("\n")) {
      if (line.trim() === "") continue;
      try { links.push(JSON.parse(line)); } catch { /* ข้าม */ }
    }
  } catch { /* ไม่มีลิงก์ */ }

  const selected: SelectedResource[] = [];
  const missing: string[] = [];

  for (const cap of required) {
    let hit: SelectedResource | null = null;
    for (const link of links) {
      const resource = link.resource_id ? resources.get(link.resource_id) : null;
      const capability = link.capability_id ? capabilities.get(link.capability_id) : null;
      if (!resource || !capability) continue;
      if (String(resource.status) !== "REGISTERED") continue;
      /**
       * ตัวตนของความสามารถคือ `canonical_name` ของแถว capability ซึ่งเป็นชื่อที่
       * pipeline เขียนลงทะเบียนจริง ไม่ใช่ฟิลด์ `output` ที่ผู้ยื่นส่งเข้ามา
       * (ตรวจแล้ว 2026-09-05: แถวจริงมี canonical_name/output_contract ส่วน
       * output เป็น null เสมอ) เทียบชื่อตรง ๆ ไม่มีการจับคู่แบบใกล้เคียง
       */
      const declaredName = String(capability.canonical_name ?? "");
      const declaredOut: string[] = Array.isArray(capability.output_contract) ? capability.output_contract.map(String) : [];
      if (declaredName !== cap && !declaredOut.includes(cap)) continue;
      hit = { capability: cap, resource_id: String(resource.resource_id),
        resource_name: declaredName || String(resource.resource_id),
        entrypoint: String(resource.source_location ?? "") };
      break;
    }
    if (hit) selected.push(hit); else missing.push(cap);
  }
  return { required, selected, missing, considered_count: resources.size };
}
