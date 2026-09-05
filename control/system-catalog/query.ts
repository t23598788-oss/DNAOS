/**
 * หน้าที่: ตัวอ่าน catalog ของระบบเดิม — ตอบคำถามสถาปัตยกรรมโดยไม่ต้องเปิด source
 *
 * Owner, 2026-09-05 ข้อ 18-19: canonical record ต้องมาก่อน markdown และเป้าหมาย
 * คือเมื่อ catalog เสร็จ Agent ไม่ต้องอ่าน source เพื่อรู้สถาปัตยกรรมอีก
 * source เหลือไว้ใช้เฉพาะการยืนยัน การแก้ และการเจาะลึก implementation
 *
 * catalog นี้สกัดจากโครงสร้างจริงของ ~/Desktop/dna-os-deadboard เมื่อ 2026-09-05
 * ไม่ได้เดาจากเอกสาร ทุกแถวมี source_path ชี้กลับไปยังไฟล์จริง
 *
 * ข้อจำกัดที่ต้องรู้: การสกัดอ่านรูปแบบที่พบบ่อย (`.from("table")`, `.rpc("fn")`,
 * `export async function GET`) การเรียกที่เขียนด้วยรูปแบบอื่นจะไม่ถูกจับ —
 * catalog จึงเป็น "อย่างน้อยเท่านี้" ไม่ใช่ "ครบเท่านี้" ดู coverage ใน README
 *
 * Input: คำถามเชิงโครงสร้าง
 * Output: แถวจาก ./data/*.jsonl
 * Dependency ที่อนุญาต: node built-ins
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเติมข้อมูลที่การสกัดไม่ได้เห็นจริง
 * - ห้ามให้ markdown เป็นแหล่งความจริง
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "data");

export interface CatalogComponent {
  readonly component_id: string;
  readonly component_type: "UI_PAGE" | "API_ROUTE" | "EDGE_FUNCTION" | "BUSINESS_ENGINE";
  readonly canonical_name: string;
  readonly source_repository: string;
  readonly source_path: string;
  readonly implementation_language?: string;
  readonly framework?: string;
  readonly runtime_type?: string;
  readonly runtime_location?: string;
  readonly deployment_environment?: string;
  readonly entrypoint?: string;
  readonly input_contract?: { http_methods?: readonly string[] };
  readonly uses_table?: readonly string[];
  readonly uses_rpc?: readonly string[];
  readonly uses_external_system?: readonly string[];
  readonly auth_requirement?: string;
  readonly side_effect_class?: string;
  readonly ui_surface?: string;
  readonly status: string;
}

export interface CatalogRelationship {
  readonly relationship_id: string;
  readonly from: string;
  readonly kind: "READS" | "WRITES" | "CALLS" | "USES" | "DEPLOYED_ON";
  readonly to: string;
  readonly evidence: string;
}

function rows<T>(file: string): readonly T[] {
  const p = join(DATA, file);
  if (!existsSync(p)) return [];
  const out: T[] = [];
  for (const line of readFileSync(p, "utf-8").split("\n")) {
    if (line.trim() === "") continue;
    try { out.push(JSON.parse(line) as T); } catch { /* แถวเสียข้ามไป ไม่เดาแทน */ }
  }
  return out;
}

export const components = (): readonly CatalogComponent[] => rows<CatalogComponent>("components.jsonl");
export const relationships = (): readonly CatalogRelationship[] => rows<CatalogRelationship>("relationships.jsonl");
export const databaseObjects = (): readonly Record<string, unknown>[] => rows("database-objects.jsonl");

/** WHERE IS IT? */
export function findComponent(name: string): CatalogComponent | null {
  return components().find((c) => c.canonical_name === name) ?? null;
}
/** WHAT DATA DOES IT READ/WRITE? */
export function dataFor(name: string): { reads: string[]; writes: string[] } {
  const r = relationships().filter((x) => x.from === name);
  return { reads: r.filter((x) => x.kind === "READS").map((x) => x.to),
           writes: r.filter((x) => x.kind === "WRITES").map((x) => x.to) };
}
/** WHO USES THIS TABLE? */
export function usersOfTable(table: string): readonly CatalogRelationship[] {
  return relationships().filter((x) => x.to === `table:${table}`);
}
/** WHAT USES THIS EXTERNAL SYSTEM? */
export function usersOfExternal(system: string): readonly CatalogRelationship[] {
  return relationships().filter((x) => x.to === `external:${system}`);
}
