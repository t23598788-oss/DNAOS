/**
 * Execution Queue
 *
 * จัดคิวหลายคำสั่งพร้อมกัน — ทุก step มี status
 * pending → running → waiting → retry → completed / failed / cancelled
 * Retry ล้มเหลว 3 ครั้ง → failed (ไม่ crash queue)
 */

import type { ExecutionStep, TaskPlan } from "./planner";
import type { StepResult, AppDriver } from "./driver";
import { getDriver } from "./registry";
import { emitStarted, emitSuccess, emitFailed, emitWaiting } from "./event-monitor";
import { logStepStart } from "./audit";
import { isConfirmed, requestConfirmation } from "./confirm";
import { checkBeforeExecute } from "./permission";
import { attemptRecovery } from "./recovery";
import { updateFromStepResult } from "./context";
import * as stateMon from "./state-monitor";

export type QueueItemStatus = "pending" | "running" | "waiting" | "retry" | "completed" | "failed" | "cancelled";

export interface QueueItem {
  id: string;
  capability: string;
  app: string;
  plan: TaskPlan;
  status: QueueItemStatus;
  currentStep: number;
  retryCount: number;
  maxRetries: number;
  confirmId?: string;
  stepResults: StepResult[];
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

const queue: QueueItem[] = [];
let queueCounter = 0;
let processing = false;

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

export function enqueue(plan: TaskPlan, args: Record<string, unknown> = {}): QueueItem {
  const item: QueueItem = {
    id: `q_${++queueCounter}_${Date.now()}`,
    capability: plan.capability,
    app: plan.app,
    plan,
    status: "pending",
    currentStep: 0,
    retryCount: 0,
    maxRetries: MAX_RETRIES,
    stepResults: [],
    createdAt: Date.now(),
  };

  if (plan.requireConfirm) {
    const c = requestConfirmation(plan.capability, plan.app, args, plan.executionSteps.length);
    item.confirmId = c.id;
    item.status = "waiting";
  }

  queue.push(item);
  processQueue();
  return item;
}

export function cancelItem(id: string): boolean {
  const item = queue.find((q) => q.id === id);
  if (!item) return false;
  if (item.status === "completed" || item.status === "failed") return false;
  item.status = "cancelled";
  item.completedAt = Date.now();
  return true;
}

export function getQueue(): QueueItem[] {
  return [...queue];
}

export function getQueueItem(id: string): QueueItem | undefined {
  return queue.find((q) => q.id === id);
}

export function getPendingCount(): number {
  return queue.filter((q) => q.status === "pending" || q.status === "waiting").length;
}

export function getRunningCount(): number {
  return queue.filter((q) => q.status === "running").length;
}

export function clearCompleted(): number {
  const before = queue.length;
  const active = queue.filter((q) => q.status !== "completed" && q.status !== "failed" && q.status !== "cancelled");
  queue.length = 0;
  queue.push(...active);
  return before - queue.length;
}

async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;

  try {
    while (true) {
      const next = queue.find((q) => q.status === "pending");
      const waiting = queue.filter((q) => q.status === "waiting" && q.confirmId && isConfirmed(q.confirmId));

      for (const w of waiting) {
        w.status = "pending";
      }

      const item = next ?? queue.find((q) => q.status === "pending");
      if (!item) break;

      await executeItem(item);
    }
  } finally {
    processing = false;
  }
}

async function executeItem(item: QueueItem): Promise<void> {
  item.status = "running";
  item.startedAt = Date.now();

  // ── Permission Check ก่อน Execute ──
  const perm = await checkBeforeExecute(item.app);
  if (!perm.ok) {
    item.status = "failed";
    item.error = perm.error;
    item.completedAt = Date.now();
    return;
  }

  const steps = item.plan.executionSteps;

  for (let i = item.currentStep; i < steps.length; i++) {
    if ((item as QueueItem).status === "cancelled") break;

    item.currentStep = i;
    const step = steps[i];
    let result = await executeStep(item, step);

    // ── Recovery ถ้า step ล้มเหลว ──
    if (!result.ok) {
      const recovery = await attemptRecovery(step.app, step.description, () => executeStep(item, step));
      if (recovery.recovered && recovery.result) {
        result = recovery.result;
      }
    }

    item.stepResults.push(result);

    // ── Update Context ──
    if (result.ok) {
      updateFromStepResult(step.app, step.description, result.data);
    }

    if (!result.ok) {
      if (item.retryCount < item.maxRetries) {
        item.retryCount++;
        item.status = "retry";
        emitFailed(item.capability, step.description, step.app, Date.now(), `retry ${item.retryCount}/${item.maxRetries}`);
        await sleep(RETRY_DELAY_MS * item.retryCount);
        item.status = "running";
        i--;
        continue;
      }

      item.status = "failed";
      item.error = result.error ?? `Step ${step.order} ล้มเหลว`;
      item.completedAt = Date.now();
      return;
    }

    item.retryCount = 0;
  }

  if (item.status === "running") {
    item.status = "completed";
    item.completedAt = Date.now();
  }
}

async function executeStep(item: QueueItem, step: ExecutionStep): Promise<StepResult> {
  const audit = logStepStart(item.capability, item.capability, step.app, step.description);
  const startTs = emitStarted(item.capability, step.description, step.app);

  const driver = getDriver(step.app);

  try {
    let result: StepResult;

    if (driver) {
      result = await executeWithDriver(driver, step);
    } else {
      result = await executeWithFallback(step);
    }

    if (result.ok) {
      emitSuccess(item.capability, step.description, step.app, startTs, result.data);
      audit.finish("success");
    } else {
      emitFailed(item.capability, step.description, step.app, startTs, result.error ?? "unknown");
      audit.finish("failed", result.error);
    }

    return result;
  } catch (e) {
    const error = (e as Error).message;
    emitFailed(item.capability, step.description, step.app, startTs, error);
    audit.finish("failed", error);
    return { ok: false, step: step.description, app: step.app, durationMs: Date.now() - startTs, error };
  }
}

async function executeWithDriver(driver: AppDriver, step: ExecutionStep): Promise<StepResult> {
  switch (step.action) {
    case "launch":    return driver.launch();
    case "focus":     return driver.focus();
    case "close":     return driver.close();
    case "search":    return driver.search(String(step.args.query ?? ""));
    case "click":     return driver.click(String(step.args.target ?? ""));
    case "type":      return driver.type(String(step.args.text ?? ""));
    case "read":      return driver.read();
    case "wait":
      emitWaiting(step.app, step.description, step.app, Date.now());
      await sleep(Number(step.args.timeoutMs ?? 2000));
      return { ok: true, step: step.description, app: step.app, durationMs: Number(step.args.timeoutMs ?? 2000), data: { waited: true } };
    case "submit":    return driver.click("submit");
    case "report":    return { ok: true, step: step.description, app: step.app, durationMs: 0, data: { reported: true } };
    case "open_url":  return driver.click(`url:${step.args.url ?? ""}`);
    case "shortcut":  return driver.click(`shortcut:${step.args.key ?? ""}`);
    case "paste":     return driver.type(String(step.args.text ?? ""));
    default:
      return { ok: false, step: step.description, app: step.app, durationMs: 0, error: `ไม่รู้จัก action: ${step.action}` };
  }
}

async function executeWithFallback(step: ExecutionStep): Promise<StepResult> {
  const start = Date.now();

  switch (step.action) {
    case "launch":
      await stateMon.activate(step.app);
      return { ok: true, step: step.description, app: step.app, durationMs: Date.now() - start };
    case "focus":
      await stateMon.activate(step.app);
      return { ok: true, step: step.description, app: step.app, durationMs: Date.now() - start };
    case "wait":
      await sleep(Number(step.args.timeoutMs ?? 2000));
      return { ok: true, step: step.description, app: step.app, durationMs: Date.now() - start };
    case "report":
      return { ok: true, step: step.description, app: step.app, durationMs: 0, data: { reported: true } };
    default:
      return { ok: false, step: step.description, app: step.app, durationMs: 0, error: `ไม่มี driver สำหรับ ${step.app} — ลงทะเบียนก่อนใช้` };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
