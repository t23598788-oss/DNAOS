import type { ExecutionPlan } from "../planner";
import { executionLifecycleValidator } from "./executionLifecycleValidator";
import { executionProgressTracker } from "./executionProgressTracker";
import { executionScheduler } from "./executionScheduler";
import { executionStateMachine } from "./executionStateMachine";
import type { ExecutionSession, ExecutionStatus, OrchestratorStartOptions, RuntimeOrchestrator } from "./types";

const DEFAULT_MAX_ATTEMPTS = 1;

function timestamp(options?: OrchestratorStartOptions): string {
  return options?.now ?? new Date().toISOString();
}

function assertValidPlan(plan: ExecutionPlan): void {
  if (!plan.validationResult.valid) {
    throw new Error(`Cannot orchestrate invalid ExecutionPlan "${plan.executionId}"`);
  }
}

function moveCapability(session: ExecutionSession, capabilityId: string, target: "completedCapabilities" | "failedCapabilities"): ExecutionSession {
  return {
    ...session,
    completedCapabilities: target === "completedCapabilities"
      ? [...session.completedCapabilities, capabilityId]
      : session.completedCapabilities.filter((id) => id !== capabilityId),
    runningCapabilities: session.runningCapabilities.filter((id) => id !== capabilityId),
    failedCapabilities: target === "failedCapabilities"
      ? [...session.failedCapabilities, capabilityId]
      : session.failedCapabilities.filter((id) => id !== capabilityId),
    pendingCapabilities: session.pendingCapabilities.filter((id) => id !== capabilityId),
  };
}

function withStatus(session: ExecutionSession, status: ExecutionStatus, options?: OrchestratorStartOptions): ExecutionSession {
  const nextStatus = executionStateMachine.transition(session.status, status);
  const now = timestamp(options);

  return {
    ...session,
    status: nextStatus,
    startedAt: session.startedAt ?? (nextStatus === "Running" ? now : null),
    finishedAt: ["Completed", "Cancelled", "Failed"].includes(nextStatus) ? now : session.finishedAt,
  };
}

export const runtimeOrchestrator: RuntimeOrchestrator = {
  createSession(plan, options) {
    assertValidPlan(plan);
    const schedule = executionScheduler.schedule(plan);

    return {
      executionId: plan.executionId,
      status: "Created",
      currentStage: null,
      completedCapabilities: [],
      runningCapabilities: [],
      failedCapabilities: [],
      pendingCapabilities: schedule.pendingCapabilities,
      startedAt: null,
      finishedAt: null,
      progress: executionProgressTracker.create(schedule.pendingCapabilities, plan.executionStages),
      metadata: {
        applicationId: plan.applicationId,
        workspaceId: plan.workspaceId,
        generatedAt: timestamp(options),
        registryVersion: plan.metadata.registryVersion,
        registryChecksum: plan.metadata.registryChecksum,
        retryPolicy: {
          maxAttempts: DEFAULT_MAX_ATTEMPTS,
          attemptsByCapability: Object.fromEntries(schedule.pendingCapabilities.map((id) => [id, 0])),
          retryableCapabilities: [...schedule.pendingCapabilities],
        },
      },
    };
  },

  queue(session, options) {
    return withStatus(session, "Queued", options);
  },

  prepare(session, options) {
    return withStatus(session, "Preparing", options);
  },

  startStage(session, plan, stageIndex, options) {
    if (!plan.executionStages[stageIndex]) {
      throw new Error(`Missing execution stage: ${stageIndex}`);
    }

    const stageCapabilities = plan.executionStages[stageIndex];

    return {
      ...withStatus(session, "Running", options),
      currentStage: stageIndex,
      runningCapabilities: stageCapabilities.filter((id) => !session.completedCapabilities.includes(id)),
      pendingCapabilities: session.pendingCapabilities.filter((id) => !stageCapabilities.includes(id)),
    };
  },

  completeCapability(session, plan, capabilityId) {
    if (!plan.orderedCapabilities.includes(capabilityId)) {
      throw new Error(`Capability "${capabilityId}" is not part of ExecutionPlan "${plan.executionId}"`);
    }

    const next = moveCapability(session, capabilityId, "completedCapabilities");

    return {
      ...next,
      progress: executionProgressTracker.updateCapability(next.progress, capabilityId, 1, plan.executionStages),
    };
  },

  failCapability(session, capabilityId, options) {
    return withStatus(moveCapability(session, capabilityId, "failedCapabilities"), "Failed", options);
  },

  wait(session, options) {
    return withStatus(session, "Waiting", options);
  },

  retryCapability(session, capabilityId, options) {
    const attempts = session.metadata.retryPolicy.attemptsByCapability[capabilityId] ?? 0;
    if (attempts >= session.metadata.retryPolicy.maxAttempts) {
      throw new Error(`Retry policy exhausted for capability "${capabilityId}"`);
    }

    return {
      ...withStatus(session, "Running", options),
      failedCapabilities: session.failedCapabilities.filter((id) => id !== capabilityId),
      runningCapabilities: session.runningCapabilities.includes(capabilityId)
        ? session.runningCapabilities
        : [...session.runningCapabilities, capabilityId],
      metadata: {
        ...session.metadata,
        retryPolicy: {
          ...session.metadata.retryPolicy,
          attemptsByCapability: {
            ...session.metadata.retryPolicy.attemptsByCapability,
            [capabilityId]: attempts + 1,
          },
        },
      },
    };
  },

  complete(session, options) {
    return withStatus(session, "Completed", options);
  },

  cancel(session, options) {
    return withStatus(session, "Cancelled", options);
  },

  schedule(plan) {
    assertValidPlan(plan);
    return executionScheduler.schedule(plan);
  },

  validateTransition(from, to) {
    return executionLifecycleValidator.validateTransition(from, to);
  },

  validate(session, plan) {
    return executionLifecycleValidator.validate(session, plan);
  },
};
