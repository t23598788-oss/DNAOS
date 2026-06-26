/**
 * Execution Queue
 *
 * คิวจัดการลำดับคำสั่ง Computer Control
 * รองรับ Sequential / Conditional / Parallel / Retry / Rollback / Timeout / Cancel
 */

import { ActionResult, ActionStatus, ComputerAction, ExecutionPlan, ExecutionStep } from "./types";
import { executeAction } from "./execution-engine";

let activePlan: ExecutionPlan | null = null;
let cancelled = false;

export function cancelExecution(): boolean {
  if (!activePlan) return false;
  cancelled = true;
  activePlan.status = "cancelled";
  return true;
}

export function getActivePlan(): ExecutionPlan | null {
  return activePlan;
}

export async function executePlan(plan: ExecutionPlan): Promise<ExecutionPlan> {
  activePlan = plan;
  cancelled = false;
  plan.status = "running";
  plan.results = [];

  for (const step of plan.steps) {
    if (cancelled) {
      plan.status = "cancelled";
      break;
    }

    const stepResults = await executeStep(step, plan.results);
    plan.results.push(...stepResults);

    const hasFailed = stepResults.some((r) => r.status === "failed");
    if (hasFailed && step.onFail === "abort") {
      plan.status = "failed";
      break;
    }
    if (hasFailed && step.onFail === "rollback") {
      plan.status = "failed";
      break;
    }
  }

  if (plan.status === "running") {
    plan.status = plan.results.every((r) => r.status === "success") ? "success" : "failed";
  }

  activePlan = null;
  return plan;
}

async function executeStep(
  step: ExecutionStep,
  previousResults: ActionResult[]
): Promise<ActionResult[]> {
  switch (step.mode) {
    case "sequential":
      return executeSequential(step);
    case "parallel":
      return executeParallel(step);
    case "conditional":
      return executeConditional(step, previousResults);
    default:
      return [{ status: "failed", action: "unknown", durationMs: 0, error: `ไม่รองรับ mode: ${step.mode}` }];
  }
}

async function executeSequential(step: ExecutionStep): Promise<ActionResult[]> {
  const results: ActionResult[] = [];

  for (const action of step.actions) {
    if (cancelled) {
      results.push({ status: "cancelled", action: action.type, durationMs: 0 });
      break;
    }

    const result = await executeWithRetry(action, step.maxRetries ?? 0, step.timeoutMs);
    results.push(result);

    if (result.status === "failed") {
      if (step.onFail === "abort" || step.onFail === "rollback") break;
      // "skip" continues to next action
    }
  }

  return results;
}

async function executeParallel(step: ExecutionStep): Promise<ActionResult[]> {
  const promises = step.actions.map((action) =>
    executeWithRetry(action, step.maxRetries ?? 0, step.timeoutMs)
  );
  return Promise.all(promises);
}

async function executeConditional(
  step: ExecutionStep,
  previousResults: ActionResult[]
): Promise<ActionResult[]> {
  const lastResult = previousResults[previousResults.length - 1];

  if (step.condition && lastResult) {
    if (!step.condition(lastResult)) {
      return [{ status: "cancelled", action: "conditional.skipped", durationMs: 0 }];
    }
  }

  return executeSequential(step);
}

async function executeWithRetry(
  action: ComputerAction,
  maxRetries: number,
  timeoutMs?: number
): Promise<ActionResult> {
  let attempt = 0;

  while (attempt <= maxRetries) {
    if (cancelled) {
      return { status: "cancelled", action: action.type, durationMs: 0 };
    }

    const result = timeoutMs
      ? await executeWithTimeout(action, timeoutMs)
      : await executeAction(action);

    if (result.status === "success") return result;

    attempt++;
    if (attempt <= maxRetries) {
      result.status = "retry";
      await sleep(500 * attempt);
    } else {
      return result;
    }
  }

  return { status: "failed", action: action.type, durationMs: 0, error: "หมดรอบ retry" };
}

async function executeWithTimeout(
  action: ComputerAction,
  timeoutMs: number
): Promise<ActionResult> {
  return Promise.race([
    executeAction(action),
    new Promise<ActionResult>((resolve) =>
      setTimeout(
        () => resolve({ status: "failed", action: action.type, durationMs: timeoutMs, error: `หมดเวลา ${timeoutMs}ms` }),
        timeoutMs
      )
    ),
  ]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- Plan Builder (ช่วยสร้าง plan) ----

let planCounter = 0;

export function createPlan(name: string, steps: ExecutionStep[]): ExecutionPlan {
  return {
    id: `plan_${++planCounter}_${Date.now()}`,
    name,
    steps,
    createdAt: Date.now(),
    status: "waiting" as ActionStatus,
    results: [],
  };
}

export function sequentialStep(
  actions: ComputerAction[],
  options?: { onFail?: "retry" | "rollback" | "skip" | "abort"; maxRetries?: number; timeoutMs?: number }
): ExecutionStep {
  return {
    mode: "sequential",
    actions,
    onFail: options?.onFail ?? "abort",
    maxRetries: options?.maxRetries ?? 0,
    timeoutMs: options?.timeoutMs,
  };
}

export function parallelStep(
  actions: ComputerAction[],
  options?: { timeoutMs?: number }
): ExecutionStep {
  return {
    mode: "parallel",
    actions,
    timeoutMs: options?.timeoutMs,
  };
}

export function conditionalStep(
  actions: ComputerAction[],
  condition: (prev: ActionResult) => boolean
): ExecutionStep {
  return {
    mode: "conditional",
    actions,
    condition,
  };
}
