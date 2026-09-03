/**
 * หน้าที่: `RegistrationCandidate` ของ `control/owner-projection/` — ชั้นที่
 * แปลงผลลัพธ์ canonical ให้กลายเป็นสิ่งที่ Owner เห็นบนหน้าจอ
 *
 * WHY IT IS NOT A DUPLICATE. ทะเบียนมี `system-graph-projection`
 * (capability-31e94a11, `software/system-graph/`) อยู่แล้ว แต่คนละตัวกัน:
 * ตัวนั้นฉาย "โครงสร้างของระบบ" ออกมาเป็นกราฟ nodes/edges ส่วนตัวนี้ฉาย
 * "ผลลัพธ์ของคำสั่งหนึ่งครั้ง" ออกมาเป็น payload ที่ Owner อ่านได้
 * คนละ input คนละ output คนละผู้เรียก ไม่มีโค้ดร่วมกันสักบรรทัด
 * นี่คือการลงทะเบียนของที่มีอยู่แล้ว ไม่ใช่การสร้าง projection ตัวใหม่
 *
 * Input: none (ค่าคงที่ตัวเดียว).
 * Output: `OWNER_DISPLAY_PROJECTION_CANDIDATE`.
 * Dependency ที่อนุญาต: `../../../control/event-pipeline/registration-contract.ts` (type only).
 * สิ่งที่ห้ามแตะ: ห้ามแก้ `evidence_refs` ให้อ้างถึงการรันที่ไม่ได้เกิดขึ้นจริง
 */

import type { RegistrationCandidate } from "../../../control/event-pipeline/registration-contract";

export const OWNER_DISPLAY_PROJECTION_CANDIDATE: RegistrationCandidate = {
  candidate_id: "candidate-owner-display-projection-v1",
  name: "owner-display-projection",
  kind: "capability",
  source_location: "control/owner-projection/ (display-payload.ts, display-payload.test.ts)",
  owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/owner-display-projection.ts",

  input: [
    "CanonicalResult: Readonly<Record<string, unknown>> — ผลลัพธ์ดิบจาก owner command หนึ่งครั้ง",
    "ชนิดที่รองรับถูกอนุมานจาก result_type / subject_type / type หรือจาก operation+intent_type",
  ],
  output: [
    "DisplayPayload schema OWNER_DISPLAY_PAYLOAD_V1 — projection: SUPPORTED | UNSUPPORTED_PROJECTION",
    "SUPPORTED: subject, state, summary_facts (whitelist 7 คีย์), owner_attention, blocker, progress, evidence_available, details_reference",
    "UNSUPPORTED_PROJECTION: subject UNKNOWN, state UNSUPPORTED, owner_attention true — ไม่ส่งฟิลด์ดิบใด ๆ ต่อ",
  ],
  side_effects: [
    "none — ฟังก์ชันบริสุทธิ์ ไม่มี I/O ไม่เขียนไฟล์ ไม่เรียกเครือข่าย",
  ],
  dependencies: [
    "none — ไฟล์นี้ไม่ import อะไรเลย (ไม่มี import statement ใน display-payload.ts)",
  ],

  behavior:
    "project_canonical_result_to_owner_display_payload: เป็น whitelist ไม่ใช่ serializer — คัด summary_facts เฉพาะ 7 คีย์ที่อนุญาต (health, branch, revision, assignable, count, exit_code, test_count) และรับเฉพาะ 7 ชนิด (runtime, capability, agent, resource, git, test, error) ชนิดที่ไม่รู้จักได้ UNSUPPORTED_PROJECTION แทนการปล่อยผ่าน ผลคือ log/หลักฐาน/ฟิลด์ดิบไม่มีทางหลุดไปหน้าจอ ไม่มี AI อยู่ในเส้นทางนี้ ทุกการตัดสินเป็นกฎตายตัวที่อ่านได้จาก source",

  version: "1.0.0",

  evidence_refs: [
    "control/owner-projection/display-payload.ts",
    "control/owner-projection/display-payload.test.ts",
    "transport/owner-command-http/server.ts:91 (import projectOwnerDisplayPayload)",
    "transport/owner-command-http/server.ts:577 (POST /owner/display-payload — ผู้เรียกจริงเพียงรายเดียวใน Core)",
    "live proof 2026-09-01: POST /owner/display-payload {result_type:capability,count:113} -> {schema:OWNER_DISPLAY_PAYLOAD_V1, projection:SUPPORTED, subject:AGENT_HOST, state:OBSERVED, summary_facts:{count:113}}",
    "live proof 2026-09-01: {result_type:totally-unsupported, secret_field:must-not-appear} -> projection:UNSUPPORTED_PROJECTION และ secret_field ไม่ปรากฏใน response",
    "consumer จริง: ~/Desktop/dna-os-control-workspace/server/server.mjs POST /api/core/request เรียก /owner/display-payload แล้วส่งต่อให้ renderOwnerResponse",
  ],

  domain: "SOFTWARE_CONTROL_PLANE",
  resource_type: "CAPABILITY",
  data_classification: "INTERNAL",
  source_system: "dna-os-infrastructure",
  scope: "owner/display-projection",
};
