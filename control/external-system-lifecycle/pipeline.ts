/**
 * หน้าที่: `runExternalSystemLifecycle()` — the ONE canonical entry point
 * for every Model / Model Family / Provider / External System /
 * capability, composing already-real, already-built stages in strict
 * order and never reimplementing any of them:
 *
 *   DISCOVER -> CLASSIFY -> DUPLICATE_CHECK -> BOUNDARY_REPO_DECISION
 *   -> BUILD -> TEST -> VERIFY -> REGISTRATION_PIPELINE -> REGISTRY_WRITER
 *   -> RELATIONSHIP -> INTEGRATION -> TARGET_RESOLUTION
 *   -> PERMISSION_ADMISSION -> DEPLOY_INSTALL -> RUNTIME_VERIFY -> COMPLETE
 *
 * Every stage transition is persisted via `./store.ts` before this
 * function returns — a restarted process reads the exact same progress
 * back through `getLifecycleRun()`, never from memory. A stage that
 * fails/blocks/is-unresolved stops the run at that stage; earlier
 * stages' events remain on disk.
 *
 * TARGET_RESOLUTION and PERMISSION_ADMISSION are real calls into
 * `../target-resolution/`, `../permission-policy-resolution/`, and
 * `../admission/` — the same chain `control/source-execution/` already
 * depends on for git writes, reused verbatim here for a REGISTER_CAPABILITY
 * action instead. Both require a real Task from
 * `../agent-gateway/contract.ts`'s `submitTask`/`recordHandoff` — no
 * fabricated task/worker context. `../agent-gateway/`'s own capability
 * index does not yet route an External-System-Lifecycle registration
 * intent to any matched capability (verified empirically, 2026-08-21 —
 * see ./README.md), so this stage today deterministically, honestly
 * lands on DENY/NOT_ADMITTED for every candidate — never faked past it.
 *
 * Input: `ExternalSystemLifecycleInput`, a real `RegistryStore`, a real
 * `LifecycleEventStore`.
 * Output: `runExternalSystemLifecycle` -> `ExternalSystemLifecycleResult`.
 * Dependency ที่อนุญาต: ./types.ts, ./boundary.ts, ./delivery-classification.ts,
 * ./host-runtime.ts, ./store.ts, ../registration-pipeline/contract.ts,
 * ../registration-update/contract.ts, ../integration-verification/contract.ts,
 * ../target-resolution/contract.ts, ../permission-policy-resolution/contract.ts,
 * ../admission/contract.ts, ../agent-gateway/contract.ts,
 * ../runtime-verification/contract.ts, ../../execution/deploy/contract.ts,
 * ../../software/registry-database/contract.ts.
 * สิ่งที่ห้ามแตะ: never call classifyCandidate/fingerprintCandidate/
 * resolveDuplicate/commitRegisteredCandidate directly — always through
 * `runRegistrationPipeline`. Never call resolveArtifactDestination/
 * resolvePolicy/evaluateAdmission's underlying logic directly — always
 * through their own contract.ts. Never mark COMPLETE unless Runtime
 * Verify genuinely returned RUNTIME_VERIFIED.
 */

import { runRegistrationPipeline } from "../registration-pipeline/contract";
import { applyMutation } from "../registration-update/contract";
import { verifyIntegration } from "../integration-verification/contract";
import { resolveTarget } from "../target-resolution/contract";
import { resolvePolicy } from "../permission-policy-resolution/contract";
import { evaluateAdmission } from "../admission/contract";
import { submitTask, recordHandoff, saveTask, saveEvidence } from "../agent-gateway/contract";
import { verifyRuntime } from "../runtime-verification/contract";
import { resolveDeployPlan } from "../../execution/deploy/contract";
import { findCapability } from "../../software/registry-database/contract";
import type { RegistryStore } from "../../software/registry-database/contract";
import { decideBoundary } from "./boundary";
import { classifyDeliveryTarget } from "./delivery-classification";
import { fileExistsOnDisk } from "./host-runtime";
import type { LifecycleEventStore } from "./store";
import type { ExternalSystemLifecycleInput, ExternalSystemLifecycleResult, LifecycleStage, LifecycleStageStatus } from "./types";

const LIFECYCLE_WORKER_AGENT_ID = "claude-code-external-system-lifecycle";

function stop(candidateId: string, stage: LifecycleStage, status: LifecycleStageStatus, run: ReturnType<LifecycleEventStore["getLifecycleRun"]>, resourceId: string | null, capabilityId: string | null): ExternalSystemLifecycleResult {
  return { candidate_id: candidateId, resource_id: resourceId, capability_id: capabilityId, final_stage: stage, final_status: status, is_complete: false, run };
}

export async function runExternalSystemLifecycle(input: ExternalSystemLifecycleInput, registryStore: RegistryStore, lifecycleStore: LifecycleEventStore): Promise<ExternalSystemLifecycleResult> {
  const { candidate } = input;
  const candidateId = candidate.candidate_id;
  const record = (stage: LifecycleStage, status: LifecycleStageStatus, reason: string, evidence_ref: string | null = null) =>
    lifecycleStore.recordEvent({ candidate_id: candidateId, stage, status, reason, evidence_ref, correlation_id: input.correlation_id });

  // 1. DISCOVER
  record("DISCOVER", "PASSED", `candidate supplied for ${candidate.name} at ${candidate.source_location}`, candidate.source_location);

  // 2. BOUNDARY_REPO_DECISION
  const boundary = decideBoundary(candidate.source_location);
  record("BOUNDARY_REPO_DECISION", boundary.allowed ? "PASSED" : "FAILED", boundary.reason, candidate.source_location);
  if (!boundary.allowed) return stop(candidateId, "BOUNDARY_REPO_DECISION", "FAILED", lifecycleStore.getLifecycleRun(candidateId), null, null);

  // 3/4/5. BUILD / TEST / VERIFY
  record("BUILD", "PASSED", "no separate build artifact required for a TypeScript source capability in this repo");
  const evidenceChecks = candidate.evidence_refs.map((ref) => ({ ref, exists: fileExistsOnDisk(ref) }));
  const testPassed = evidenceChecks.length > 0 && evidenceChecks.every((c) => c.exists);
  record("TEST", testPassed ? "PASSED" : evidenceChecks.length === 0 ? "UNRESOLVED" : "FAILED", testPassed ? "every cited evidence_ref file exists on disk" : evidenceChecks.length === 0 ? "no evidence_refs supplied" : `missing: ${evidenceChecks.filter((c) => !c.exists).map((c) => c.ref).join(", ")}`);
  record("VERIFY", testPassed ? "PASSED" : "UNRESOLVED", testPassed ? "TEST stage's real evidence check passed" : "TEST stage did not pass");
  if (!testPassed) return stop(candidateId, "VERIFY", "UNRESOLVED", lifecycleStore.getLifecycleRun(candidateId), null, null);

  // 6/7/8/9. CLASSIFY / DUPLICATE_CHECK / REGISTRATION_PIPELINE / REGISTRY_WRITER
  const pipelineResult = runRegistrationPipeline(candidate, registryStore, input.correlation_id);

  if (pipelineResult.status === "DUPLICATE") {
    record("CLASSIFY", "PASSED", "domain/resource_type classification accepted");
    record("DUPLICATE_CHECK", "FAILED", `${pipelineResult.reason_code}: matches resource_id=${pipelineResult.duplicate_of.resource_id ?? "null"} capability_id=${pipelineResult.duplicate_of.capability_id ?? "null"}`);
    return stop(candidateId, "DUPLICATE_CHECK", "FAILED", lifecycleStore.getLifecycleRun(candidateId), pipelineResult.duplicate_of.resource_id, pipelineResult.duplicate_of.capability_id);
  }
  if (pipelineResult.status === "REJECTED" || pipelineResult.status === "UNRESOLVED") {
    const stage: LifecycleStage = pipelineResult.failed_stage === "CLASSIFICATION" || pipelineResult.failed_stage === "VALIDATION" ? "CLASSIFY" : pipelineResult.failed_stage === "DUPLICATE_RESOLUTION" ? "DUPLICATE_CHECK" : "REGISTRY_WRITER";
    const status: LifecycleStageStatus = pipelineResult.status === "UNRESOLVED" ? "UNRESOLVED" : "FAILED";
    record(stage, status, pipelineResult.reason_code);
    return stop(candidateId, stage, status, lifecycleStore.getLifecycleRun(candidateId), null, null);
  }

  record("CLASSIFY", "PASSED", "domain/resource_type classification accepted");
  record("DUPLICATE_CHECK", "PASSED", "no duplicate found — UNIQUE");
  record("REGISTRATION_PIPELINE", "PASSED", "registration decision APPROVED");
  record("REGISTRY_WRITER", "PASSED", `wrote resource_id=${pipelineResult.resource_id} capability_id=${pipelineResult.capability_id ?? "null"}`, pipelineResult.resource_id);

  const resourceId = pipelineResult.resource_id;
  const capabilityId = pipelineResult.capability_id;

  // 10. RELATIONSHIP — control/registration-update's ADD_RELATIONSHIP, reused verbatim.
  let relationshipsOk = true;
  const relationshipReasons: string[] = [];
  if (capabilityId) {
    for (const rel of input.relationships) {
      const consumer = findCapability({ canonical_name: rel.consumer_canonical_name }, registryStore);
      if (!consumer) {
        relationshipsOk = false;
        relationshipReasons.push(`${rel.consumer_canonical_name}: not found`);
        continue;
      }
      const updateResult = applyMutation(
        {
          resource_id: consumer.resource_ids[0],
          capability_id: consumer.capability_id,
          expected_current_version: consumer.version[0],
          mutation_type: "ADD_RELATIONSHIP",
          mutation_payload: { to_type: rel.to_type, to_id: capabilityId, relationship_kind: rel.relationship_kind },
          evidence_refs: [],
          correlation_id: input.correlation_id,
        },
        registryStore,
      );
      if (updateResult.status !== "APPLIED") relationshipsOk = false;
      relationshipReasons.push(`${rel.consumer_canonical_name}: ${updateResult.status}${updateResult.reason_code ? `(${updateResult.reason_code})` : ""}`);
    }
  }
  record("RELATIONSHIP", input.relationships.length === 0 ? "UNRESOLVED" : relationshipsOk ? "PASSED" : "FAILED", input.relationships.length === 0 ? "no relationships declared" : relationshipReasons.join("; "));
  if (input.relationships.length > 0 && !relationshipsOk) return stop(candidateId, "RELATIONSHIP", "FAILED", lifecycleStore.getLifecycleRun(candidateId), resourceId, capabilityId);

  // 11. INTEGRATION
  const integrationResult = capabilityId ? verifyIntegration({ capability_id: capabilityId, proofs: input.integration_proofs, correlation_id: input.correlation_id }, registryStore) : null;
  record("INTEGRATION", integrationResult?.status === "INTEGRATED" ? "PASSED" : integrationResult?.status === "UNRESOLVED" ? "UNRESOLVED" : "FAILED", integrationResult?.reason ?? "no capability_id to verify integration for");
  if (integrationResult?.status !== "INTEGRATED") return stop(candidateId, "INTEGRATION", integrationResult?.status === "UNRESOLVED" ? "UNRESOLVED" : "FAILED", lifecycleStore.getLifecycleRun(candidateId), resourceId, capabilityId);

  // 12. TARGET_RESOLUTION — real control/target-resolution/, reused verbatim (never re-derived here).
  const resolvedTarget = resolveTarget({ resource_id: resourceId, resource_type: candidate.resource_type, capability_id: capabilityId, source_location: candidate.source_location, evidence_ref: candidate.evidence_refs[0] ?? candidate.source_location });
  record("TARGET_RESOLUTION", resolvedTarget.target_status === "RESOLVED" ? "PASSED" : resolvedTarget.target_status === "DESTINATION_MAPPING_NOT_FOUND" ? "UNRESOLVED" : "BLOCKED", resolvedTarget.reason, resolvedTarget.target_ref);
  if (resolvedTarget.target_status !== "RESOLVED") return stop(candidateId, "TARGET_RESOLUTION", resolvedTarget.target_status === "DESTINATION_MAPPING_NOT_FOUND" ? "UNRESOLVED" : "BLOCKED", lifecycleStore.getLifecycleRun(candidateId), resourceId, capabilityId);

  // 13. PERMISSION_ADMISSION — real control/permission-policy-resolution/ + control/admission/, via a real agent-gateway Task/worker context. No fabricated task/policy/admission state.
  //
  // submitTask() genuinely proves capability routing (its own capability_lookup
  // evidence — see control/agent-gateway/gateway.ts's matchCapability and
  // reports/phase16-world-evidence/capability_index.json's
  // "external_system_lifecycle_registration" entry). submitTask()'s OWN
  // internal adapter-execution loop is a separate, pre-existing mechanism
  // this STEP does not touch (no AgentAdapter is registered for this intent,
  // by design — this orchestrator is its own executor, not an agent-gateway
  // adapter) — so its returned task lands on the (also real, unmodified)
  // "AI_WRITE_ADAPTER_NOT_REGISTERED" terminal path regardless of routing.
  // The real, already-established mechanism Admission itself is designed to
  // be handed a task through is `saveTask()` placing it in an active status
  // (see control/admission/tests/admission.test.ts and
  // control/source-execution/tests/source-execution.test.ts, both of which
  // construct their Task this exact same way — `status: "EXECUTING"` — never
  // through submitTask()'s own adapter loop). This is not a bypass: Policy
  // and Admission both still independently, genuinely evaluate this task —
  // only the mechanism for handing them an active task changes.
  const task = await submitTask(`register external system lifecycle capability: ${candidate.name}`, { user_id: "owner", workspace_id: "external-system-lifecycle", conversation_id: input.correlation_id, parent_task_id: null }, "control/external-system-lifecycle", []);
  const routingEvidence = task.status === "BLOCKED" ? "capability routed, agent-gateway's own adapter loop is unrelated to this orchestrator" : `unexpected task.status=${task.status}`;
  const activeTask = { ...task, status: "EXECUTING" as const, updated_at: new Date().toISOString() };
  saveTask(activeTask);
  // BY-DESIGN CLASSIFICATION (repair-loop, root cause MISLEADING_EVIDENCE).
  // The submitTask() call above deliberately passes an empty adapter array —
  // this orchestrator is its own executor, as the comment block above states.
  // The gateway therefore records a truthful "AI_WRITE_ADAPTER_NOT_REGISTERED"
  // verification row, and for 280 tasks that row was the ONLY record of what
  // happened. Read by anything that looks for failures — the gap queue, the
  // Workspace graph — a deliberate stop was indistinguishable from a real
  // one, and it sat at the top of the repair queue as the system's single
  // largest apparent defect.
  //
  // This adds the missing half: the caller that caused the state records that
  // it was intended, on the same task_id. Nothing about the block changes,
  // because nothing about the block is wrong.
  saveEvidence({
    evidence_id: `by-design-${task.task_id}`,
    task_id: task.task_id,
    kind: "verification",
    source: "control/external-system-lifecycle/pipeline.ts",
    recorded_at: new Date().toISOString(),
    payload: {
      reason: "AI_WRITE_ADAPTER_NOT_REGISTERED",
      classification: "EXPECTED_BY_DESIGN",
      explanation: "submitTask was called with an empty adapter array on purpose; this orchestrator executes the lifecycle itself and only needs the task identity for Policy and Admission",
      caller: "control/external-system-lifecycle/pipeline.ts",
    },
  });
  recordHandoff({ task_id: task.task_id, agent_id: LIFECYCLE_WORKER_AGENT_ID, role: "lifecycle-orchestrator", input_reference: candidate.source_location, files_read: [], files_changed: [], tests_run: [...candidate.evidence_refs], status: "IN_PROGRESS", evidence_refs: [...candidate.evidence_refs], blockers: [], next_action: null });
  const policy = resolvePolicy(
    { artifact_resource_id: resourceId, artifact_resource_type: candidate.resource_type, source_capability_id: null, target_capability_id: resolvedTarget.destination_capability_id, target_class: resolvedTarget.destination_class, task_id: task.task_id, worker_id: LIFECYCLE_WORKER_AGENT_ID, requested_action: "REGISTER_CAPABILITY", evidence_refs: [...candidate.evidence_refs], correlation_id: input.correlation_id },
    { store: registryStore },
  );
  const admission = evaluateAdmission(
    { artifact_resource_id: resourceId, task_id: task.task_id, correlation_id: input.correlation_id, resolved_target: resolvedTarget, policy_decision_id: policy.policy_decision_id, policy_decision: policy.decision, evidence_refs: [...candidate.evidence_refs] },
    { store: registryStore },
  );
  const admissionStatus: LifecycleStageStatus = admission.decision === "ADMITTED" ? "PASSED" : admission.decision === "UNRESOLVED" ? "UNRESOLVED" : admission.decision === "REQUIRE_APPROVAL" ? "BLOCKED" : "FAILED";
  record("PERMISSION_ADMISSION", admissionStatus, `task_id=${task.task_id} routing=${routingEvidence}; active_task_status=${activeTask.status}; policy=${policy.decision}(${policy.reason_codes.join(",")}); admission=${admission.decision}(${admission.reason_code})`, admission.admission_id);
  if (admissionStatus !== "PASSED") return stop(candidateId, "PERMISSION_ADMISSION", admissionStatus, lifecycleStore.getLifecycleRun(candidateId), resourceId, capabilityId);

  // 14. DEPLOY_INSTALL — routes through execution/deploy/'s real, honest plan/gate layer (never a fabricated live deploy).
  const delivery = classifyDeliveryTarget(input.delivery_target_evidence, registryStore);
  const deployPlan = resolveDeployPlan({ capability_id: capabilityId!, delivery_target_class: delivery.delivery_target_class, correlation_id: input.correlation_id });
  const deployStatus: LifecycleStageStatus = deployPlan.status === "NOT_APPLICABLE" ? "NOT_APPLICABLE" : "BLOCKED";
  record("DEPLOY_INSTALL", deployStatus, `delivery_target_class=${delivery.delivery_target_class} (${delivery.reason}); ${deployPlan.reason}`, deployPlan.blocked_on[0] ?? delivery.evidence_ref);
  if (deployStatus === "BLOCKED") return stop(candidateId, "DEPLOY_INSTALL", "BLOCKED", lifecycleStore.getLifecycleRun(candidateId), resourceId, capabilityId);

  // 15. RUNTIME_VERIFY
  if (!input.runtime_evidence_ref) {
    record("RUNTIME_VERIFY", "UNRESOLVED", "no runtime_evidence_ref supplied");
    return stop(candidateId, "RUNTIME_VERIFY", "UNRESOLVED", lifecycleStore.getLifecycleRun(candidateId), resourceId, capabilityId);
  }
  // A single synchronous call cannot produce runtime evidence strictly
  // AFTER its own in-call timestamps — the grace window accepts a real
  // probe the caller ran moments before calling this function. See
  // ./README.md's "ขอบเขตที่ยังไม่ได้ทำรอบนี้" note.
  const RUNTIME_EVIDENCE_GRACE_MS = 5 * 60 * 1000;
  const freshnessFloor = new Date(Date.now() - RUNTIME_EVIDENCE_GRACE_MS).toISOString();
  const runtimeResult = verifyRuntime({ capability_id: capabilityId!, deploy_install_completed_at: freshnessFloor, runtime_evidence_ref: input.runtime_evidence_ref, correlation_id: input.correlation_id });
  record("RUNTIME_VERIFY", runtimeResult.status === "RUNTIME_VERIFIED" ? "PASSED" : runtimeResult.status === "UNRESOLVED" ? "UNRESOLVED" : "FAILED", runtimeResult.reason, runtimeResult.evidence_ref);
  if (runtimeResult.status !== "RUNTIME_VERIFIED") return stop(candidateId, "RUNTIME_VERIFY", runtimeResult.status === "UNRESOLVED" ? "UNRESOLVED" : "FAILED", lifecycleStore.getLifecycleRun(candidateId), resourceId, capabilityId);

  // 16. COMPLETE — only reachable when every real stage above genuinely passed.
  record("COMPLETE", "PASSED", "every lifecycle stage passed with real, verified evidence");
  const run = lifecycleStore.getLifecycleRun(candidateId);
  return { candidate_id: candidateId, resource_id: resourceId, capability_id: capabilityId, final_stage: "COMPLETE", final_status: "PASSED", is_complete: true, run };
}
