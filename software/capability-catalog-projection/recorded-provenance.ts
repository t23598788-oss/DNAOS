/**
 * หน้าที่: provenance ของ contract ที่ **ถูกบันทึกไว้แล้ว** ใน
 * governance/architecture-rules/SEMANTIC_CANDIDATE_AND_CONTRACT_DISCOVERY.md
 * (PHASE 2 — CONTRACT DISCOVERY)
 *
 * ไฟล์นี้ไม่ค้นหาอะไรใหม่ ไม่สรุปอะไรเอง มันเป็นการถอดตารางในเอกสารนั้น
 * ออกมาเป็นค่าที่เครื่องอ่านได้ เพื่อให้ projection **ตรวจซ้ำได้** ว่า source
 * ยังตรงกับที่บันทึกไว้หรือไม่
 *
 * agent-gateway จงใจไม่อยู่ในไฟล์นี้ — สถานะของมันคือ PARTIAL
 * (มี 2 invocation surface ที่อาจมี output ต่างกัน และ submitTask สกัด
 * return type จาก source ไม่ได้) จึงต้องไม่กลายเป็น projected executable
 *
 * Input: none (ค่าคงที่).
 * Dependency ที่อนุญาต: ./types.ts (type only).
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่มรายการที่ไม่มีอยู่ในเอกสาร PHASE 2 และห้ามเติม
 * type/validator/test ที่ไม่ได้ถูกพิสูจน์ไว้แล้ว — ไฟล์นี้เป็นสำเนาของหลักฐาน
 * ไม่ใช่ที่สำหรับสร้างหลักฐานใหม่
 */

import type { ContractEvidenceLevel, ContractProvenance } from "./types";

export interface RecordedContractCandidate {
  readonly capability_id: string;
  readonly canonical_name: string;
  /**
   * invocation surface ที่ contract นี้เป็นของ — null เมื่อ capability มี surface เดียว
   *
   * capability หนึ่งตัวมีได้หลาย surface และ **แต่ละ surface มี contract ของตัวเอง**
   * (พิสูจน์แล้วกับ agent-gateway: route:dispatcher คืน Task ส่วน
   *  route:voice-bridge คืน EnabledState — คนละชนิดจริง)
   * capability จะ COMPLETE ได้ก็ต่อเมื่อ **ทุก surface** มี contract ที่พิสูจน์ได้
   */
  readonly surface?: string | null;
  readonly entry_source: string;
  readonly entry_symbol: string;
  /** ชื่อ type ที่ต้องปรากฏใน signature จริง — ใช้ตรวจซ้ำ */
  readonly input_types: readonly string[];
  readonly output_types: readonly string[];
  readonly input_level: ContractEvidenceLevel;
  readonly output_level: ContractEvidenceLevel;
  readonly provenance: readonly ContractProvenance[];
}

const DOC = "governance/architecture-rules/SEMANTIC_CANDIDATE_AND_CONTRACT_DISCOVERY.md#PHASE-2";

export const RECORDED_CONTRACT_CANDIDATES: readonly RecordedContractCandidate[] = [
  {
    capability_id: "capability-b4a67fea-f3a6-41b3-91c2-cbdb8223977e",
    canonical_name: "github-source-executor",
    entry_source: "connections/github/github-adapter.ts", entry_symbol: "handleGithubCommand",
    input_types: ["CommandEnvelope"], output_types: ["GithubAdapterOutcome"],
    input_level: "PROVEN_VALIDATOR", output_level: "PROVEN_BY_TEST",
    provenance: [{
      source_location: "connections/github/github-adapter.ts", symbol: "handleGithubCommand",
      type_or_schema: "(command: CommandEnvelope) => Promise<GithubAdapterOutcome>",
      validator: "connections/github/payload-validation.ts#checkCheckAccessPayload,checkReadStatusPayload",
      test: "connections/github/adapter.test.ts", evidence_reference: DOC,
    }],
  },
  {
    capability_id: "capability-84f9dc65-4427-478d-8103-c42032ef4d46",
    canonical_name: "agent-host",
    entry_source: "control/agent-gateway/agent-host-dispatch.ts", entry_symbol: "runAgentWorkOrder",
    input_types: ["WorkOrder"], output_types: ["DnaOsAgentResult"],
    input_level: "PROVEN_VALIDATOR", output_level: "PROVEN_VALIDATOR",
    provenance: [{
      source_location: "control/agent-gateway/agent-host-dispatch.ts", symbol: "runAgentWorkOrder",
      type_or_schema: "(workOrder: WorkOrder, origin, hostEnv) => Promise<DnaOsAgentResult>",
      validator: "control/agent-gateway/agent-host-dispatch.ts#validateRequestedActions + FAIL_CLOSED/MALFORMED_RESULT",
      test: "control/agent-gateway/tests/", evidence_reference: DOC,
    }],
  },
  {
    capability_id: "capability-41201bc7-06b6-4b54-a2c5-c15a32af0597",
    canonical_name: "execution-run",
    entry_source: "execution/run/executor.ts", entry_symbol: "startExecution",
    input_types: ["ExecutionRequest"], output_types: ["ExecutionResult"],
    input_level: "PROVEN_TYPE", output_level: "PROVEN_BY_TEST",
    provenance: [{
      source_location: "execution/run/executor.ts", symbol: "startExecution",
      type_or_schema: "(request: ExecutionRequest, decision?: ExecutionPermissionDecision) => ExecutionResult",
      validator: null, test: "execution/run/tests/executor.test.ts", evidence_reference: DOC,
    }],
  },
  {
    capability_id: "capability-10878d16-b979-4d88-b79f-264345480ae0",
    canonical_name: "execution-policy",
    entry_source: "permissions/execution-policy/policy.ts", entry_symbol: "evaluateExecutionPermission",
    input_types: ["ExecutionPermissionRequest", "ExecutionPolicyContext"],
    output_types: ["ExecutionPermissionDecision"],
    input_level: "PROVEN_TYPE", output_level: "PROVEN_BY_TEST",
    provenance: [{
      source_location: "permissions/execution-policy/policy.ts", symbol: "evaluateExecutionPermission",
      type_or_schema: "(request: ExecutionPermissionRequest, context: ExecutionPolicyContext, nowIso?) => ExecutionPermissionDecision",
      validator: null, test: "permissions/execution-policy/tests/policy.test.ts", evidence_reference: DOC,
    }],
  },
  {
    capability_id: "capability-72010057-6a4e-4dd7-a94d-a84504543dca",
    canonical_name: "digitalocean-adapter",
    entry_source: "connections/digitalocean/router-invoker.ts", entry_symbol: "invokeDigitalOceanConnector",
    input_types: ["CommandEnvelope"], output_types: ["ConnectorBoundaryOutcome"],
    input_level: "PROVEN_TYPE", output_level: "PROVEN_BY_TEST",
    provenance: [{
      source_location: "connections/digitalocean/router-invoker.ts", symbol: "invokeDigitalOceanConnector",
      type_or_schema: "ConnectorInvoker = async (command: CommandEnvelope) => Promise<ConnectorBoundaryOutcome>",
      validator: null, test: "connections/digitalocean/tests/adapter.test.ts", evidence_reference: DOC,
    }],
  },
  {
    capability_id: "capability-37d56fb3-ee6d-4cb4-89c8-afd6a248142a",
    canonical_name: "os-login",
    entry_source: "connections/os-login/adapter-contract.ts", entry_symbol: "requestOsLogin",
    input_types: ["OsLoginRequest"], output_types: ["OsLoginOutcome"],
    input_level: "PROVEN_VALIDATOR", output_level: "PROVEN_TYPE",
    provenance: [{
      source_location: "connections/os-login/adapter-contract.ts", symbol: "requestOsLogin",
      type_or_schema: "(request: OsLoginRequest) => Promise<OsLoginOutcome>",
      validator: "connections/os-login/adapter-contract.ts#parseOsLoginTarget",
      test: null, evidence_reference: DOC,
    }],
  },
  {
    capability_id: "capability-0de653bb-c968-4168-85c6-9d67beef2b5a",
    canonical_name: "os-ui",
    entry_source: "connections/os-ui/adapter-contract.ts", entry_symbol: "openOsUi",
    input_types: ["OsUiTarget"], output_types: ["OsUiOutcome"],
    input_level: "PROVEN_VALIDATOR", output_level: "PROVEN_BY_TEST",
    provenance: [{
      source_location: "connections/os-ui/adapter-contract.ts", symbol: "openOsUi",
      type_or_schema: "(target: OsUiTarget) => Promise<OsUiOutcome>",
      validator: "connections/os-ui/adapter-contract.ts#parseOsUiTarget",
      test: "connections/os-ui/tests/", evidence_reference: DOC,
    }],
  },
  {
    capability_id: "capability-ef6ae97d-9e06-465e-b96f-ee7394dc5e0c",
    canonical_name: "agent-gateway", surface: "route:dispatcher",
    entry_source: "control/agent-gateway/gateway.ts", entry_symbol: "submitTask",
    input_types: ["WorkOrder", "MemoryReference"], output_types: ["Task"],
    input_level: "PROVEN_TYPE", output_level: "PROVEN_BY_TEST",
    provenance: [{
      source_location: "control/agent-gateway/gateway.ts", symbol: "submitTask",
      type_or_schema: "(intentText: string, memory: Omit<MemoryReference,'task_id'|'created_at'>, clientId: string, adapters: readonly AgentAdapter[], workOrder?: WorkOrder, routeContext?: Task['route_context']) => Promise<Task>",
      validator: null, test: "control/agent-gateway/tests/", evidence_reference: DOC,
    }],
  },
  {
    capability_id: "capability-ef6ae97d-9e06-465e-b96f-ee7394dc5e0c",
    canonical_name: "agent-gateway", surface: "route:voice-bridge",
    entry_source: "control/agent-gateway/voice-bridge.ts", entry_symbol: "setVoiceBridgeEnabled",
    input_types: ["boolean"], output_types: ["EnabledState"],
    input_level: "PROVEN_TYPE", output_level: "PROVEN_TYPE",
    provenance: [{
      source_location: "control/agent-gateway/voice-bridge.ts", symbol: "setVoiceBridgeEnabled",
      type_or_schema: "(enabled: boolean, approvedBy: string) => EnabledState",
      validator: null, test: "control/agent-gateway/tests/", evidence_reference: DOC,
    }],
  },
  {
    capability_id: "capability-ef1c94f4-f122-4969-aa4f-480128cb0cab",
    canonical_name: "research-engine",
    entry_source: "connections/research-engine/research-engine-adapter.ts",
    entry_symbol: "fetchResearchEngineLatestResult",
    input_types: ["FetchResearchEngineOptions"], output_types: ["ResearchEngineStepOutcome"],
    input_level: "PROVEN_TYPE", output_level: "PROVEN_TYPE",
    provenance: [{
      source_location: "connections/research-engine/research-engine-adapter.ts",
      symbol: "fetchResearchEngineLatestResult",
      type_or_schema: "(options?: FetchResearchEngineOptions) => Promise<ResearchEngineStepOutcome>",
      validator: "connections/research-engine/payload-validation.ts",
      test: null, evidence_reference: DOC,
    }],
  },
];

/**
 * capability ที่ discovery จบด้วย PARTIAL — ห้ามเป็น projected executable
 *
 * agent-gateway ถูกถอดออกจากรายการนี้เมื่อ 2026-09-01 หลังตรวจ source จริง:
 * output ของทั้งสอง surface พิสูจน์ได้ตรง ๆ จาก signature
 * (`submitTask(...): Promise<Task>` ที่ gateway.ts:573 และ
 *  `setVoiceBridgeEnabled(enabled, approvedBy): EnabledState` ที่ voice-bridge.ts:143)
 * สาเหตุเดิมที่ระบุว่า "สกัด return type ไม่ได้" เป็นข้อผิดพลาดของการสกัดด้วย regex
 * ไม่ใช่การขาดหลักฐาน — จึงบันทึก contract ราย surface แทนการคง PARTIAL ไว้โดยไม่มีเหตุ
 */
export const RECORDED_PARTIAL: readonly { capability_id: string; canonical_name: string; missing: string; reason: string }[] = [];
