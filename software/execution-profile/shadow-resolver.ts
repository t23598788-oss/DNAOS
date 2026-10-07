/**
 * หน้าที่: ตัวเลือกทรัพยากรแบบเงา — รับ "ความสามารถที่งานต้องการ" แล้วคืนรายชื่อ
 * resource ที่ใช้ได้พร้อมเหตุผล โดยไม่รันอะไรและไม่ถูกต่อเข้า routing จริง
 * (Owner, PHASE 2 ข้อ 6).
 *
 * ทำไมต้องเป็นเงาก่อน: การเปลี่ยนตัวเลือกทรัพยากรของระบบที่รันงานอยู่จริงเป็น
 * การเปลี่ยนที่ย้อนกลับยาก การมีตัวเลือกที่ตอบได้ก่อนโดยไม่มีอำนาจสั่ง ทำให้เทียบ
 * คำตอบกับของเดิมได้โดยไม่ต้องเสี่ยง
 *
 * ชื่อผู้ให้บริการไม่มีส่วนร่วมในการเลือกเลย: ตัวกรองทั้งหมดอ่านจาก
 * resource_capabilities (ทะเบียน) และ execution_profile (ชั้นความรู้) เท่านั้น
 * ถ้าลบชื่อ provider ออกจากระบบทั้งหมด ไฟล์นี้ยังทำงานเหมือนเดิมทุกประการ
 *
 * การจัดอันดับใช้ "ความแน่นอนของความรู้" ไม่ใช่ความชอบ: resource ที่ทุกข้อ
 * ตรวจผ่านมาก่อน resource ที่ยังมีข้อไม่รู้ และไม่มีการจัดอันดับจากชื่อหรือลำดับ
 * ที่ประกาศ
 *
 * Input: `ResourceRequest`.
 * Output: `resolveResources`.
 * Dependency ที่อนุญาต: ./store.ts, ./eligibility.ts, ./types.ts, node:fs, node:path.
 * สิ่งที่ห้ามแตะ: ห้ามอ่านชื่อ resource มาตัดสิน, ห้ามรันอะไร,
 * ห้ามให้ไฟล์นี้ถูก import จาก control/command-router/.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decideEligibility } from "./eligibility";
import { latestProfiles } from "./store";
import type { EligibilityDecision } from "./types";

export interface ResourceRequest {
  /** ชื่อเชิงความหมายของงาน เช่น "test_execution" — ไม่ใช่ชื่อโมดูล/ผู้ให้บริการ */
  required_capabilities: readonly string[];
  requires_paid_service: boolean;
  needs_workspace: boolean;
  /** ผู้เรียก — ใช้ตรวจกับ permission_requirements ที่ resource ประกาศไว้ */
  caller?: string;
}

export interface ResourceCandidate {
  resource_id: string;
  matched_capabilities: readonly string[];
  missing_capabilities: readonly string[];
  eligibility: EligibilityDecision;
}

export interface ResolveOutcome {
  required_capabilities: readonly string[];
  /** resource ที่ประกาศความสามารถครบตามที่ขอ */
  matching: readonly ResourceCandidate[];
  /** ในกลุ่มที่ตรง อันไหนใช้ได้จริง */
  eligible: readonly ResourceCandidate[];
  /** ตรงแต่ยังมีข้อไม่รู้ */
  unknown: readonly ResourceCandidate[];
  /** ตรงแต่ใช้ไม่ได้ */
  not_eligible: readonly ResourceCandidate[];
  /** ความสามารถที่ไม่มี resource ใดในระบบประกาศไว้เลย */
  unprovided_capabilities: readonly string[];
  explanation: string;
}

interface CapabilityRow { capability_id: string; canonical_name?: string }

function capabilityNames(): Map<string, string> {
  const map = new Map<string, string>();
  let text: string;
  try { text = readFileSync(join(process.cwd(), "software/registry-database/data/canonical/capabilities.jsonl"), "utf8"); }
  catch { return map; }
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try { const row = JSON.parse(line) as CapabilityRow; if (row.canonical_name) map.set(row.capability_id, row.canonical_name); }
    catch { /* ข้าม */ }
  }
  return map;
}

export function resolveResources(request: ResourceRequest): ResolveOutcome {
  const names = capabilityNames();
  const profiles = latestProfiles();

  const candidates: ResourceCandidate[] = profiles.map((profile) => {
    const provided = profile.capability_ids.map((id) => names.get(id) ?? id);
    const matched = request.required_capabilities.filter((c) => provided.includes(c));
    const missing = request.required_capabilities.filter((c) => !provided.includes(c));
    return {
      resource_id: profile.resource_id,
      matched_capabilities: matched,
      missing_capabilities: missing,
      eligibility: decideEligibility(profile, {
        // ส่งเป็น capability_id จริงที่ resource ถือ เพื่อให้ eligibility ตรวจได้ตรงชนิด
        required_capability_ids: profile.capability_ids.filter((id) => matched.includes(names.get(id) ?? id)),
        requires_paid_service: request.requires_paid_service,
        needs_workspace: request.needs_workspace,
      }),
    };
  });

  const matching = candidates.filter((c) => c.missing_capabilities.length === 0 && request.required_capabilities.length > 0);
  const eligible = matching.filter((c) => c.eligibility.verdict === "ELIGIBLE");
  const unknownSet = matching.filter((c) => c.eligibility.verdict === "UNKNOWN");
  const notEligible = matching.filter((c) => c.eligibility.verdict === "NOT_ELIGIBLE");

  const allProvided = new Set<string>();
  for (const profile of profiles) for (const id of profile.capability_ids) allProvided.add(names.get(id) ?? id);
  const unprovided = request.required_capabilities.filter((c) => !allProvided.has(c));

  const explanation = [
    `งานนี้ต้องการ: ${request.required_capabilities.join(", ") || "(ไม่ได้ระบุ)"}`,
    unprovided.length > 0
      ? `ยังไม่มีทรัพยากรใดในทะเบียนที่ประกาศความสามารถ: ${unprovided.join(", ")}`
      : `ทุกความสามารถที่ขอมีผู้ให้บริการอยู่ในทะเบียน`,
    `ทรัพยากรที่ความสามารถตรงครบ: ${matching.length} · ใช้ได้ทันที: ${eligible.length} · ยังมีข้อไม่รู้: ${unknownSet.length} · ใช้ไม่ได้: ${notEligible.length}`,
    ...unknownSet.map((c) => `  ${c.resource_id} ยังไม่แน่ชัดเพราะ ${c.eligibility.blocking_reason}`),
    ...notEligible.map((c) => `  ${c.resource_id} ใช้ไม่ได้เพราะ ${c.eligibility.blocking_reason}`),
  ].join("\n");

  return {
    required_capabilities: request.required_capabilities,
    matching, eligible, unknown: unknownSet, not_eligible: notEligible,
    unprovided_capabilities: unprovided,
    explanation,
  };
}
