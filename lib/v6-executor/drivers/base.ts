/**
 * Base Driver — launch/focus/close/status มาตรฐาน
 * Driver แต่ละแอปเหลือเฉพาะ search/click/type/read
 */

import type { AppDriver, AppStatus, StepResult } from "@/lib/shared/types";
import { openApp, waitUntilRunning, osascript, isProcessRunning } from "@/lib/v6-executor/runtime/shell";

function ok(step: string, app: string, start: number, data?: unknown): StepResult {
  return { ok: true, step, app, durationMs: Date.now() - start, data };
}
function fail(step: string, app: string, start: number, error: string): StepResult {
  return { ok: false, step, app, durationMs: Date.now() - start, error };
}

export abstract class BaseDriver implements AppDriver {
  abstract appName: string;
  abstract bundleId: string;
  protected macName: string;

  constructor(macName: string) { this.macName = macName; }

  async launch(): Promise<StepResult> {
    const s = Date.now();
    try {
      await openApp(this.macName);
      await waitUntilRunning(this.macName);
      return ok("launch", this.appName, s, { launched: this.appName });
    } catch (e) { return fail("launch", this.appName, s, (e as Error).message); }
  }

  async focus(): Promise<StepResult> {
    const s = Date.now();
    try {
      await openApp(this.macName);
      return ok("focus", this.appName, s);
    } catch (e) { return fail("focus", this.appName, s, (e as Error).message); }
  }

  async close(): Promise<StepResult> {
    const s = Date.now();
    try {
      await osascript(`tell application "${this.macName}" to quit`);
      return ok("close", this.appName, s);
    } catch (e) { return fail("close", this.appName, s, (e as Error).message); }
  }

  async status(): Promise<AppStatus> {
    return (await isProcessRunning(this.macName)) ? "running" : "closed";
  }

  abstract search(query: string): Promise<StepResult>;
  abstract click(target: string): Promise<StepResult>;
  abstract type(text: string): Promise<StepResult>;
  abstract read(): Promise<StepResult>;
}

export { ok, fail };
