/**
 * หน้าที่: `RegistrationCandidate` ของ Owner control surface ของ Computer Use
 * บนหน้า Settings — `~/Desktop/dna-os-control-workspace/features/views.mjs#settings`
 *
 * WHY IT IS NOT A DUPLICATE. `computer-use-core-api` (capability-090164c7) คือ
 * *ขอบเขต HTTP* ฝั่ง Core ส่วนตัวนี้คือ *หน้าจอที่ Owner ใช้สั่ง* คนละฝั่งของสาย
 * และไม่มี logic สิทธิ์ของตัวเองเลย — ทุก action ยิงผ่าน Product proxy ไป Core
 * แล้วอ่านสถานะกลับ ไม่มีสถานะใดถูกตั้งจากหน่วยความจำหน้าจอ
 *
 * Dependency ที่อนุญาต: `../../../control/event-pipeline/registration-contract.ts` (type only).
 * สิ่งที่ห้ามแตะ: ห้ามแก้ evidence_refs ให้อ้างการรันที่ไม่ได้เกิดขึ้นจริง
 */

import type { RegistrationCandidate } from "../../../control/event-pipeline/registration-contract";

export const COMPUTER_USE_SETTINGS_SURFACE_CANDIDATE: RegistrationCandidate = {
  candidate_id: "candidate-computer-use-settings-surface-v1",
  name: "computer-use-settings-surface",
  kind: "capability",
  source_location: "~/Desktop/dna-os-control-workspace/features/views.mjs#paintComputerUse",
  owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/computer-use-settings-surface.ts",

  input: [
    "GET /api/core/computer-use — สถานะจาก Core (executor, owner_authentication.sessions, active_leases, evidence)",
    "Owner action: ยืนยันตัวตน Owner (macos-console-session)",
    "Owner action: อนุญาตการควบคุม (requester, capability, target, operations[], ttl, high_risk_explicit, external_commit_explicit, purpose)",
    "Owner action: ถอนสิทธิ์ (authority_id) · ถอนสิทธิ์ทั้งหมด · ล็อกการควบคุมคอมพิวเตอร์",
    "Owner action: provider login (authority_id, provider, credential_reference, requester)",
  ],
  output: [
    "แผงสถานะ: EXECUTOR · EXECUTOR LAUNCH AGENT · EXECUTION OWNER · OWNER AUTHENTICATION · AUTHORITY · ACTIVE LEASES · CLAUDE · EVIDENCE",
    "แผงตรวจสอบก่อนอนุญาต (Authorization Review) ที่ Owner ต้องกดยืนยันอีกครั้ง",
    "รายการ lease ที่ยังใช้ได้ พร้อมปุ่มถอนสิทธิ์รายใบ",
    "ผลลัพธ์ของทุก action พร้อม reason_code และ evidence_id จาก Core",
    "คำอธิบายสิทธิ์ที่สร้างจากค่า backend จริง (execution_owner, claude_role)",
  ],
  side_effects: [
    "เรียก Core endpoint ที่เปลี่ยนสถานะ (authenticate/grant/revoke/revoke-all/lock/login) ผ่าน Product proxy",
    "ไม่เขียนสถานะใดฝั่งหน้าจอ — อ่านกลับจาก backend หลังทุก action",
  ],
  dependencies: [
    "transport/owner-command-http/computer-use-api.ts (Core boundary)",
    "~/Desktop/dna-os-control-workspace/server/server.mjs (proxy allow-list, forward-only)",
    "~/Desktop/dna-os-control-workspace/core-connection/core-client.mjs",
  ],

  behavior:
    "owner_control_surface_for_computer_use: หน้าจอ Settings ที่ให้ Owner ดูสถานะจริงและสั่ง authenticate/grant/revoke/revoke-all/lock/login โดยไม่มี logic สิทธิ์ของตัวเอง owner_session_id อ่านจาก status ที่ backend คืน (session ที่ ACTIVE) ไม่เก็บในตัวแปรหน้าจอ ทุก action เรียก Core แล้วอ่านสถานะใหม่ทันที ปุ่มทำลายล้างต้องยืนยันก่อนส่ง แผง grant แสดงเฉพาะเมื่อมี owner session ที่ backend ยืนยัน และไม่แสดงรายการ operations เป็นสำเนาฝั่ง UI เพราะ Core ยังไม่ส่ง catalog ออกมา (ประกาศเป็น BACKEND_GAP บนหน้าจอ)",

  version: "1.0.0",

  evidence_refs: [
    "~/Desktop/dna-os-control-workspace/features/views.mjs#paintComputerUse",
    "~/Desktop/dna-os-control-workspace/server/server.mjs#computer-use-proxy-allow-list",
    "~/Desktop/dna-os-control-workspace/core-connection/core-client.mjs#cuAction",
    "runtime 2026-09-01 ผ่าน proxy จริง: authenticate -> read-back active_sessions=1 owner=tam",
    "runtime 2026-09-01: grant screenshot+read_screen/screen -> read-back active_leases=1 พบใบที่ grant",
    "runtime 2026-09-01: revoke -> read-back active_leases=0 ใบนั้นหายจริง",
    "runtime 2026-09-01: lock -> locked=true revoked=1 owner_session_revoked=true active_after=0",
    "runtime 2026-09-01: restart Product แล้วอ่านใหม่ ยังเป็น LOCKED (สถานะมาจาก Core ไม่ใช่ memory)",
    "UI render 2026-09-01: ปุ่ม 5 ตัว (ยืนยันตัวตน/ตรวจสอบก่อนอนุญาต/ถอนสิทธิ์ทั้งหมด/ล็อก/เข้าสู่ระบบ) + input 13 ช่อง",
    "UI render 2026-09-01: ไม่มี secret ปรากฏบนหน้าจอ",
  ],

  domain: "SOFTWARE_CONTROL_PLANE",
  resource_type: "CAPABILITY",
  data_classification: "INTERNAL",
  source_system: "dna-os-control-workspace",
  scope: "settings/computer-use-control-surface",
  relationships: [
    { to_type: "API", to_id: "route:settings/computer-use", relationship_kind: "CAPABILITY_TO_API" },
  ],
} as RegistrationCandidate;
