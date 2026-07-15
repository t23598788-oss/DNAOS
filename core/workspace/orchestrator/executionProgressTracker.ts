import type { ExecutionProgress } from "./types";

function clampProgress(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export const executionProgressTracker = {
  create(capabilityIds: string[], stages: string[][]): ExecutionProgress {
    const capabilityProgress = Object.fromEntries(capabilityIds.map((id) => [id, 0]));
    const stageProgress = Object.fromEntries(stages.map((_, index) => [index, 0]));

    return {
      capabilityProgress,
      stageProgress,
      overallProgress: 0,
    };
  },

  updateCapability(progress: ExecutionProgress, capabilityId: string, value: number, stages: string[][]): ExecutionProgress {
    const capabilityProgress = {
      ...progress.capabilityProgress,
      [capabilityId]: clampProgress(value),
    };

    const stageProgress = Object.fromEntries(
      stages.map((stage, index) => {
        const values = stage.map((id) => capabilityProgress[id] ?? 0);
        return [index, average(values)];
      })
    );

    return {
      capabilityProgress,
      stageProgress,
      overallProgress: average(Object.values(capabilityProgress)),
    };
  },
};
