import type { ExecutionStatus } from "./types";

const allowedTransitions: Record<ExecutionStatus, ExecutionStatus[]> = {
  Created: ["Queued", "Cancelled", "Failed"],
  Queued: ["Preparing", "Cancelled", "Failed"],
  Preparing: ["Running", "Waiting", "Cancelled", "Failed"],
  // "Running" -> "Running" is a real, needed self-transition: startStage()
  // is called once per stage, and a multi-stage ExecutionPlan re-enters
  // Running for stage 2, 3, ... while never actually leaving the Running
  // macro-state in between (no Waiting round-trip happens when the next
  // stage is ready immediately). Without this, staged execution beyond
  // stage 0 was structurally impossible — caught by a real multi-stage test.
  Running: ["Running", "Waiting", "Completed", "Cancelled", "Failed"],
  Waiting: ["Running", "Completed", "Cancelled", "Failed"],
  Completed: [],
  Cancelled: [],
  Failed: [],
};

export const executionStateMachine = {
  canTransition(from: ExecutionStatus, to: ExecutionStatus): boolean {
    return allowedTransitions[from].includes(to);
  },

  transition(from: ExecutionStatus, to: ExecutionStatus): ExecutionStatus {
    if (!this.canTransition(from, to)) {
      throw new Error(`Invalid execution transition: ${from} -> ${to}`);
    }
    return to;
  },

  allowedTransitions(status: ExecutionStatus): ExecutionStatus[] {
    return [...allowedTransitions[status]];
  },
};
