/**
 * หน้าที่: ผูกขั้นของ flow เข้ากับโค้ดที่รันจริง ผ่านทะเบียนเท่านั้น
 *
 * ── ทำไมแยกไฟล์ ──
 * `recovery-flow.ts` ต้องอ่านรู้เรื่องโดยไม่ต้องรู้ว่ามีโค้ดอยู่ที่ไหน ความหมาย
 * ของขั้นมาก่อนการมีอยู่ของไฟล์ การผูกจึงเกิดที่นี่ และถ้าลบไฟล์นี้ทิ้ง flow
 * ยังคงอธิบายตัวเองได้ครบ
 *
 * ── path ที่ประกาศไว้ ไม่ใช่ path ที่เดาเอา ──
 * `DECLARED_PATHS` เป็นคำประกาศของคน ว่าขั้นนี้ทำงานที่ไหน มันไม่ใช่ผลของ
 * การค้นชื่อไฟล์ที่ดูเกี่ยวข้อง และมันไม่ได้ให้สิทธิ์เป็นเจ้าของด้วยตัวเอง —
 * `capability_id` ทุกตัวมาจากทะเบียนเสมอ ถ้าทะเบียนไม่รู้จัก path นั้น ผลคือ
 * `MISSING_CAPABILITY_OWNERSHIP` ไม่ใช่การยกให้ตามชื่อ
 *
 * Input: ไม่มี
 * Output: `implementationForStep`, `DECLARED_PATHS`
 * Dependency ที่อนุญาต: owner-error-lane (อ่านทะเบียน)
 * สิ่งที่ห้ามแตะ: ห้ามเดา path จากชื่อขั้น ห้ามยกเจ้าของโดยไม่ผ่านทะเบียน
 */

import { resolveOwnershipForPath } from "../owner-error-lane/contract";
import type { StepImplementation } from "./types";

export const DECLARED_PATHS: Readonly<Record<string, string>> = {
  S1_OWNER_COMMAND: "control/owner-command/owner-command.ts",
  S2_ADMISSION: "control/agent-gateway/work-order-validator.ts",
  S3_DECISION: "permissions/write-gate/policy.ts",
  S4_WORK_ORDER: "control/agent-gateway/gateway.ts",
  S5_DISPATCH: "control/agent-gateway/handoff.ts",
  S6_EXECUTION: "execution/file-write/executor.ts",
  S7_RESULT: "control/agent-gateway/gateway.ts",
  S8_EVIDENCE: "control/agent-gateway/memory-store.ts",
  S9_NEXT_DECISION: "control/agent-gateway/handoff.ts",
  S10_OWNER_PRESENTATION: "transport/owner-command-http/server.ts",
};

/**
 * เจ้าของของขั้นหนึ่ง — `null` ถ้าไม่มีการประกาศ path ไว้เลย
 *
 * จำผลไว้เพราะการถามทะเบียนอ่านไฟล์ทั้งก้อน และการวิเคราะห์หลายร้อยการรัน
 * ถามคำถามเดิมซ้ำ ๆ ผลของทะเบียนไม่เปลี่ยนระหว่างการวิเคราะห์หนึ่งครั้ง
 */
const memo = new Map<string, StepImplementation | null>();

export function implementationForStep(stepId: string): StepImplementation | null {
  const cached = memo.get(stepId);
  if (cached !== undefined) return cached;
  const declared = DECLARED_PATHS[stepId];
  if (declared === undefined) { memo.set(stepId, null); return null; }
  const owned = resolveOwnershipForPath(declared);
  const built: StepImplementation = {
    capability_id: owned.capability_id,
    resource_id: owned.resource_id,
    repository_id: owned.repository_id,
    repo_relative_path: owned.repo_relative_path,
    runtime_entrypoint: declared,
    ownership_status: owned.capability_id !== null ? "OWNED" : "MISSING_CAPABILITY_OWNERSHIP",
    evidence: owned.evidence_refs,
  };
  memo.set(stepId, built);
  return built;
}
