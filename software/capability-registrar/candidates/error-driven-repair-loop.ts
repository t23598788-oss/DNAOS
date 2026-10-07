/**
 * หน้าที่: the `RegistrationCandidate` for the error-driven code completion
 * loop — gap queue, root-cause analysis, repair contract, ten-stage
 * deterministic verification, and loop protection — submitted through
 * `control/registration-pipeline/`'s existing stages into
 * `software/registry-database/`'s canonical persistent store.
 *
 * WHY THIS IS NOT A DUPLICATE OF `control/incident-remediation/`: that
 * capability handles RUNTIME incidents — a service is down, restart it, fail
 * over, escalate. This one handles SOURCE gaps — a capability is unregistered,
 * a connection is missing, evidence is misleading — and its output is a
 * verified code change, never a restart. They share no store, no contract and
 * no decision.
 *
 * WHAT IT IS NOT: an executor of its own. Promotion happens only after the
 * real `permissions/write-gate` returns ALLOW, and the agent's proposal has
 * no status field at all, so nothing but this repo's own deterministic checks
 * can say VERIFIED.
 *
 * Input: none (one const value).
 * Output: `ERROR_DRIVEN_REPAIR_LOOP_CANDIDATE`.
 * Dependency ที่อนุญาต: `../../../control/event-pipeline/registration-contract.ts` (type only).
 * สิ่งที่ห้ามแตะ: never edit `evidence_refs` to name a run that did not
 * happen — Duplicate Resolution fingerprints normalized content, so an edit
 * to an already-registered record creates a SECOND resource instead of
 * updating the first.
 */

import type { RegistrationCandidate } from "../../../control/event-pipeline/registration-contract";

export const ERROR_DRIVEN_REPAIR_LOOP_CANDIDATE: RegistrationCandidate = {
  candidate_id: "candidate-error-driven-repair-loop-v1",
  name: "error-driven-repair-loop",
  kind: "capability",
  source_location: "control/repair-loop/ (gap-scanner.ts, root-cause.ts, repair-item.ts, verifier.ts, loop.ts)",
  owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/error-driven-repair-loop.ts",

  input: [
    "no caller input: the queue is built by reading control/command-router CAPABILITY_REGISTRY, software/registry-database canonical rows and relationship edges, and the control/agent-gateway evidence store",
    "optionally an agent function that returns an AgentProposal for one RepairWorkItem",
  ],
  output: [
    "GapRecord queue classified CONNECTED_VERIFIED | CONNECTED_UNVERIFIED | DECLARED_ONLY | MISSING_CONNECTION | BLOCKED | ERROR | UNKNOWN, ordered upstream-first",
    "RootCauseFinding: EXPECTED_POLICY_BLOCK | EXPECTED_BY_DESIGN | MISSING_CONNECTION | CONTRACT_DEFECT | IMPLEMENTATION_DEFECT | MISSING_EVIDENCE | MISLEADING_EVIDENCE | UNDETERMINED, each citing the file and line it read",
    "RepairWorkItem with allowed_paths/forbidden_paths, evidence_refs, existing_tests and a success condition",
    "VerificationVerdict from ten deterministic stages ending in the real write gate, controlled promotion and runtime verification",
    "RepairAttemptRecord ledger keyed by error_signature + code_hash + verifier_version",
  ],
  side_effects: [
    "one outbound routing call through the existing connections/n8n pipe (transport only)",
    "writes a repair-cycle record through the existing control/agent-gateway evidence store",
    "appends to control/repair-loop/data/repair-attempts.jsonl",
    "promotes a source change ONLY after permissions/write-gate returns ALLOW, with rollback from a real backup if runtime verification fails",
  ],
  dependencies: [
    "control/command-router (capability registry — gap classification)",
    "software/registry-database (canonical registry and relationship edges)",
    "control/agent-gateway (evidence store)",
    "permissions/write-gate (the only path to promotion)",
    "software/capability-registrar (folder ownership index)",
    "connections/n8n (routing transport for repair events)",
  ],

  behavior:
    "scan_gaps_root_cause_and_repair_under_deterministic_verification: builds a dependency-ordered gap queue from existing registries and evidence, root-causes the top gap by reading the source that produced it, refuses to dispatch when the cause is an expected policy block, a by-design termination, missing proof or undetermined, otherwise emits a structured RepairWorkItem with an explicit allowed/forbidden path list, routes it through the existing n8n transport, hands the package to an agent whose proposal carries no status field, and puts that proposal through ten deterministic stages — source, contract, dependency, security, isolated test, regression, deterministic verifier, the real write gate, controlled promotion with backup, and runtime verification with automatic rollback. Loop protection stops on MAX_ATTEMPTS_PER_GAP=3, on a repeated error_signature+code_hash pair, and scopes both to the verifier version that produced the verdict.",

  version: "1.0.0",

  evidence_refs: [
    "control/repair-loop/gap-scanner.ts",
    "control/repair-loop/root-cause.ts",
    "control/repair-loop/repair-item.ts",
    "control/repair-loop/verifier.ts",
    "control/repair-loop/loop.ts",
    "control/repair-loop/tests/first-repair-proof.ts",
    "control/repair-loop/data/repair-attempts.jsonl",
    "first real cycle: gap-evidence-AI_WRITE_ADAPTER_NOT_REGISTERED, 280 observed occurrences 2026-08-21..2026-08-26",
    "root cause MISLEADING_EVIDENCE, established by reading control/agent-gateway/gateway.ts:564 and control/external-system-lifecycle/pipeline.ts:175",
    "verdict REJECT_CHANGE at WRITE_GATE with DENY/NO_MATCHING_CAPABILITY — the gate refused a write into a folder no registered capability owns",
    "production source unchanged: control/external-system-lifecycle/pipeline.ts byte-identical before and after the cycle",
    "loop protection proven: a second identical proposal returned NO_PROGRESS before any work was spent",
  ],

  domain: "SOFTWARE_CONTROL_PLANE",
  resource_type: "CAPABILITY",
  data_classification: "INTERNAL",
  source_system: "dna-os-infrastructure",
  scope: "repair/verification",
};
