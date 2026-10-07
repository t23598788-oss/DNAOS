/**
 * หน้าที่: ทางเข้าเดียวสำหรับอ่านทะเบียนทรัพยากรและนโยบาย
 *
 * ทำแบบเดียวกับ control/assembly/registry.ts ที่มีอยู่แล้ว เพื่อให้รูปแบบเหมือนกัน
 * ไม่ได้สร้างระบบทะเบียนใหม่ — เป็นชั้นอ่านของโฟลเดอร์ data เท่านั้น
 *
 * Dependency ที่อนุญาต: ./types.ts + data/*.json
 * สิ่งที่ห้ามแตะ:
 * - ห้ามอ่านซอร์สของผู้ให้บริการเพื่อตอบคำถาม ต้องตอบจากทะเบียน
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DataAccessPolicyV1, ResourceV1 } from "./types";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "data");

function load<T>(file: string): readonly T[] {
  const p = join(DATA, file);
  if (!existsSync(p)) return [];
  const parsed = JSON.parse(readFileSync(p, "utf-8"));
  return Array.isArray(parsed) ? parsed : (parsed.items ?? []);
}

export const resources = (): readonly ResourceV1[] => load<ResourceV1>("resources.json");
export const policies = (): readonly DataAccessPolicyV1[] => load<DataAccessPolicyV1>("data-access-policies.json");

export const resourceById = (id: string): ResourceV1 | null =>
  resources().find((r) => r.resource_id === id) ?? null;

/** คืน null เมื่อไม่พบ — ผู้เรียกต้องตกไปใช้ค่าปริยายที่ปฏิเสธทุกอย่าง */
export const policyByRef = (ref: string): DataAccessPolicyV1 | null =>
  policies().find((p) => p.policy_id === ref) ?? null;

/** ทรัพยากรที่ประกาศ capability นี้ และ DNA OS อนุญาตให้ใช้ */
export const resourcesProviding = (capability: string): readonly ResourceV1[] =>
  resources().filter((r) => r.capabilities.some((c) => c.capability === capability && c.dna_os_allows));

/** §12 ข้อมูลเท่าที่หน้า Settings ต้องใช้ — เป็นการฉายภาพ ไม่ใช่ที่เก็บความจริง */
export function settingsProjection(resourceId: string) {
  const r = resourceById(resourceId);
  if (r === null) return null;
  const policy = policyByRef(r.data_access_policy_ref);
  return {
    ชื่อ: r.name,
    สถานะ: r.availability_state,
    เหตุผล: r.availability_reason,
    เหตุที่เจ้าของยืนยัน: r.owner_asserted_cause,
    วิธีเชื่อมต่อ: r.connection_method,
    credential: r.credential_ref,
    ความสามารถ: r.capabilities.map((c) => ({
      capability: c.capability,
      ผู้ให้บริการทำได้: c.provider_supports,
      DNA_OS_อนุญาต: c.dna_os_allows,
    })),
    ข้อมูลที่เห็นได้: policy?.allowed_data_classes ?? [],
    ข้อมูลที่ห้ามเห็น: policy?.denied_data_classes ?? ["ทั้งหมด (ไม่มีนโยบาย)"],
    สิทธิ์: r.permissions,
    เขียนสถานะหลักได้: policy?.canonical_state_write_allowed ?? false,
    สัญญาผลลัพธ์: r.output_contracts,
    ค่าใช้จ่าย: r.cost_policy,
    ตัวสำรอง: { group: r.fallback_group, priority: r.fallback_priority },
    ตรวจสุขภาพล่าสุด: r.last_health_check,
    ยืนยันล่าสุด: r.last_verified,
    หลักฐาน: r.evidence_refs,
    ที่พึ่งพา: r.dependencies,
  };
}
