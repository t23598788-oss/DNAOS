/**
 * Recovery Engine
 *
 * เวลางานล้มเหลว ไม่ Failed ทันที
 * Retry → Activate App → Focus → Search Window → Execute ใหม่ → Fail
 *
 * แต่ละแอปมี recovery strategy ที่ต่างกัน
 */

import { getDriver } from "./registry";
import * as stateMon from "./state-monitor";
import { emitFailed, emitSuccess, emitWaiting } from "./event-monitor";
import { logStepStart } from "./audit";
import type { StepResult } from "./driver";

export type RecoveryStrategy =
  | "restart_app"
  | "activate_and_retry"
  | "wait_and_retry"
  | "find_window"
  | "kill_and_relaunch"
  | "skip";

export interface RecoveryAttempt {
  strategy: RecoveryStrategy;
  app: string;
  attempt: number;
  maxAttempts: number;
  recovered: boolean;
  durationMs: number;
  error?: string;
}

export interface RecoveryPlan {
  strategies: RecoveryStrategy[];
  maxAttempts: number;
  delayBetweenMs: number;
}

const defaultPlan: RecoveryPlan = {
  strategies: ["activate_and_retry", "find_window", "restart_app"],
  maxAttempts: 3,
  delayBetweenMs: 1000,
};

const appRecoveryPlans: Record<string, RecoveryPlan> = {
  line: {
    strategies: ["activate_and_retry", "find_window", "restart_app"],
    maxAttempts: 3,
    delayBetweenMs: 1500,
  },
  "google chrome": {
    strategies: ["activate_and_retry", "wait_and_retry", "restart_app"],
    maxAttempts: 3,
    delayBetweenMs: 2000,
  },
  terminal: {
    strategies: ["activate_and_retry", "restart_app"],
    maxAttempts: 2,
    delayBetweenMs: 500,
  },
  finder: {
    strategies: ["activate_and_retry", "find_window"],
    maxAttempts: 2,
    delayBetweenMs: 500,
  },
};

export function getRecoveryPlan(appName: string): RecoveryPlan {
  return appRecoveryPlans[appName.toLowerCase()] ?? defaultPlan;
}

export async function attemptRecovery(
  appName: string,
  failedStep: string,
  retryFn: () => Promise<StepResult>
): Promise<{ recovered: boolean; result?: StepResult; attempts: RecoveryAttempt[] }> {
  const plan = getRecoveryPlan(appName);
  const attempts: RecoveryAttempt[] = [];

  for (let i = 0; i < plan.strategies.length && i < plan.maxAttempts; i++) {
    const strategy = plan.strategies[i];
    const start = Date.now();
    const audit = logStepStart("recovery", failedStep, appName, `recovery.${strategy}`);

    emitWaiting("recovery", `${strategy} (${i + 1}/${plan.maxAttempts})`, appName, start);

    try {
      await executeStrategy(strategy, appName);
      await sleep(plan.delayBetweenMs);

      const result = await retryFn();

      if (result.ok) {
        emitSuccess("recovery", `${strategy} สำเร็จ`, appName, start, result.data);
        audit.finish("success");
        attempts.push({ strategy, app: appName, attempt: i + 1, maxAttempts: plan.maxAttempts, recovered: true, durationMs: Date.now() - start });
        return { recovered: true, result, attempts };
      }

      emitFailed("recovery", `${strategy} ยังไม่สำเร็จ`, appName, start, result.error ?? "unknown");
      audit.finish("failed", result.error);
      attempts.push({ strategy, app: appName, attempt: i + 1, maxAttempts: plan.maxAttempts, recovered: false, durationMs: Date.now() - start, error: result.error });
    } catch (e) {
      const error = (e as Error).message;
      emitFailed("recovery", `${strategy} error`, appName, start, error);
      audit.finish("failed", error);
      attempts.push({ strategy, app: appName, attempt: i + 1, maxAttempts: plan.maxAttempts, recovered: false, durationMs: Date.now() - start, error });
    }
  }

  return { recovered: false, attempts };
}

async function executeStrategy(strategy: RecoveryStrategy, appName: string): Promise<void> {
  switch (strategy) {
    case "activate_and_retry": {
      await stateMon.activate(appName);
      await sleep(500);
      break;
    }

    case "find_window": {
      const running = await stateMon.isRunning(appName);
      if (!running) {
        await stateMon.activate(appName);
      }
      await stateMon.waitUntilReady(appName, 5000);
      break;
    }

    case "wait_and_retry": {
      await sleep(3000);
      break;
    }

    case "restart_app": {
      const driver = getDriver(appName);
      if (driver) {
        try { await driver.close(); } catch { /* ปิดไม่ได้ก็ไม่เป็นไร */ }
        await sleep(1000);
        await driver.launch();
        await sleep(1000);
      } else {
        await stateMon.activate(appName);
        await stateMon.waitUntilReady(appName, 5000);
      }
      break;
    }

    case "kill_and_relaunch": {
      try {
        const { runShell } = await import("../executor/computer-control/osascript");
        await runShell("pkill", ["-f", appName]);
      } catch { /* pkill ไม่เจอก็ไม่เป็นไร */ }
      await sleep(2000);
      const driver = getDriver(appName);
      if (driver) {
        await driver.launch();
        await sleep(1000);
      }
      break;
    }

    case "skip":
      break;
  }
}

export function detectFailureType(error: string): RecoveryStrategy {
  const lower = error.toLowerCase();
  if (lower.includes("not running") || lower.includes("ไม่ทำงาน")) return "restart_app";
  if (lower.includes("window") || lower.includes("หน้าต่าง")) return "find_window";
  if (lower.includes("timeout") || lower.includes("หมดเวลา")) return "wait_and_retry";
  if (lower.includes("not respond") || lower.includes("ค้าง")) return "kill_and_relaunch";
  return "activate_and_retry";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
