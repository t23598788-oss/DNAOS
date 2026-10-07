/**
 * หน้าที่: ให้ตัวตนในทะเบียนกับชั้น software/execution-profile/ ผ่าน
 * Candidate -> Duplicate Gate -> Registry Writer เส้นเดิม ไม่ append ตรง
 *
 * สถานะที่ประกาศต้องตรงกับสิ่งที่พิสูจน์แล้วจริง: ชั้นนี้ "ถูกสร้างและตรวจแล้ว
 * สำหรับการอ่านความรู้กลับ" ยังไม่ใช่ตัวเลือกทรัพยากรที่ทำงานอยู่ใน routing
 *
 * Input: none.  Output: ผลการลงทะเบียน.
 * Dependency ที่อนุญาต: ../../control/duplicate-reservation/contract,
 * ../registry-database/adapters/persistent-file-store.
 * สิ่งที่ห้ามแตะ: ห้ามประกาศว่าเป็น execution router, ห้ามเขียน canonical ตรง.
 */
import { reserveAndRegister } from "../../control/duplicate-reservation/contract";
import { createPersistentFileStore } from "../registry-database/adapters/persistent-file-store";
import type { RegistrationCandidate } from "../../control/event-pipeline/registration-contract";

const candidate: RegistrationCandidate = {
  candidate_id: "capability-execution-profile-layer",
  name: "execution-profile",
  kind: "capability",
  source_location: "software/execution-profile/",
  owner: "software/execution-profile/contract.ts",
  input: ["EligibilityRequest{required_capability_ids,requires_paid_service,needs_workspace}"],
  output: [
    "ExecutionProfile{resource_id,entrypoint,execution_boundary,auth_method,billing_status,availability,verification_method,...}",
    "EligibilityDecision{verdict,checks[],blocking_reason}",
    "ResourceAnswer[] (readback 11 คำถามต่อหนึ่ง resource)",
  ],
  side_effects: ["appends to software/execution-profile/data/execution-profiles.jsonl (append-only, ไม่แตะ canonical)"],
  dependencies: [
    "software/registry-database (canonical resources + resource_capabilities)",
    "execution/run/contract.ts#PROCESS_REGISTRY",
    "control/agent-host/contract.ts#resolveWorker",
  ],
  behavior:
    "ชั้นความรู้เชิงปฏิบัติการที่แปะทับ resource_id ของทะเบียน canonical ไม่ใช่ทะเบียนที่สอง "
    + "ค้นหา execution resource จากคำประกาศที่มีอยู่ (PROCESS_REGISTRY + worker registry) แล้ว join กลับทะเบียน "
    + "บันทึกทุกข้อเท็จจริงพร้อมที่มาและระดับการพิสูจน์ โดยค่าที่ไม่รู้คงเป็น UNKNOWN ไม่ถูกเดา "
    + "eligibility รู้จัก dependency: UNKNOWN ปิดกั้นเฉพาะเมื่องานนั้นต้องใช้ข้อเท็จจริงนั้นจริง "
    + "สถานะ: BUILT / VERIFIED สำหรับการอ่านความรู้กลับเท่านั้น ยังไม่ใช่ canonical execution router",
  version: "1.0.0",
  evidence_refs: [
    "software/execution-profile/tests/phase1.test.ts",
    "software/execution-profile/data/execution-profiles.jsonl",
  ],
  domain: "SOFTWARE_CONTROL_PLANE",
  resource_type: "CAPABILITY",
  data_classification: "INTERNAL",
  source_system: "dna-os-infrastructure",
  scope: "execution-resource-knowledge",
  requested_owner: "t23598788-oss",
  requested_repository: "-DNA-OS-INFRASTRUCTURE-",
  origin: {
    origin_kind: "OWNER_TASK",
    origin_reference: "IMPLEMENT_GENERIC_EXECUTION_RESOURCE_LAYER_PHASE_1",
    introduced_by: "software/execution-profile/contract.ts",
  },
};

const result = reserveAndRegister(candidate, () => createPersistentFileStore(), `reg-exec-profile-${Date.now()}`, "software/capability-registrar/register-execution-profile-layer.ts", 60_000);
console.log("reservation_outcome =", result.reservation_outcome);
const p = result.pipeline_result;
console.log("pipeline_status     =", p?.status ?? "(none)");
if (p?.status === "REGISTERED") { console.log("resource_id         =", p.resource_id); console.log("capability_id       =", p.capability_id); }
else if (p) console.log("reason_code         =", p.reason_code);
