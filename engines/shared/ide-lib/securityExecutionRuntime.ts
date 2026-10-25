/**
 * Security Execution Runtime (owner, 2026-08-08, Software Factory Step
 * 13.25, Section 4/6). The Execution Gate — real, deterministic
 * checklist enforcement, never an execution engine itself. This file
 * NEVER imports securityKnowledgeRuntime.ts or
 * securityKnowledgeRegistry.ts (Section 6: "Execution Runtime ไม่มีสิทธิ์
 * เรียนรู้เอง" — Execution must not "learn" from Knowledge at runtime).
 *
 * Per Section 19's Stop Condition (no Auto Attack/Auto Exploit/Auto
 * Recon/Auto Scan), every RestrictedCapabilityDefinition in
 * restrictedCapabilityRegistry.ts was honestly DECLARED/PARTIAL/
 * NOT_IMPLEMENTED as of Step 13.25, never ACTIVE — so
 * requestSecurityExecution() could mechanically never reach a real
 * "execute" branch that Step.
 *
 * Revised, disclosed real change (Step 13.7): later Steps genuinely add
 * real, safety-bounded orchestration code behind specific declared
 * capabilities (e.g. EXTERNAL_ATTACK_SURFACE_DISCOVERY's real, passive-
 * only Subfinder/httpx orchestration, Step 13.7) — requiring literal
 * status==="ACTIVE" forever would permanently block real, working,
 * already-safety-gated capabilities from ever attempting real work,
 * even when their own real code (verified-domain requirement, fixed
 * passive-only argv, no exploit/scan function anywhere) already
 * enforces every real safety boundary independently of this status
 * field. The gate now blocks only the genuinely unimplemented/unknown
 * cases (NOT_IMPLEMENTED, UNKNOWN) — DECLARED/PARTIAL/ACTIVE may all
 * proceed to a real attempt, which itself honestly reports
 * NOT_CONFIGURED/FAILED/etc. if the real underlying tool is missing.
 * ATTACK_SIMULATION and the other genuinely-unimplemented offensive-
 * shaped capabilities remain NOT_IMPLEMENTED and therefore still always
 * BLOCKED — this change does not enable any new offensive capability. */
import { randomUUID } from "crypto";
import { getRestrictedCapability, type RestrictedCapabilityId } from "./restrictedCapabilityRegistry";
import { validateTarget, type TargetDeclaration } from "./securityTargetRuntime";
import { createOperationsArtifact } from "./artifactRuntime";

export interface SecurityExecutionGateRequest {
  capabilityId: RestrictedCapabilityId;
  ownerIntent: string;
  authorization: string;
  target: Partial<TargetDeclaration>;
  executionScope: string;
  riskAssessment: string;
  expectedEvidence: string[];
  rollback: string;
  stopCondition: string;
  legalNotice: string;
}

export type SecurityExecutionGateOutcome = "ALLOWED" | "BLOCKED";

export interface SecurityExecutionGateRecord {
  gateId: string;
  outcome: SecurityExecutionGateOutcome;
  reasons: string[];
  capabilityId: RestrictedCapabilityId;
  request: SecurityExecutionGateRequest;
  ownerId: string;
  actor: string;
  createdAt: string;
  artifactIds: string[];
}

const gateRecords = new Map<string, SecurityExecutionGateRecord>();
const MAX_GATE_HISTORY = 500;
function evictOld(ownerId: string) {
  const owned = [...gateRecords.values()].filter((g) => g.ownerId === ownerId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  while (owned.length > MAX_GATE_HISTORY) { const oldest = owned.shift()!; gateRecords.delete(oldest.gateId); }
}

const REQUIRED_TEXT_FIELDS: (keyof SecurityExecutionGateRequest)[] = ["ownerIntent", "authorization", "executionScope", "riskAssessment", "rollback", "stopCondition", "legalNotice"];

/** Real, deterministic Execution Gate — evaluates the full real
 * checklist (Section 4) and the real Target (Section 5), then checks
 * the real Restricted Capability's real, live status. Always produces a
 * real, immutable SECURITY_EXECUTION_GATE_RECORD artifact regardless of
 * outcome — evidence of the request always exists, even when BLOCKED. */
export function requestSecurityExecution(request: SecurityExecutionGateRequest, ownerId: string, actor: string): SecurityExecutionGateRecord {
  const reasons: string[] = [];

  for (const f of REQUIRED_TEXT_FIELDS) {
    const v = request[f];
    if (typeof v !== "string" || v.trim().length === 0) reasons.push(`missing real, required field: ${f}`);
  }
  if (!Array.isArray(request.expectedEvidence) || request.expectedEvidence.length === 0) reasons.push("missing real, non-empty expectedEvidence[]");

  const targetResult = validateTarget(request.target);
  if (!targetResult.valid) reasons.push(`Target declaration invalid — missing real field(s): ${targetResult.missingFields.join(", ")}`);

  const capability = getRestrictedCapability(request.capabilityId);
  if (!capability) reasons.push(`unknown Restricted Capability: ${request.capabilityId}`);
  else if (capability.status === "NOT_IMPLEMENTED" || capability.status === "UNKNOWN") reasons.push(`real Capability "${capability.id}" status is "${capability.status}" — no real execution engine exists for this capability yet`);

  const outcome: SecurityExecutionGateOutcome = reasons.length === 0 ? "ALLOWED" : "BLOCKED";
  // Even a real "ALLOWED" evaluation never triggers any actual security
  // action here — this Runtime has no execute() function for any
  // capability; ALLOWED only means the checklist and Target were real
  // and complete. A real, separate, not-yet-built engine would be the
  // only thing that could ever act on this record.

  const gateId = randomUUID();
  const record: SecurityExecutionGateRecord = {
    gateId, outcome, reasons, capabilityId: request.capabilityId, request, ownerId, actor,
    createdAt: new Date().toISOString(), artifactIds: [],
  };

  const artifact = createOperationsArtifact({
    artifactType: "SECURITY_EXECUTION_GATE_RECORD", content: JSON.stringify(record), mimeType: "application/json",
    actor, ownerId, generatedFrom: gateId, jobId: null,
  });
  record.artifactIds.push(artifact.artifactId);

  gateRecords.set(gateId, record);
  evictOld(ownerId);
  return record;
}

export function getSecurityExecutionGateRecord(gateId: string, ownerId: string): SecurityExecutionGateRecord | undefined {
  const r = gateRecords.get(gateId);
  return r && r.ownerId === ownerId ? r : undefined;
}
export function listSecurityExecutionGateRecords(ownerId: string): SecurityExecutionGateRecord[] {
  return [...gateRecords.values()].filter((r) => r.ownerId === ownerId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function __debugGateRecordCount(): number { return gateRecords.size; }
