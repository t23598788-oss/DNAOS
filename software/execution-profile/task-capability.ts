/**
 * หน้าที่: คำศัพท์ "ความสามารถของงาน" (task capability) — สิ่งที่งานต้องการ
 * ไม่ใช่ชื่อโมดูลและไม่ใช่ชื่อผู้ให้บริการ (Owner, PHASE 2 ข้อ 1-2).
 *
 * กฎรับเข้าที่เข้มที่สุดของไฟล์นี้: **capability หนึ่งตัวจะมีได้ก็ต่อเมื่อชี้ได้ว่า
 * "อะไรทำมันได้จริง"** ทุกตัวจึงผูกกับ `provided_by` ที่เป็นคำประกาศจริงในระบบ
 * (allowed_operations ของ Process Gate, action ที่ agent-script.mjs รองรับจริง,
 * ธง argv ที่จำกัดพฤติกรรม) หรือหลักฐานการรันที่มี evidence id
 *
 * สิ่งที่ตั้งใจ "ไม่ประกาศ" มีความหมายเท่ากับสิ่งที่ประกาศ:
 *   code_modification ไม่มีผู้ให้บริการในระบบวันนี้ — worker ที่เขียนโค้ดได้จริง
 *   ถูกจำกัดด้วย `--permission-mode plan` (Claude) และ `-s read-only` (Codex)
 *   ส่วน action เขียนไฟล์ของ LOCAL เป็นเครื่องมือพิสูจน์ขอบเขต ไม่ใช่ตัวแก้โค้ด
 *   การประกาศว่ามีทั้งที่ไม่มี คือการทำให้ผู้เลือกทรัพยากรเลือกผิด
 *
 * Input: none (ค่าคงที่ + การพิสูจน์).
 * Output: `TASK_CAPABILITIES`, `TaskCapabilityDefinition`.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่ม capability ที่ไม่มี `provided_by` จริง,
 * ห้ามตั้งชื่อ capability ตามชื่อโมดูลหรือผู้ให้บริการ.
 */

export interface CapabilityProof {
  /** คำประกาศหรือหลักฐานจริงที่ทำให้เชื่อได้ว่ามีความสามารถนี้ */
  source: string;
  kind: "DECLARED_OPERATION" | "DECLARED_ACTION" | "RUNTIME_EVIDENCE" | "SOURCE_PROOF";
  detail: string;
}

export interface TaskCapabilityDefinition {
  /** ชื่อเชิงความหมายของงาน — ห้ามเป็นชื่อโมดูล/ผู้ให้บริการ */
  canonical_name: string;
  purpose: string;
  input_contract: string;
  output_contract: string;
  side_effects: readonly string[];
  /** โมดูลที่ให้ความสามารถนี้ (source_location ของ canonical resource) */
  provided_by: readonly { source_location: string; proof: CapabilityProof }[];
}

const P = (source: string, kind: CapabilityProof["kind"], detail: string): CapabilityProof => ({ source, kind, detail });

/**
 * คำศัพท์ที่ประกาศได้จริงวันนี้ — สั้นโดยตั้งใจ
 * รายการนี้จะยาวขึ้นเมื่อมีเครื่องมือที่พิสูจน์ได้เพิ่ม ไม่ใช่เมื่อเรานึกคำได้เพิ่ม
 */
export const TASK_CAPABILITIES: readonly TaskCapabilityDefinition[] = [
  {
    canonical_name: "repository_metadata_read",
    purpose: "อ่านข้อมูลระบุตัวตนของ repository (root path, branch ปัจจุบัน) โดยไม่แตะเนื้อไฟล์",
    input_contract: "{ cwd: absolute_path }",
    output_contract: "{ stdout: string, exit_code: number }",
    side_effects: [],
    provided_by: [{
      source_location: "connections/agent-registry",
      proof: P("execution/run/process-registry.ts#git.rev-parse-toplevel, #git.branch-show-current",
        "DECLARED_OPERATION", 'allowed_operations: ["read"] บน /usr/bin/git สองรายการ'),
    }],
  },
  {
    canonical_name: "build_execution",
    purpose: "รันขั้นตอน build ของ candidate workspace แล้วคืนผลลัพธ์ที่ตรวจได้",
    input_contract: "{ cwd: /tmp/dna-os-agent-workspaces/<workspace> }",
    output_contract: "{ exit_code: number, stdout: string, stderr: string }",
    side_effects: ["สร้างไฟล์ผลลัพธ์ของ build ภายใน workspace"],
    provided_by: [{
      source_location: "control/agent-gateway",
      proof: P("execution/run/process-registry.ts#candidate.node.npm.build",
        "DECLARED_OPERATION", 'allowed_operations: ["build"] · confinement: policy'),
    }],
  },
  {
    canonical_name: "test_execution",
    purpose: "รันชุดทดสอบของ candidate workspace แล้วคืนผลลัพธ์ที่ตรวจได้",
    input_contract: "{ cwd: /tmp/dna-os-agent-workspaces/<workspace> }",
    output_contract: "{ exit_code: number, stdout: string, stderr: string }",
    side_effects: [],
    provided_by: [{
      source_location: "control/agent-gateway",
      proof: P("execution/run/process-registry.ts#candidate.node.npm.test",
        "DECLARED_OPERATION", 'allowed_operations: ["test"] · confinement: policy'),
    }],
  },
  {
    canonical_name: "credential_reference_read",
    purpose: "อ่านความลับที่อ้างด้วย credential_ref ออกจากที่เก็บของระบบปฏิบัติการ ในโปรเซสที่เชื่อถือได้",
    input_contract: "{ service: string, account: string }",
    output_contract: "{ resolved: boolean, credential_source: string }",
    side_effects: ["เปิดอ่านรายการใน macOS Keychain"],
    provided_by: [{
      source_location: "credentials/macos-keychain",
      proof: P("execution/run/process-registry.ts#keychain.find-generic-password",
        "DECLARED_OPERATION", 'allowed_operations: ["read"] · credential_profile: keychain_read · allowed_callers ผูกไว้ตัวเดียว'),
    }],
  },
  {
    canonical_name: "credential_reference_write",
    purpose: "บันทึกความลับใหม่ลงที่เก็บของระบบปฏิบัติการ โดยทะเบียนถือเพียงตัวชี้",
    input_contract: "{ service: string, account: string, secret: string }",
    output_contract: "{ credential_ref: string, status: ACTIVE }",
    side_effects: ["เขียนรายการใหม่ลง macOS Keychain", "เพิ่มแถวตัวชี้ใน credentials/registry"],
    provided_by: [{
      source_location: "credentials/macos-keychain",
      proof: P("execution/run/process-registry.ts#keychain.add-generic-password",
        "DECLARED_OPERATION", 'allowed_operations: ["write"] · credential_profile: keychain_write'),
    }],
  },
  {
    canonical_name: "source_analysis",
    purpose: "อ่านและวิเคราะห์เนื้อหาใน workspace ที่ได้รับมอบหมาย แล้วคืนข้อสรุปเป็นข้อความ โดยไม่แก้ไขสิ่งใด",
    input_contract: "{ objective: string, workspace: absolute_path }",
    output_contract: "{ text: string, messages: string[] }",
    side_effects: [],
    provided_by: [{
      source_location: "control/claude-execution-boundary",
      proof: P("control/claude-execution-boundary/boundary.ts#FIXED_ARGV",
        "SOURCE_PROOF", '--permission-mode plan บังคับให้ได้ผลเป็นข้อความ ไม่ใช่การแก้ไข และการรันจริงคืนข้อความตามที่สั่ง (ev-agent-exec-7bzaqxyvplumtkb0yb1)'),
    }],
  },
  {
    canonical_name: "workspace_file_read",
    purpose: "อ่านไฟล์ที่อยู่ภายในพื้นที่ทำงานที่ได้รับมอบหมายเท่านั้น",
    input_contract: '{ action: "read_allowed", relPath: string }',
    output_contract: "{ outcome: SUCCEEDED|BLOCKED, bytes: number }",
    side_effects: [],
    provided_by: [{
      source_location: "control/agent-host",
      proof: P("control/agent-host/agent-script.mjs", "DECLARED_ACTION",
        'case "read_allowed" อ่านได้เฉพาะใน process.cwd() ซึ่งกรง sandbox บังคับไว้'),
    }],
  },
  {
    canonical_name: "workspace_file_write",
    purpose: "เขียน/แก้ไฟล์ตามเนื้อหาที่ผู้เรียกกำหนด ภายในพื้นที่ทำงานที่ได้รับมอบหมายเท่านั้น แล้วคืนผลว่าสำเร็จหรือถูกปฏิเสธ",
    input_contract: '{ action: "write_direct_allowed_attempt", relPath: string, content: string }',
    output_contract: "{ outcome: SUCCEEDED|BLOCKED, error?: { code, message } }",
    side_effects: ["เขียนไฟล์ภายใน allowed_write_workspace เท่านั้น"],
    provided_by: [{
      source_location: "control/agent-host",
      proof: P("ev-agent-exec-c52zoxbxulmtkdbmp8, ev-agent-exec-f42k4skz7vvmtkdbmp8",
        "RUNTIME_EVIDENCE",
        'รันจริงผ่าน runAgentWorkOrder: ไฟล์ในพื้นที่เปลี่ยนจาก "BEFORE" เป็น "AFTER-BY-RESOURCE" (status=PASS) และการเขียนนอกพื้นที่ถูกปฏิเสธ (status=BLOCKED, ไฟล์ไม่ถูกสร้าง)'),
    }],
  },
  {
    canonical_name: "execution_boundary_probe",
    purpose: "ทดสอบขอบเขตสิทธิ์ของผู้รันงานแล้วรายงานว่าถูกอนุญาตหรือถูกปฏิเสธ พร้อมรหัสข้อผิดพลาดจริง",
    input_contract: '{ action: "exec_git"|"exec_gh"|"exec_security"|"attempt_network"|... }',
    output_contract: "{ outcome: SUCCEEDED|BLOCKED, error: { code, message } }",
    side_effects: [],
    provided_by: [{
      source_location: "control/agent-host",
      proof: P("control/agent-host/agent-script.mjs", "DECLARED_ACTION",
        "17 action ที่รองรับจริง โดยกลุ่ม exec_* ถูกกรงปฏิเสธและรายงาน EPERM กลับมา"),
    }],
  },
];

/**
 * ความสามารถที่ "งานต้องการได้" แต่ยังไม่มีผู้ให้บริการในระบบ
 *
 * ประกาศไว้เพื่อให้ระบบตอบได้ว่าขาดอะไร ไม่ใช่เพื่อให้ดูเหมือนมี — ทั้งหมดนี้จะมี
 * `provided_by` ว่างเสมอจนกว่าจะมีเครื่องมือที่พิสูจน์ได้จริงมาเติม
 */
export const UNPROVIDED_TASK_CAPABILITIES: readonly TaskCapabilityDefinition[] = [
  {
    canonical_name: "code_modification",
    purpose: "แก้ไขไฟล์ต้นฉบับในพื้นที่ทำงานที่แยกไว้ แล้วคืนรายการไฟล์ที่เปลี่ยน",
    input_contract: "{ objective: string, workspace: absolute_path }",
    output_contract: "{ files_changed: string[], diff_evidence: string }",
    side_effects: ["เขียนไฟล์ภายใน workspace ที่แยกไว้"],
    provided_by: [],
  },
  {
    canonical_name: "business_database_read",
    purpose: "อ่านข้อมูลธุรกิจแบบอ่านอย่างเดียว พร้อมตรวจโครงสร้างและนับจำนวนแถว โดยผลิตหลักฐานได้",
    input_contract: "{ schema_inspection: boolean, bounded_select: { limit: number }, row_count: boolean }",
    output_contract: "{ rows: unknown[], row_count: number, schema: unknown, evidence_id: string }",
    side_effects: [],
    provided_by: [],
  },
  {
    canonical_name: "browser_interaction",
    purpose: "ควบคุมเบราว์เซอร์จริงเพื่ออ่านหรือกระทำบนหน้าเว็บ พร้อมหลักฐานภาพ/DOM",
    input_contract: "{ target: string, actions: unknown[] }",
    output_contract: "{ observations: unknown[], evidence_id: string }",
    side_effects: ["โต้ตอบกับแอปพลิเคชันจริงบนเครื่อง"],
    provided_by: [],
  },
  {
    canonical_name: "repository_write",
    purpose: "เขียนกลับเข้า repository จริง (commit/push) ผ่านอำนาจของ DNA OS",
    input_contract: "{ branch_ref: string, changes: unknown[] }",
    output_contract: "{ commit_sha: string, evidence_id: string }",
    side_effects: ["เปลี่ยนสถานะ repository"],
    provided_by: [],
  },
];
