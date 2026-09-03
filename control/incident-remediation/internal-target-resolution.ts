/**
 * หน้าที่: หาว่าเหตุภายในเกิดกับ "อะไร" โดยเริ่มจากตัวตนของการรันที่มีอยู่แล้ว
 * ไม่ใช่จากการกวาดชื่อไฟล์ (Owner, PART 2).
 *
 * ปัญหาที่ไฟล์นี้แก้ วัดได้จริงจากรอบก่อน: เหตุภายในถูกส่งเข้า `resolveWriteIntent`
 * ซึ่งออกแบบมาสำหรับเหตุจากอีเมลที่มีชื่อ service ชัดเจน พอได้ `source_location`
 * ที่เป็นโฟลเดอร์ มันตอบว่า "source scan found 78 candidate file(s) whose FILENAME
 * matches the intent" แล้วจบที่ UNRESOLVED_ARCHITECTURE — คือไปสแกนชื่อไฟล์ทั้งที่
 * ระบบ "รู้อยู่แล้ว" ว่าเหตุเกิดที่ resource ไหน capability ไหน ขั้นไหน
 *
 * ลำดับที่ใช้จึงเป็น: step_id -> capability_id -> resource_id -> ความสัมพันธ์ใน
 * ทะเบียน -> execution profile -> source_location และการอ่านซอร์สแบบจำกัดขอบเขต
 * เป็นทางเลือกสุดท้าย ไม่ใช่ทางแรก
 *
 * นี่ไม่ใช่ resolver ตัวที่สองของระบบ — มันคือขาของ source_kind ภายในที่อยู่ใน
 * ขอบเขตเดียวกัน และผลของมันถูกส่งกลับเข้าท่อเดิมทันที
 *
 * Input: `ExecutionFailureReport`.
 * Output: `resolveInternalTarget`.
 * Dependency ที่อนุญาต: ./incident-source.ts,
 * ../../software/execution-profile/contract.ts, node:fs, node:path.
 * สิ่งที่ห้ามแตะ: ห้ามสแกนชื่อไฟล์ทั้งรีโปเป็นกลยุทธ์แรก, ห้ามเดาเป้าหมายเมื่อ
 * ตัวตนไม่พอ — ต้องบอกว่าความสัมพันธ์ใดที่ขาด.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { latestProfiles } from "../../software/execution-profile/contract";
import type { ExecutionFailureReport } from "./incident-source";

const CANON = "software/registry-database/data/canonical";

function readJsonl<T>(rel: string): readonly T[] {
  let text: string;
  try { text = readFileSync(join(process.cwd(), rel), "utf8"); } catch { return []; }
  const rows: T[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try { rows.push(JSON.parse(line) as T); } catch { /* ข้าม */ }
  }
  return rows;
}

export interface InternalTargetResolution {
  resolved: boolean;
  /** ฟิลด์ตัวตนที่ถูกใช้จริง เรียงตามลำดับที่ใช้ — หลักฐานว่าไม่ได้เริ่มจากการสแกน */
  identity_fields_used: readonly string[];
  resource_id: string | null;
  capability_id: string | null;
  source_location: string | null;
  registry_relationships_used: readonly string[];
  /** true ก็ต่อเมื่อไม่ต้องพึ่งการอ่านซอร์สแบบกวาดเลย */
  resolved_without_repo_scan: boolean;
  /** ความสัมพันธ์ที่ขาดจริง เมื่อระบุไม่ได้ — ไม่ใช่การเดา */
  missing_relationship: string | null;
  reason: string;
}

/**
 * ไล่จากตัวตนที่แคบที่สุดไปกว้างที่สุด และหยุดทันทีที่ระบุได้
 * ทุกขั้นบันทึกว่าใช้ฟิลด์ไหน เพื่อให้พิสูจน์ลำดับได้ ไม่ใช่เชื่อคำอธิบาย
 */
export function resolveInternalTarget(failure: ExecutionFailureReport): InternalTargetResolution {
  const used: string[] = [];
  const relationships: string[] = [];
  const profiles = latestProfiles();

  // 1. step_id — แคบที่สุด ผูกกับแผนที่บันทึกไว้
  if (failure.step_id !== null) {
    used.push("step_id");
    const plans = readJsonl<{ steps?: { step_id: string; detail?: Record<string, unknown> }[] }>("control/pre-execution-planner/data/plans.jsonl");
    for (const plan of plans) {
      const step = (plan.steps ?? []).find((s) => s.step_id === failure.step_id);
      const resourceFromStep = step?.detail?.["selected_resource_id"] ?? step?.detail?.["resource_id"];
      if (typeof resourceFromStep === "string") {
        relationships.push(`plan.step -> resource_id (${failure.step_id})`);
        const profile = profiles.find((p) => p.resource_id === resourceFromStep);
        return {
          resolved: true, identity_fields_used: used,
          resource_id: resourceFromStep,
          capability_id: failure.capability_id,
          source_location: profile ? String(profile.resource_name.value ?? null) : failure.source_location,
          registry_relationships_used: relationships,
          resolved_without_repo_scan: true, missing_relationship: null,
          reason: "ระบุได้จาก step ที่บันทึกไว้ในแผน — ไม่ต้องอ่านซอร์สเลย",
        };
      }
    }
  }

  // 2. capability_id — ทะเบียนบอกได้ว่า resource ไหนถือความสามารถนี้
  if (failure.capability_id !== null) {
    used.push("capability_id");
    const links = readJsonl<{ resource_id: string; capability_id: string }>(`${CANON}/resource_capabilities.jsonl`);
    const owner = links.find((l) => l.capability_id === failure.capability_id);
    if (owner) {
      relationships.push("resource_capabilities: capability_id -> resource_id");
      const resources = readJsonl<{ resource_id: string; source_location?: string | null }>(`${CANON}/resources.jsonl`);
      const row = resources.find((r) => r.resource_id === owner.resource_id);
      return {
        resolved: true, identity_fields_used: used,
        resource_id: owner.resource_id, capability_id: failure.capability_id,
        source_location: row?.source_location ?? failure.source_location,
        registry_relationships_used: relationships,
        resolved_without_repo_scan: true, missing_relationship: null,
        reason: "ระบุได้จากความสามารถที่ทะเบียนผูกไว้กับทรัพยากร",
      };
    }
    relationships.push("resource_capabilities: ไม่พบ capability_id นี้");
  }

  // 3. resource_id — ทะเบียนบอกที่อยู่ของซอร์สได้ตรง ๆ
  if (failure.resource_id !== null) {
    used.push("resource_id");
    const resources = readJsonl<{ resource_id: string; source_location?: string | null }>(`${CANON}/resources.jsonl`);
    const row = resources.find((r) => r.resource_id === failure.resource_id);
    if (row?.source_location) {
      relationships.push("resources: resource_id -> source_location");
      return {
        resolved: true, identity_fields_used: used,
        resource_id: failure.resource_id, capability_id: failure.capability_id,
        source_location: row.source_location,
        registry_relationships_used: relationships,
        resolved_without_repo_scan: true, missing_relationship: null,
        reason: "ระบุได้จากทรัพยากรที่ลงทะเบียนไว้",
      };
    }
  }

  // 4. execution profile — ผูก source_location กลับเข้าทรัพยากรที่รู้จัก
  if (failure.source_location !== null) {
    used.push("source_location");
    const profile = profiles.find((p) => String(p.resource_name.value ?? "") === failure.source_location?.split("/").at(-1));
    if (profile) {
      relationships.push("execution-profile: source_location -> resource_id");
      return {
        resolved: true, identity_fields_used: used,
        resource_id: profile.resource_id, capability_id: failure.capability_id,
        source_location: failure.source_location,
        registry_relationships_used: relationships,
        resolved_without_repo_scan: true, missing_relationship: null,
        reason: "ระบุได้จาก execution profile ของที่อยู่ซอร์สนั้น",
      };
    }
  }

  // ตัวตนไม่พอ — บอกว่าขาดอะไร ไม่เดา และไม่สแกนชื่อไฟล์แทน
  return {
    resolved: false, identity_fields_used: used,
    resource_id: failure.resource_id, capability_id: failure.capability_id,
    source_location: failure.source_location,
    registry_relationships_used: relationships,
    resolved_without_repo_scan: false,
    missing_relationship: failure.capability_id === null && failure.resource_id === null
      ? "เหตุนี้ไม่มีทั้ง capability_id และ resource_id — ผู้สังเกตต้องบันทึกอย่างน้อยหนึ่งอย่างตอนตรวจพบ"
      : `ไม่มีความสัมพันธ์ในทะเบียนที่ผูก ${failure.capability_id ?? failure.resource_id ?? "ตัวตนที่ให้มา"} เข้ากับซอร์สใด`,
    reason: "ตัวตนของการรันไม่พอจะระบุเป้าหมาย — ไม่ใช้การกวาดชื่อไฟล์แทน",
  };
}
