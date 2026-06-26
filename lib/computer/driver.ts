/**
 * App Driver Interface
 *
 * ทุก App ต้อง implement interface นี้
 * Register App ใหม่ได้โดยไม่แก้ Capability Manager
 */

export type AppStatus = "running" | "focused" | "background" | "closed" | "not_installed";

export interface StepResult {
  ok: boolean;
  step: string;
  app: string;
  data?: unknown;
  error?: string;
  durationMs: number;
}

export interface AppDriver {
  appName: string;
  bundleId: string;

  launch(): Promise<StepResult>;
  focus(): Promise<StepResult>;
  close(): Promise<StepResult>;
  search(query: string): Promise<StepResult>;
  click(target: string): Promise<StepResult>;
  type(text: string): Promise<StepResult>;
  read(): Promise<StepResult>;
  status(): Promise<AppStatus>;
}

export function createStepResult(
  ok: boolean,
  step: string,
  app: string,
  start: number,
  dataOrError?: unknown
): StepResult {
  const r: StepResult = { ok, step, app, durationMs: Date.now() - start };
  if (ok) r.data = dataOrError;
  else r.error = String(dataOrError);
  return r;
}

/**
 * Base Driver — launch/focus/close/status จัดการที่นี่
 * Driver แต่ละตัวเหลือเฉพาะ search/click/type/read ของตัวเอง
 */
export abstract class BaseDriver implements AppDriver {
  abstract appName: string;
  abstract bundleId: string;
  protected macAppName: string;

  constructor(macAppName?: string) {
    this.macAppName = macAppName ?? "";
  }

  protected getMacName(): string {
    return this.macAppName || this.appName;
  }

  async launch(): Promise<StepResult> {
    const s = Date.now();
    try {
      const { runShell } = await import("../executor/computer-control/osascript");
      const { waitUntilReady } = await import("./state-monitor");
      await runShell("open", ["-a", this.getMacName()]);
      await waitUntilReady(this.getMacName(), 5000);
      return createStepResult(true, "launch", this.appName, s, { launched: this.appName });
    } catch (e) {
      return createStepResult(false, "launch", this.appName, s, (e as Error).message);
    }
  }

  async focus(): Promise<StepResult> {
    const s = Date.now();
    try {
      const { runShell } = await import("../executor/computer-control/osascript");
      await runShell("open", ["-a", this.getMacName()]);
      return createStepResult(true, "focus", this.appName, s);
    } catch (e) {
      return createStepResult(false, "focus", this.appName, s, (e as Error).message);
    }
  }

  async close(): Promise<StepResult> {
    const s = Date.now();
    try {
      const { runAppleScript } = await import("../executor/computer-control/osascript");
      await runAppleScript(`tell application "${this.getMacName()}" to quit`);
      return createStepResult(true, "close", this.appName, s);
    } catch (e) {
      return createStepResult(false, "close", this.appName, s, (e as Error).message);
    }
  }

  async status(): Promise<AppStatus> {
    const { getAppStatus } = await import("./state-monitor");
    return getAppStatus(this.getMacName());
  }

  abstract search(query: string): Promise<StepResult>;
  abstract click(target: string): Promise<StepResult>;
  abstract type(text: string): Promise<StepResult>;
  abstract read(): Promise<StepResult>;
}
