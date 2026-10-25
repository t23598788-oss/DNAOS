/**
 * Restricted Capability Registry (owner, 2026-08-08, Software Factory
 * Step 13.25, Section 2). Declares the taxonomy of restricted Security
 * Capabilities — never the actual implementation of an attack/exploit
 * engine. Every entry's `status` is honestly DECLARED or
 * NOT_IMPLEMENTED this Step (Section 19 forbids Auto Attack/Auto
 * Exploit/Auto Recon/Auto Scan — no real execution logic exists to back
 * an ACTIVE claim for any offensive-shaped category).
 */
export type RestrictedCapabilityId =
  | "SECURITY_ANALYSIS" | "SECURITY_ASSESSMENT" | "ATTACK_SIMULATION" | "THREAT_MODELING"
  | "API_INSPECTION" | "FIRMWARE_INSPECTION" | "BINARY_ANALYSIS" | "HARDWARE_DIAGNOSTICS"
  | "NETWORK_DIAGNOSTICS" | "LOG_FORENSICS" | "MEMORY_ANALYSIS" | "INFRASTRUCTURE_DIAGNOSTICS"
  | "EXTERNAL_ATTACK_SURFACE_DISCOVERY";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type RestrictedCapabilityStatus = "ACTIVE" | "DECLARED" | "PARTIAL" | "NOT_IMPLEMENTED" | "UNKNOWN";

export interface RestrictedCapabilityDefinition {
  id: RestrictedCapabilityId;
  name: string;
  name_th: string;
  description: string;
  owner: "OWNER_ONLY";
  riskLevel: RiskLevel;
  requiredAuthorization: string;
  evidenceRequirement: string[];
  executionScope: string;
  requiredRuntime: string;
  allowedWorker: string[];
  forbiddenWorker: string[];
  status: RestrictedCapabilityStatus;
}

const ALL_AI_WORKERS_FORBIDDEN = ["ANALYSIS_WORKER", "CODE_WORKER", "REVIEW_WORKER", "TEST_WORKER", "DOCUMENT_WORKER", "UI_WORKER", "SECURITY_WORKER", "DATA_WORKER", "TOOL_WORKER"];

export const RESTRICTED_CAPABILITY_REGISTRY: Record<RestrictedCapabilityId, RestrictedCapabilityDefinition> = {
  SECURITY_ANALYSIS: {
    id: "SECURITY_ANALYSIS", name: "Security Analysis", name_th: "การวิเคราะห์ความปลอดภัย",
    description: "Real, deterministic analysis of already-collected, Owner-scoped evidence (e.g. reusing SECURITY_POLICY_CHECK findings) — never an active probe of a live target.",
    owner: "OWNER_ONLY", riskLevel: "LOW", requiredAuthorization: "Owner Authorization + Execution Gate", evidenceRequirement: ["real Target declaration", "real analysis output artifact"],
    executionScope: "read-only analysis of already-collected evidence", requiredRuntime: "SecurityExecutionRuntime", allowedWorker: ["HUMAN_WORKER"], forbiddenWorker: ALL_AI_WORKERS_FORBIDDEN, status: "DECLARED",
  },
  SECURITY_ASSESSMENT: {
    id: "SECURITY_ASSESSMENT", name: "Security Assessment", name_th: "การประเมินความปลอดภัย",
    description: "Structured, Owner-run assessment against a declared Target — no automated execution engine exists.",
    owner: "OWNER_ONLY", riskLevel: "MEDIUM", requiredAuthorization: "Owner Authorization + Execution Gate + Legal Notice", evidenceRequirement: ["real Target declaration", "real risk assessment", "real assessment report artifact"],
    executionScope: "declared Target only, no live probing engine implemented", requiredRuntime: "SecurityExecutionRuntime", allowedWorker: ["HUMAN_WORKER"], forbiddenWorker: ALL_AI_WORKERS_FORBIDDEN, status: "NOT_IMPLEMENTED",
  },
  ATTACK_SIMULATION: {
    id: "ATTACK_SIMULATION", name: "Attack Simulation", name_th: "การจำลองการโจมตี",
    description: "Explicitly NOT_IMPLEMENTED this Step by mission mandate (Section 19: no Auto Attack/Auto Exploit) — taxonomy entry only.",
    owner: "OWNER_ONLY", riskLevel: "CRITICAL", requiredAuthorization: "Owner Authorization + Execution Gate + Legal Notice + Rollback Plan", evidenceRequirement: ["real Target declaration", "real authorization record", "real rollback plan"],
    executionScope: "no real execution engine exists", requiredRuntime: "SecurityExecutionRuntime", allowedWorker: ["HUMAN_WORKER"], forbiddenWorker: ALL_AI_WORKERS_FORBIDDEN, status: "NOT_IMPLEMENTED",
  },
  THREAT_MODELING: {
    id: "THREAT_MODELING", name: "Threat Modeling", name_th: "การสร้างแบบจำลองภัยคุกคาม",
    description: "Structured, declarative threat-modeling worksheet over a declared Target — no automated exploitation.",
    owner: "OWNER_ONLY", riskLevel: "LOW", requiredAuthorization: "Owner Authorization + Execution Gate", evidenceRequirement: ["real Target declaration", "real threat model artifact"],
    executionScope: "read-only, declarative modeling only", requiredRuntime: "SecurityExecutionRuntime", allowedWorker: ["HUMAN_WORKER"], forbiddenWorker: ALL_AI_WORKERS_FORBIDDEN, status: "DECLARED",
  },
  API_INSPECTION: {
    id: "API_INSPECTION", name: "API Inspection", name_th: "การตรวจสอบ API",
    description: "Reuses this repo's real, already-existing SECURITY_POLICY_CHECK/executionRegistry.ts denylist inspection — read-only against already-registered routes, never a live fuzzing engine.",
    owner: "OWNER_ONLY", riskLevel: "LOW", requiredAuthorization: "Owner Authorization + Execution Gate", evidenceRequirement: ["real Target declaration", "real inspection finding artifact"],
    executionScope: "real, already-registered routes only", requiredRuntime: "SecurityExecutionRuntime", allowedWorker: ["HUMAN_WORKER"], forbiddenWorker: ALL_AI_WORKERS_FORBIDDEN, status: "PARTIAL",
  },
  FIRMWARE_INSPECTION: {
    id: "FIRMWARE_INSPECTION", name: "Firmware Inspection", name_th: "การตรวจสอบเฟิร์มแวร์",
    description: "Explicitly NOT_IMPLEMENTED — no real firmware extraction/analysis engine exists in this repo.",
    owner: "OWNER_ONLY", riskLevel: "HIGH", requiredAuthorization: "Owner Authorization + Execution Gate + Legal Notice", evidenceRequirement: ["real Target declaration", "real hardware ownership proof"],
    executionScope: "no real execution engine exists", requiredRuntime: "SecurityExecutionRuntime", allowedWorker: ["HUMAN_WORKER"], forbiddenWorker: ALL_AI_WORKERS_FORBIDDEN, status: "NOT_IMPLEMENTED",
  },
  BINARY_ANALYSIS: {
    id: "BINARY_ANALYSIS", name: "Binary Analysis", name_th: "การวิเคราะห์ไบนารี",
    description: "Explicitly NOT_IMPLEMENTED — no real disassembler/decompiler integration exists in this repo.",
    owner: "OWNER_ONLY", riskLevel: "MEDIUM", requiredAuthorization: "Owner Authorization + Execution Gate", evidenceRequirement: ["real Target declaration", "real binary provenance"],
    executionScope: "no real execution engine exists", requiredRuntime: "SecurityExecutionRuntime", allowedWorker: ["HUMAN_WORKER"], forbiddenWorker: ALL_AI_WORKERS_FORBIDDEN, status: "NOT_IMPLEMENTED",
  },
  HARDWARE_DIAGNOSTICS: {
    id: "HARDWARE_DIAGNOSTICS", name: "Hardware Diagnostics", name_th: "การวินิจฉัยฮาร์ดแวร์",
    description: "Explicitly NOT_IMPLEMENTED — no real hardware interface driver exists in this repo (Section 10: PLC/ECU/Bootloader/Board/Power/Bus all require Authorized Scope not yet built).",
    owner: "OWNER_ONLY", riskLevel: "HIGH", requiredAuthorization: "Owner Authorization + Execution Gate + Legal Notice", evidenceRequirement: ["real Target declaration", "real hardware ownership proof"],
    executionScope: "no real execution engine exists", requiredRuntime: "SecurityExecutionRuntime", allowedWorker: ["HUMAN_WORKER"], forbiddenWorker: ALL_AI_WORKERS_FORBIDDEN, status: "NOT_IMPLEMENTED",
  },
  NETWORK_DIAGNOSTICS: {
    id: "NETWORK_DIAGNOSTICS", name: "Network Diagnostics", name_th: "การวินิจฉัยเครือข่าย",
    description: "Explicitly NOT_IMPLEMENTED — no real packet capture/network probing engine exists in this repo.",
    owner: "OWNER_ONLY", riskLevel: "MEDIUM", requiredAuthorization: "Owner Authorization + Execution Gate", evidenceRequirement: ["real Target declaration", "real network ownership proof"],
    executionScope: "no real execution engine exists", requiredRuntime: "SecurityExecutionRuntime", allowedWorker: ["HUMAN_WORKER"], forbiddenWorker: ALL_AI_WORKERS_FORBIDDEN, status: "NOT_IMPLEMENTED",
  },
  LOG_FORENSICS: {
    id: "LOG_FORENSICS", name: "Log Forensics", name_th: "นิติวิทยาศาสตร์บันทึกเหตุการณ์",
    description: "Reuses this repo's real Incident Runtime timeline (Step 12) and real Artifact lineage — read-only correlation, never log tampering.",
    owner: "OWNER_ONLY", riskLevel: "LOW", requiredAuthorization: "Owner Authorization + Execution Gate", evidenceRequirement: ["real Target declaration", "real correlation artifact"],
    executionScope: "read-only over already-collected real logs/incidents", requiredRuntime: "SecurityExecutionRuntime", allowedWorker: ["HUMAN_WORKER"], forbiddenWorker: ALL_AI_WORKERS_FORBIDDEN, status: "PARTIAL",
  },
  MEMORY_ANALYSIS: {
    id: "MEMORY_ANALYSIS", name: "Memory Analysis", name_th: "การวิเคราะห์หน่วยความจำ",
    description: "Explicitly NOT_IMPLEMENTED — no real memory dump/analysis engine exists in this repo.",
    owner: "OWNER_ONLY", riskLevel: "HIGH", requiredAuthorization: "Owner Authorization + Execution Gate + Legal Notice", evidenceRequirement: ["real Target declaration", "real system ownership proof"],
    executionScope: "no real execution engine exists", requiredRuntime: "SecurityExecutionRuntime", allowedWorker: ["HUMAN_WORKER"], forbiddenWorker: ALL_AI_WORKERS_FORBIDDEN, status: "NOT_IMPLEMENTED",
  },
  INFRASTRUCTURE_DIAGNOSTICS: {
    id: "INFRASTRUCTURE_DIAGNOSTICS", name: "Infrastructure Diagnostics", name_th: "การวินิจฉัยโครงสร้างพื้นฐาน",
    description: "Reuses this repo's real Global Factory Runtime Dependency Graph (Step 11) — read-only diagnostics over already-computed dependency data.",
    owner: "OWNER_ONLY", riskLevel: "LOW", requiredAuthorization: "Owner Authorization + Execution Gate", evidenceRequirement: ["real Target declaration", "real diagnostics artifact"],
    executionScope: "read-only over already-computed real infrastructure data", requiredRuntime: "SecurityExecutionRuntime", allowedWorker: ["HUMAN_WORKER"], forbiddenWorker: ALL_AI_WORKERS_FORBIDDEN, status: "PARTIAL",
  },
  EXTERNAL_ATTACK_SURFACE_DISCOVERY: {
    id: "EXTERNAL_ATTACK_SURFACE_DISCOVERY", name: "External Attack Surface Discovery", name_th: "การค้นหาพื้นผิวโจมตีภายนอก",
    description: "Real, passive subdomain discovery (Subfinder) + non-invasive HTTP/HTTPS verification (httpx), scoped strictly to Owner-registered and verified Domain Assets — no port scan, exploit, brute-force, or directory fuzzing exists in this capability, ever (Step 13.7). PARTIAL: real orchestration/gate/registry code is complete, but the real subfinder/httpx binaries are not installed in this environment.",
    owner: "OWNER_ONLY", riskLevel: "MEDIUM", requiredAuthorization: "Owner Authorization + Execution Gate + verified Domain Asset", evidenceRequirement: ["real, verified Domain Asset", "real Subdomain Discovery Report", "real DNS Verification Report", "real HTTP Probe Report", "real External Drift Report"],
    executionScope: "passive discovery + non-invasive HTTP verification of Owner-verified domains only", requiredRuntime: "SecurityExecutionRuntime", allowedWorker: ["HUMAN_WORKER"], forbiddenWorker: ALL_AI_WORKERS_FORBIDDEN, status: "PARTIAL",
  },
};

export function listRestrictedCapabilities(): RestrictedCapabilityDefinition[] {
  return Object.values(RESTRICTED_CAPABILITY_REGISTRY);
}
export function getRestrictedCapability(id: string): RestrictedCapabilityDefinition | undefined {
  return RESTRICTED_CAPABILITY_REGISTRY[id as RestrictedCapabilityId];
}
