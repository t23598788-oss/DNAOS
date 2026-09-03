/**
 * หน้าที่: ลงทะเบียนคำศัพท์ "ความสามารถของงาน" ผ่าน Candidate -> Duplicate Gate
 * -> Registry Writer เส้นเดิม โดยผูก source_location ไปที่โมดูลที่ให้ความสามารถนั้นจริง
 *
 * ทุกตัวมาจาก software/execution-profile/task-capability.ts ซึ่งบังคับว่าต้องมี
 * `provided_by` พร้อมหลักฐาน — ไฟล์นี้ไม่ได้คิดชื่อขึ้นเอง
 *
 * Input: none.  Output: ผลการลงทะเบียนต่อหนึ่ง capability.
 * Dependency ที่อนุญาต: ../execution-profile/task-capability, ../../control/duplicate-reservation/contract,
 * ../registry-database/adapters/persistent-file-store.
 * สิ่งที่ห้ามแตะ: ห้าม append canonical ตรง, ห้ามลงทะเบียน capability ที่ไม่มีผู้ให้บริการ.
 */
import { reserveAndRegister } from "../../control/duplicate-reservation/contract";
import { createPersistentFileStore } from "../registry-database/adapters/persistent-file-store";
import { TASK_CAPABILITIES } from "../execution-profile/task-capability";
import type { RegistrationCandidate } from "../../control/event-pipeline/registration-contract";

let registered = 0, duplicate = 0, rejected = 0;
for (const cap of TASK_CAPABILITIES) {
  if (cap.provided_by.length === 0) { console.log(`ข้าม ${cap.canonical_name} — ไม่มีผู้ให้บริการ`); continue; }
  const provider = cap.provided_by[0]!;
  const candidate: RegistrationCandidate = {
    candidate_id: `task-capability-${cap.canonical_name}`,
    name: cap.canonical_name,
    kind: "capability",
    source_location: provider.source_location.endsWith("/") ? provider.source_location : `${provider.source_location}/`,
    owner: provider.source_location,
    input: [cap.input_contract],
    output: [cap.output_contract],
    side_effects: [...cap.side_effects],
    dependencies: [],
    behavior: `${cap.purpose} — พิสูจน์โดย ${provider.proof.kind}: ${provider.proof.source} (${provider.proof.detail})`,
    version: "1.0.0",
    evidence_refs: cap.provided_by.map((p) => p.proof.source),
    domain: "SOFTWARE_CONTROL_PLANE",
    resource_type: "CAPABILITY",
    data_classification: "INTERNAL",
    source_system: "dna-os-infrastructure",
    scope: "task-capability-vocabulary",
    requested_owner: "t23598788-oss",
    requested_repository: "-DNA-OS-INFRASTRUCTURE-",
    origin: { origin_kind: "OWNER_TASK", origin_reference: "BUILD_TASK_CAPABILITY_VOCAB_PHASE_2", introduced_by: "software/execution-profile/task-capability.ts" },
  };
  const r = reserveAndRegister(candidate, () => createPersistentFileStore(), `reg-taskcap-${cap.canonical_name}-${Date.now()}`, "software/capability-registrar/register-task-capabilities.ts", 60_000);
  const p = r.pipeline_result;
  const status = p?.status ?? r.reservation_outcome;
  if (status === "REGISTERED") registered++; else if (status === "DUPLICATE") duplicate++; else rejected++;
  console.log(`  ${cap.canonical_name.padEnd(30)} ${status} ${p?.status === "REGISTERED" ? p.capability_id : (p && "reason_code" in p ? p.reason_code : "")}`);
}
console.log(`\nREGISTERED=${registered} DUPLICATE=${duplicate} OTHER=${rejected}`);
