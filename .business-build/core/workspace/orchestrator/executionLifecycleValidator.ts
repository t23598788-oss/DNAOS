import type { ExecutionPlan } from "../planner";
import { executionStateMachine } from "./executionStateMachine";
import type { ExecutionLifecycleIssue, ExecutionLifecycleValidationResult, ExecutionSession, ExecutionStatus } from "./types";

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

export const executionLifecycleValidator = {
  validateTransition(from: ExecutionStatus, to: ExecutionStatus): ExecutionLifecycleValidationResult {
    if (executionStateMachine.canTransition(from, to)) {
      return { valid: true, issues: [] };
    }

    return {
      valid: false,
      issues: [{
        type: "InvalidTransition",
        message: `Invalid execution transition: ${from} -> ${to}`,
      }],
    };
  },

  validate(session: ExecutionSession, plan: ExecutionPlan): ExecutionLifecycleValidationResult {
    const issues: ExecutionLifecycleIssue[] = [];
    const plannedCapabilities = new Set(plan.orderedCapabilities);
    const stagedCapabilities = new Set(plan.executionStages.flat());
    const sessionCapabilities = [
      ...session.completedCapabilities,
      ...session.runningCapabilities,
      ...session.failedCapabilities,
      ...session.pendingCapabilities,
    ];

    if (session.executionId !== plan.executionId) {
      issues.push({
        type: "DuplicateExecution",
        executionId: session.executionId,
        message: `Session executionId "${session.executionId}" does not match plan "${plan.executionId}"`,
      });
    }

    if (plan.executionStages.length === 0) {
      issues.push({
        type: "MissingStage",
        executionId: plan.executionId,
        message: "ExecutionPlan must contain at least one stage",
      });
    }

    for (const id of duplicates(sessionCapabilities)) {
      issues.push({
        type: "DuplicateExecution",
        executionId: session.executionId,
        capabilityId: id,
        message: `"${id}" appears in more than one execution bucket`,
      });
    }

    for (const id of sessionCapabilities) {
      if (!plannedCapabilities.has(id)) {
        issues.push({
          type: "InvalidCompletion",
          executionId: session.executionId,
          capabilityId: id,
          message: `"${id}" is not part of the ExecutionPlan`,
        });
      }
    }

    for (const id of plannedCapabilities) {
      if (!sessionCapabilities.includes(id)) {
        issues.push({
          type: "MissingStage",
          executionId: session.executionId,
          capabilityId: id,
          message: `"${id}" is missing from session lifecycle buckets`,
        });
      }
    }

    if (session.currentStage !== null && !plan.executionStages[session.currentStage]) {
      issues.push({
        type: "MissingStage",
        executionId: session.executionId,
        stageIndex: session.currentStage,
        message: `Current stage ${session.currentStage} does not exist in the ExecutionPlan`,
      });
    }

    if (session.status === "Completed") {
      const completed = new Set(session.completedCapabilities);
      for (const id of stagedCapabilities) {
        if (!completed.has(id)) {
          issues.push({
            type: "InvalidCompletion",
            executionId: session.executionId,
            capabilityId: id,
            message: `Completed session still has incomplete capability "${id}"`,
          });
        }
      }
    }

    return { valid: issues.length === 0, issues };
  },
};
