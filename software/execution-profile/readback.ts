/**
 * หน้าที่: ตอบคำถาม "DNA OS มีเครื่องมืออะไรบ้าง และแต่ละตัวใช้ยังไง" จากทะเบียน
 * กับ profile เท่านั้น — ห้ามสแกนรีโปใหม่ตอนตอบ (Owner, ข้อ 8).
 *
 * ทุกคำตอบต้องมาจากสองแหล่ง: `data/execution-profiles.jsonl` ที่บันทึกไว้แล้ว
 * และทะเบียน capability ของ canonical ถ้าคำตอบไหนไม่มีในสองแหล่งนี้ จะออกมาเป็น
 * "ไม่ทราบ" พร้อมเหตุผล ไม่ใช่ไปหาเพิ่มจากซอร์ส — เพราะจุดประสงค์ของเฟสนี้คือ
 * พิสูจน์ว่า "ความรู้ถูกเก็บแล้ว" ไม่ใช่ "ค้นเจอได้ถ้าค้นอีกครั้ง"
 *
 * `ACCOUNTING_REQUIREMENT` อยู่ที่นี่เพราะมันคือการใช้แบบจำลองเดียวกันกับสิ่งที่
 * "ยังไม่มี": ความต้องการของงานบัญชีถูกเขียนเป็น required capability + คุณสมบัติ
 * ไม่ใช่ชื่อฐานข้อมูลหรือชื่อผู้ให้บริการ และเมื่อค้นในทะเบียนแล้วไม่พบ resource ที่
 * ตรง ระบบตอบได้ว่า "ขาดอะไร" แทนที่จะเงียบ
 *
 * Input: none (อ่าน store + ทะเบียน capability).
 * Output: `describeExecutionResources`, `ACCOUNTING_REQUIREMENT`.
 * Dependency ที่อนุญาต: ./store.ts, ./types.ts, node:fs, node:path.
 * สิ่งที่ห้ามแตะ: ห้ามสแกนรีโปตอนตอบ, ห้ามเติมค่าที่ store ไม่มี.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { latestProfiles } from "./store";
import type { ExecutionProfile, Fact } from "./types";

interface CapabilityRow {
  capability_id: string;
  canonical_name?: string;
  purpose?: string;
  input_contract?: unknown;
  output_contract?: unknown;
  side_effects?: unknown;
  status?: string;
  verified_at?: string | null;
}

function capabilityRows(): Map<string, CapabilityRow> {
  const map = new Map<string, CapabilityRow>();
  let text: string;
  try { text = readFileSync(join(process.cwd(), "software/registry-database/data/canonical/capabilities.jsonl"), "utf8"); }
  catch { return map; }
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try { const row = JSON.parse(line) as CapabilityRow; map.set(row.capability_id, row); } catch { /* ข้าม */ }
  }
  return map;
}

const say = <T>(fact: Fact<T>): string =>
  fact.state === "KNOWN" ? String(Array.isArray(fact.value) ? (fact.value as unknown[]).join(", ") : fact.value)
    : fact.state === "NOT_APPLICABLE" ? `ไม่เกี่ยว (${fact.source ?? ""})`
      : `ไม่ทราบ (${fact.source ?? ""})`;

/** คำตอบ 11 ข้อต่อหนึ่ง resource ตามที่ Owner กำหนดในข้อ 8 */
export interface ResourceAnswer {
  resource_id: string;
  what_is_it: string;
  what_can_it_do: readonly { capability_id: string; canonical_name: string; status: string }[];
  how_is_it_invoked: string;
  what_input: string;
  what_output: string;
  which_boundary: string;
  what_authority: string;
  is_available: string;
  billing_knowledge: string;
  how_verified: string;
  what_prevents_use: string;
}

export function describeExecutionResources(): readonly ResourceAnswer[] {
  const caps = capabilityRows();
  return latestProfiles().map((profile: ExecutionProfile) => ({
    resource_id: profile.resource_id,
    what_is_it: say(profile.resource_name),
    what_can_it_do: profile.capability_ids.map((id) => {
      const row = caps.get(id);
      return { capability_id: id, canonical_name: row?.canonical_name ?? "(ไม่มีในทะเบียน capability)", status: row?.status ?? "UNKNOWN" };
    }),
    how_is_it_invoked: say(profile.entrypoint),
    what_input: say(profile.data_input_method),
    what_output: profile.capability_ids.length > 0
      ? profile.capability_ids.map((id) => JSON.stringify(caps.get(id)?.output_contract ?? null)).join(" | ")
      : say(profile.data_output_method),
    which_boundary: say(profile.execution_boundary),
    what_authority: `${say(profile.auth_method)} · เจ้าของอำนาจ: ${say(profile.authority_owner)} · ผู้เรียกที่อนุญาต: ${say(profile.permission_requirements)}`,
    is_available: `${say(profile.availability)} · ติดตั้ง=${say(profile.facts.installed)} · พร้อมใช้=${say(profile.facts.available)}`,
    billing_knowledge: `แผน=${say(profile.service_plan)} · สถานะ=${say(profile.billing_status)} · ต้องสมัคร=${say(profile.subscription_required)}`,
    how_verified: `${say(profile.verification_method)} · ล่าสุด ${say(profile.last_verified_at)}`,
    what_prevents_use: say(profile.unavailable_reason),
  }));
}

/** สิ่งที่งานบัญชีต้องการ เขียนด้วยแบบจำลองเดียวกัน — ไม่มีชื่อผู้ให้บริการ */
export interface MissingCapabilityRequirement {
  required_capability: string;
  required_properties: readonly string[];
  matching_resource_ids: readonly string[];
  blocker: string | null;
}

export const ACCOUNTING_REQUIREMENT = {
  required_capability: "business_database_read",
  required_properties: [
    "READ_ONLY", "schema_inspection", "metadata_read",
    "bounded_select", "row_count", "evidence_producing",
  ] as readonly string[],
} as const;

/**
 * ค้น resource ที่ตอบความต้องการนั้นได้จากทะเบียน — ไม่พบคือคำตอบที่ถูกต้อง
 * และต้องบอกได้ว่าขาดอะไร ไม่ใช่เงียบหรือเสนอชื่อผู้ให้บริการแทน
 */
export function resolveAccountingRequirement(): MissingCapabilityRequirement {
  const caps = capabilityRows();
  const matches: string[] = [];
  for (const profile of latestProfiles()) {
    for (const id of profile.capability_ids) {
      const name = caps.get(id)?.canonical_name ?? "";
      if (name === ACCOUNTING_REQUIREMENT.required_capability) matches.push(profile.resource_id);
    }
  }
  return {
    required_capability: ACCOUNTING_REQUIREMENT.required_capability,
    required_properties: ACCOUNTING_REQUIREMENT.required_properties,
    matching_resource_ids: matches,
    blocker: matches.length > 0 ? null
      : `ไม่มี execution resource ใดที่ลงทะเบียนความสามารถ "${ACCOUNTING_REQUIREMENT.required_capability}" — งานบัญชีจึงยังไม่มีเครื่องมือที่ใช้ได้ และนี่คือความต้องการที่ยังไม่ถูกเติมเต็ม ไม่ใช่ข้อผิดพลาดของงานบัญชี`,
  };
}
