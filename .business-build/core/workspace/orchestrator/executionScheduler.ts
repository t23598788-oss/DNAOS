import type { ExecutionPlan } from "../planner";
import type { ExecutionSchedule, ScheduledStage } from "./types";

function cloneStages(stages: string[][]): ScheduledStage[] {
  return stages.map((capabilityIds, stageIndex) => ({
    stageIndex,
    capabilityIds: [...capabilityIds],
  }));
}

export const executionScheduler = {
  schedule(plan: ExecutionPlan): ExecutionSchedule {
    const stages = cloneStages(plan.executionStages);

    return {
      executionId: plan.executionId,
      stages,
      pendingCapabilities: stages.flatMap((stage) => stage.capabilityIds),
    };
  },
};
