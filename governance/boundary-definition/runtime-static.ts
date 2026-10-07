/**
 * R2 · ห้าฟิลด์รันไทม์ที่แก้ได้แบบ "อ่านอย่างเดียว"
 *
 * ไม่รันโค้ดของ capability ใดเลย — ทุกค่ามาจากการอ่านซอร์สแบบสถิต
 * ตามที่ Owner สั่ง: ตัวที่เสี่ยงกระทบระบบ ห้ามรันเพื่อจับค่า
 * credential เก็บเฉพาะ "ชื่ออ้างอิง" ไม่มีค่าใด ๆ เข้ามาในระเบียนนี้
 */
import { existsSync, readFileSync } from "node:fs";
import type { Cited } from "./source-evidence";
import { cite } from "./source-evidence";

const RISK = "governance/boundary-definition/data/risk-classification.jsonl";
const WHY = `${RISK} — สกัดแบบสถิตจากซอร์ส ไม่ได้รันโค้ดใด`;

interface Row {
  canonical_id: string;
  runtime_readonly?: {
    result_return_path?: string[]; evidence_return_path?: string[];
    readable?: string[]; credential_reference_names_only?: string[]; external_service?: string[];
  };
}
let cached: Map<string, Row["runtime_readonly"]> | null = null;
function load(): Map<string, Row["runtime_readonly"]> {
  if (cached !== null) return cached;
  const m = new Map<string, Row["runtime_readonly"]>();
  if (existsSync(RISK)) {
    for (const line of readFileSync(RISK, "utf8").split("\n")) {
      const s = line.trim();
      if (!s) continue;
      try { const r = JSON.parse(s) as Row; m.set(r.canonical_id, r.runtime_readonly); } catch { /* ข้ามบรรทัดเสีย */ }
    }
  }
  cached = m; return m;
}

const pick = (v: string[] | undefined, why: string): Cited<string[]> | null =>
  v !== undefined && v.length > 0 ? cite(v, why) : null;

export interface RuntimeStatic {
  result_return_path: Cited<string[]> | null;
  evidence_return_path: Cited<string[]> | null;
  readable: Cited<string[]> | null;
  credential_reference: Cited<string[]> | null;
  external_service: Cited<string[]> | null;
}

export function runtimeStaticFor(capabilityId: string): RuntimeStatic {
  const r = load().get(capabilityId);
  return {
    result_return_path: pick(r?.result_return_path, WHY),
    evidence_return_path: pick(r?.evidence_return_path, WHY),
    readable: pick(r?.readable, WHY),
    credential_reference: pick(r?.credential_reference_names_only, `${WHY} — ชื่ออ้างอิงเท่านั้น ไม่มีค่า`),
    external_service: pick(r?.external_service, WHY),
  };
}
