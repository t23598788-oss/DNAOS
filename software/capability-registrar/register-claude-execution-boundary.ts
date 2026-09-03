/**
 * หน้าที่: ให้ตัวตนในทะเบียนกับ `control/claude-execution-boundary/` ซึ่งพิสูจน์
 * แล้วด้วยการรันจริง — เดินผ่าน Candidate -> Duplicate Gate -> Registry Writer
 * เส้นเดียวกับที่ทุก capability ในระบบนี้ใช้ ไม่ได้เขียนลงทะเบียนตรง
 *
 * evidence_refs ที่ใส่คือ id ของหลักฐานจริงที่เกิดจากการรันผ่าน Owner command
 * ไม่ใช่ข้อความบรรยาย — เนื้อหาหลักฐานยังอยู่ที่เดิมใน agent-gateway
 *
 * Input: none.  Output: ผลการลงทะเบียนที่พิมพ์ออกมา.
 * Dependency ที่อนุญาต: ../../control/duplicate-reservation/contract,
 * ../registry-database/adapters/persistent-file-store.
 * สิ่งที่ห้ามแตะ: ห้ามเขียน data/canonical/ ตรง, ห้ามสร้าง capability ซ้ำถ้ามีอยู่แล้ว.
 */
import { reserveAndRegister } from "../../control/duplicate-reservation/contract";
import { createPersistentFileStore } from "../registry-database/adapters/persistent-file-store";
import type { RegistrationCandidate } from "../../control/event-pipeline/registration-contract";

const candidate: RegistrationCandidate = {
  candidate_id: "capability-claude-execution-boundary",
  name: "claude-execution-boundary",
  kind: "capability",
  source_location: "control/claude-execution-boundary/",
  owner: "control/claude-execution-boundary/contract.ts",
  input: ["ClaudeBoundaryRequest{provider,objective,workspace,execution_mode,caller,task_id,work_order_id}"],
  output: ["ClaudeBoundaryResult{status,text,messages,exit_code,authenticated,api_key_source,env_names,sanitized_argv,executable,sandbox_profile_hash}"],
  side_effects: [
    "spawns the canonical local Claude Code executable under a dedicated sandbox-exec profile",
    "writes one profile file per launch under $TMPDIR/dna-os-claude-boundary",
  ],
  dependencies: ["control/agent-host/contract.ts#resolveWorker", "control/runtime-adapter/contract.ts#escapeSbplString"],
  behavior:
    "Runs the Claude Code installation already authenticated on this Mac using the machine's own OAuth session, "
    + "with no Anthropic API key. The caller supplies only an objective and an approved workspace; executable, argv, "
    + "environment (PATH/TMPDIR/HOME/USER) and sandbox profile are all fixed inside the boundary. The two privileges "
    + "machine auth requires — exec /usr/bin/security and read ~/Library/Keychains — exist only in this boundary's own "
    + "profile and are proven to remain denied to the general Agent sandbox. When machine authentication is unavailable "
    + "it reports AUTH_UNAVAILABLE and never falls back to an API key.",
  version: "1.0.0",
  evidence_refs: [
    "ev-agent-exec-c0pg33xysk8mtka62r3",
    "ev-agent-exec-j2d65irrkopmtka62r5",
    "control/claude-execution-boundary/tests/boundary.test.ts",
    "control/claude-execution-boundary/tests/isolation.test.ts",
  ],
  domain: "SOFTWARE_CONTROL_PLANE",
  resource_type: "CAPABILITY",
  data_classification: "INTERNAL",
  source_system: "dna-os-infrastructure",
  scope: "agent-execution",
  requested_owner: "t23598788-oss",
  requested_repository: "-DNA-OS-INFRASTRUCTURE-",
  origin: {
    origin_kind: "OWNER_TASK",
    origin_reference: "IMPLEMENT_LOCAL_CLAUDE_CODE_TRUSTED_EXECUTION_BOUNDARY",
    introduced_by: "control/agent-gateway/agent-host-dispatch.ts",
  },
};

const result = reserveAndRegister(candidate, () => createPersistentFileStore(), `reg-claude-boundary-${Date.now()}`, "software/capability-registrar/register-claude-execution-boundary.ts", 60_000);
console.log("reservation_outcome =", result.reservation_outcome);
const pipeline = result.pipeline_result;
console.log("pipeline_status     =", pipeline?.status ?? "(none)");
if (pipeline?.status === "REGISTERED") {
  console.log("resource_id         =", pipeline.resource_id);
  console.log("capability_id       =", pipeline.capability_id);
} else if (pipeline) {
  console.log("reason_code         =", pipeline.reason_code);
  if (pipeline.status === "DUPLICATE") console.log("duplicate_of        =", JSON.stringify(pipeline.duplicate_of));
}
