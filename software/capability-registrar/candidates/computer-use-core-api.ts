/**
 * หน้าที่: `RegistrationCandidate` ของ Core API boundary ของ Computer Use —
 * `transport/owner-command-http/computer-use-api.ts`
 *
 * WHY IT IS NOT A DUPLICATE. ทะเบียนมี capability ของ authority/executor/
 * owner-authentication อยู่แล้ว capability นี้ **ไม่ได้ทำ logic ซ้ำกับตัวใดเลย** —
 * มันคือ *ขอบเขต HTTP* ที่แปลง request เป็นการเรียก capability เหล่านั้น
 * ไม่มีการตัดสินสิทธิ์ของตัวเอง ไม่มี store ของตัวเอง มีแต่ schema validation,
 * evidence ของการเรียก API และด่านกัน secret ขาออก
 *
 * Input: none (ค่าคงที่ตัวเดียว).
 * Dependency ที่อนุญาต: `../../../control/event-pipeline/registration-contract.ts` (type only).
 * สิ่งที่ห้ามแตะ: ห้ามแก้ evidence_refs ให้อ้างการรันที่ไม่ได้เกิดขึ้นจริง
 */

import type { RegistrationCandidate } from "../../../control/event-pipeline/registration-contract";

export const COMPUTER_USE_CORE_API_CANDIDATE: RegistrationCandidate = {
  candidate_id: "candidate-computer-use-core-api-v2",
  name: "computer-use-core-api",
  kind: "capability",
  source_location: "transport/owner-command-http/computer-use-api.ts",
  owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/computer-use-core-api.ts",

  input: [
    "GET  /computer-use/status — no body",
    "POST /computer-use/owner/authenticate { method, expected_owner, ttl_seconds }",
    "POST /computer-use/authority/grant { owner_session_id, requester, executor, capability, operations[], target, ttl_seconds, scope?, high_risk_explicit?, external_commit_explicit?, evidence_reference? }",
    "POST /computer-use/authority/revoke { owner_session_id, authority_id }",
    "POST /computer-use/authority/revoke-all { owner_session_id }",
    "POST /computer-use/lock { owner_session_id }",
    "POST /computer-use/provider/login { authority_id, requester, provider, credential_ref, want_raw_secret? }",
  ],
  output: [
    "ComputerUseStatus + claude_role REQUESTER_ONLY + read_only (GET status)",
    "operation_catalog[] { operation, level L0-L4, high_risk_explicit_required, security_level } — derive จาก OPERATION_LEVEL ไม่ใช่ตารางที่สอง",
    "external_commit_policy { declared_per_request, request_flag, lease_flag, denial_reason_code, inherits_from_ui_control }",
    "AuthenticateOwnerResult + evidence_id",
    "OwnerGrantResult + evidence_id",
    "RevokeAuthorityResult + evidence_id",
    "{ ok, revoked_count, revoked[], failed[], owner_session_revoked, locked, active_after, evidence_id } (revoke-all / lock)",
    "LoginAuthorizationResult (credential_reference เท่านั้น ไม่มี secret) + evidence_id",
    "error contract: { ok: false, reason_code, detail, evidence_id }",
  ],
  side_effects: [
    "เขียน evidence ของการเรียก API ลง transport/owner-command-http/data/computer-use-api-evidence.jsonl",
    "เรียก capability เดิมซึ่งอาจถอน/ออกใบมอบอำนาจ และปิด owner session (ผ่าน lock)",
  ],
  dependencies: [
    "control/computer-use-authority (readComputerUseStatus, revokeAuthority)",
    "control/owner-authentication (authenticateOwner, validateOwnerSession, revokeOwnerSession, grantAuthorityAsOwner)",
    "control/computer-use-executor/login-authority (requestLogin)",
  ],

  behavior:
    "expose_computer_use_capabilities_through_core_http_boundary: adapter บาง ๆ ที่ไม่มี logic สิทธิ์ของตัวเอง ทุก endpoint validate schema แล้วเรียก capability ที่มีอยู่แล้ว fail closed เมื่อ parse ไม่ได้หรือ owner session ใช้ไม่ได้ บันทึก evidence ทุกครั้งทั้งกรณีผ่านและถูกปฏิเสธ และมีด่านกัน secret ขาออก (stripSecrets) เป็นชั้นที่สองนอกเหนือจากที่ requestLogin ปฏิเสธ want_raw_secret อยู่แล้ว ไม่มีเส้นทางใดให้ Claude/Codex/Agent เป็น executor เพราะ grantAuthority บังคับ isDnaOsExecutor",

  version: "1.1.0",

  evidence_refs: [
    "transport/owner-command-http/computer-use-api.ts",
    "transport/owner-command-http/server.ts (router /computer-use/*)",
    "control/computer-use-authority/status-contract.ts#readComputerUseStatus",
    "control/computer-use-authority/levels.ts#OPERATION_LEVEL",
    "control/computer-use-authority/tests/operation-catalog.test.ts",
    "runtime 2026-09-01: GET /computer-use/status คืน operation_catalog 16 รายการ L0=2 L1=6 L2=5 L4=3",
    "control/owner-authentication/contract.ts#authenticateOwner,validateOwnerSession,revokeOwnerSession,grantAuthorityAsOwner",
    "control/computer-use-executor/login-authority.ts#requestLogin",
    "runtime 2026-09-01: invalid request -> OWNER_SESSION_REQUIRED",
    "runtime 2026-09-01: unauthenticated grant -> OWNER_SESSION_NOT_FOUND",
    "runtime 2026-09-01: fake owner -> OWNER_SIGNAL_MISMATCH / TOUCH_ID_HELPER_NOT_AVAILABLE",
    "runtime 2026-09-01: executor agent:claude -> EXECUTOR_NOT_DNA_OS",
    "runtime 2026-09-01: want_raw_secret -> RAW_SECRET_DENIED",
    "runtime 2026-09-01: valid owner (macos-console-session, tam) -> GRANTED authority-5392faa0",
    "runtime 2026-09-01: revoke -> next login on same authority = AUTHORITY_REVOKED",
    "runtime 2026-09-01: lock -> locked=true revoked=1 owner_session_revoked=true active_after=0; grant ต่อด้วย session เดิม = OWNER_SESSION_REVOKED",
    "runtime 2026-09-01: login สำเร็จคืน credential_reference + credential_status ACTIVE โดยไม่มี secret",
    "transport/owner-command-http/data/computer-use-api-evidence.jsonl (21 แถว, ไม่มี secret)",
  ],

  domain: "SOFTWARE_CONTROL_PLANE",
  resource_type: "CAPABILITY",
  data_classification: "INTERNAL",
  source_system: "dna-os-infrastructure",
  scope: "computer-use/core-api",
  relationships: [
    { to_type: "API", to_id: "route:computer-use", relationship_kind: "CAPABILITY_TO_API" },
  ],
} as RegistrationCandidate;
