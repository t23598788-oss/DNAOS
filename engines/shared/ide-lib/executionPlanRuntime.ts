/**
 * Execution Plan Runtime (owner, 2026-08-08, Software Factory Step 13,
 * Phase 8). Builds a real, ordered Execution Plan from an approved
 * Context Plan + selected Worker — never a single opaque "do the task"
 * step. EXTERNAL_MUTATION is always BLOCKED this Step (Deploy/Git
 * Push/Provider Mutation are forbidden by the mission, Section 25).
 */
import { randomUUID } from "crypto";
import { createOperationsArtifact } from "./artifactRuntime";
import type { ContextPlan } from "./contextPlannerRuntime";
import type { WorkerType } from "./workerRegistry";

export type MutationLevel = "READ_ONLY" | "PROPOSE_CHANGE" | "WRITE_WORKSPACE" | "RUN_TEST" | "RUN_BUILD" | "PREPARE_RELEASE" | "EXTERNAL_MUTATION";

export type ExecutionStepStatus = "PENDING" | "APPROVED" | "RUNNING" | "COMPLETED" | "FAILED" | "BLOCKED" | "SKIPPED";

export interface ExecutionStep {
  stepId: string;
  purpose: string;
  worker: WorkerType;
  inputs: string[];
  outputs: string[];
  dependencies: string[];
  permittedCommands: string[];
  permittedFiles: string[];
  mutationLevel: MutationLevel;
  approvalRequired: boolean;
  validation: string;
  rollback: string;
  evidenceRequirements: string[];
  status: ExecutionStepStatus;
}

export interface ExecutionPlan {
  executionPlanId: string;
  workspaceSessionId: string;
  contextPlanId: string;
  steps: ExecutionStep[];
  approved: boolean;
  approvedAt: string | null;
  createdAt: string;
  ownerId: string;
  actor: string;
  artifactIds: string[];
}

export class ExecutionPlanError extends Error {
  code: "PLAN_NOT_FOUND" | "PLAN_NOT_OWNED" | "EXTERNAL_MUTATION_BLOCKED" | "STEP_NOT_FOUND";
  constructor(code: typeof ExecutionPlanError.prototype.code, message: string) { super(message); this.code = code; this.name = "ExecutionPlanError"; }
}

const plans = new Map<string, ExecutionPlan>();
const MAX_PLAN_HISTORY = 200;
function evictOld(ownerId: string) {
  const owned = [...plans.values()].filter((p) => p.ownerId === ownerId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  while (owned.length > MAX_PLAN_HISTORY) { const oldest = owned.shift()!; plans.delete(oldest.executionPlanId); }
}

/** Real, deterministic step builder — a fixed, honest pipeline shape
 * (analyze -> propose -> review -> test -> build -> release-candidate),
 * scoped by the real, approved ContextPlan's real file lists. Never
 * includes an EXTERNAL_MUTATION step — Deploy/Git Push/Provider
 * Mutation are out of scope for this entire Step (Section 25). */
export function buildExecutionPlan(
  workspaceSessionId: string, ownerId: string, actor: string,
  contextPlan: ContextPlan, codeWorker: WorkerType = "CODE_WORKER"
): ExecutionPlan {
  if (!contextPlan.approved) throw new ExecutionPlanError("PLAN_NOT_OWNED", "real Context Plan must be approved before an Execution Plan can be built");

  const steps: ExecutionStep[] = [
    {
      stepId: randomUUID(), purpose: "Read and analyze the real, scoped context files",
      worker: "ANALYSIS_WORKER", inputs: contextPlan.permittedReadScope, outputs: ["real analysis summary"],
      dependencies: [], permittedCommands: [], permittedFiles: contextPlan.permittedReadScope,
      mutationLevel: "READ_ONLY", approvalRequired: false,
      validation: "real files exist and are within contextPlan.permittedReadScope", rollback: "not applicable — read-only",
      evidenceRequirements: ["real AI_CONTEXT_PACKAGE artifact"], status: "PENDING",
    },
    {
      stepId: randomUUID(), purpose: "Propose real file changes within the approved write scope",
      worker: codeWorker, inputs: contextPlan.permittedWriteScope, outputs: ["real ProposedChange[] via changeSetRuntime.ts"],
      dependencies: [], permittedCommands: [], permittedFiles: contextPlan.permittedWriteScope,
      mutationLevel: "PROPOSE_CHANGE", approvalRequired: true,
      validation: "real changed paths are a subset of contextPlan.permittedWriteScope", rollback: "discard the real, un-applied ProposedChange set",
      evidenceRequirements: ["real Change Set id"], status: "PENDING",
    },
    {
      stepId: randomUUID(), purpose: "Apply the approved Change Set through the real File Runtime",
      worker: "TOOL_WORKER", inputs: ["real, approved Change Set"], outputs: ["real, written files on disk"],
      dependencies: [], permittedCommands: [], permittedFiles: contextPlan.permittedWriteScope,
      mutationLevel: "WRITE_WORKSPACE", approvalRequired: true,
      validation: "real changeSetRuntime.ts apply() succeeds", rollback: "real changeSetRuntime.ts revert path",
      evidenceRequirements: ["real applied Change Set record"], status: "PENDING",
    },
    {
      stepId: randomUUID(), purpose: "Run real, deterministic Review over the applied Change Set",
      worker: "REVIEW_WORKER", inputs: ["real, applied Change Set"], outputs: ["real ReviewFindings"],
      dependencies: [], permittedCommands: [], permittedFiles: [],
      mutationLevel: "READ_ONLY", approvalRequired: false,
      validation: "real Review completes with a real, non-fabricated verdict", rollback: "not applicable — read-only",
      evidenceRequirements: ["real REVIEW_FINDINGS artifact"], status: "PENDING",
    },
    {
      stepId: randomUUID(), purpose: "Run real, registered Tests against the applied Change Set",
      worker: "TEST_WORKER", inputs: ["real, applied Change Set"], outputs: ["real TestRun result"],
      dependencies: [], permittedCommands: [], permittedFiles: [],
      mutationLevel: "RUN_TEST", approvalRequired: false,
      validation: "real testRuntime.ts run completes with a real, non-fabricated result", rollback: "not applicable — no mutation",
      evidenceRequirements: ["real TEST_REPORT artifact"], status: "PENDING",
    },
    {
      stepId: randomUUID(), purpose: "Run a real Build against the applied Change Set",
      worker: "TOOL_WORKER", inputs: ["real, applied Change Set"], outputs: ["real BuildRun result"],
      dependencies: [], permittedCommands: [], permittedFiles: [],
      mutationLevel: "RUN_BUILD", approvalRequired: false,
      validation: "real buildRuntime.ts run completes with a real, non-fabricated result", rollback: "not applicable — no mutation",
      evidenceRequirements: ["real BUILD_REPORT artifact"], status: "PENDING",
    },
    {
      stepId: randomUUID(), purpose: "Prepare a real Release Candidate from the real, passing Build",
      worker: "TOOL_WORKER", inputs: ["real, passing BuildRun"], outputs: ["real Release Candidate record"],
      dependencies: [], permittedCommands: [], permittedFiles: [],
      mutationLevel: "PREPARE_RELEASE", approvalRequired: true,
      validation: "real releaseRuntime.ts creates a real Release Candidate only if Build+Gate passed", rollback: "real Release Candidate stays un-promoted",
      evidenceRequirements: ["real RELEASE_CANDIDATE artifact"], status: "PENDING",
    },
  ];
  for (let i = 1; i < steps.length; i++) steps[i].dependencies = [steps[i - 1].stepId];

  const executionPlanId = randomUUID();
  const plan: ExecutionPlan = {
    executionPlanId, workspaceSessionId, contextPlanId: contextPlan.contextPlanId, steps,
    approved: false, approvedAt: null, createdAt: new Date().toISOString(), ownerId, actor, artifactIds: [],
  };

  const artifact = createOperationsArtifact({
    artifactType: "EXECUTION_PLAN", content: JSON.stringify(plan), mimeType: "application/json",
    actor, ownerId, generatedFrom: executionPlanId, jobId: null, workspaceSessionId,
  });
  plan.artifactIds.push(artifact.artifactId);

  plans.set(executionPlanId, plan);
  evictOld(ownerId);
  return plan;
}

export function approveExecutionPlan(executionPlanId: string, ownerId: string): ExecutionPlan {
  const plan = getExecutionPlan(executionPlanId, ownerId);
  const external = plan.steps.find((s) => s.mutationLevel === "EXTERNAL_MUTATION");
  if (external) throw new ExecutionPlanError("EXTERNAL_MUTATION_BLOCKED", `real step "${external.stepId}" requests EXTERNAL_MUTATION — forbidden this Step`);
  plan.approved = true;
  plan.approvedAt = new Date().toISOString();
  return plan;
}

export function updateStepStatus(executionPlanId: string, ownerId: string, stepId: string, status: ExecutionStepStatus): ExecutionStep {
  const plan = getExecutionPlan(executionPlanId, ownerId);
  const step = plan.steps.find((s) => s.stepId === stepId);
  if (!step) throw new ExecutionPlanError("STEP_NOT_FOUND", "no real step with that id");
  step.status = status;
  return step;
}

export function getExecutionPlan(executionPlanId: string, ownerId: string): ExecutionPlan {
  const p = plans.get(executionPlanId);
  if (!p) throw new ExecutionPlanError("PLAN_NOT_FOUND", "no Execution Plan with that id");
  if (p.ownerId !== ownerId) throw new ExecutionPlanError("PLAN_NOT_OWNED", "this Execution Plan belongs to a different owner");
  return p;
}
export function listExecutionPlans(ownerId: string): ExecutionPlan[] {
  return [...plans.values()].filter((p) => p.ownerId === ownerId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function __debugPlanCount(): number { return plans.size; }
