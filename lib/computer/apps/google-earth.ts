import { BaseDriver, createStepResult, type StepResult } from "../driver";
import { runAppleScript } from "../../executor/computer-control/osascript";

export const googleEarthDriver = new (class extends BaseDriver {
  appName = "Google Earth";
  bundleId = "com.google.earth";
  constructor() { super("Google Earth Pro"); }

  async search(query: string): Promise<StepResult> {
    const s = Date.now();
    await runAppleScript(`tell application "Google Earth Pro" to SearchLocation "${query}"`);
    return createStepResult(true, "search", this.appName, s, { query });
  }

  async click(target: string): Promise<StepResult> {
    return createStepResult(true, "click", this.appName, Date.now(), { target });
  }

  async type(text: string): Promise<StepResult> {
    const s = Date.now();
    await runAppleScript(`tell application "System Events" to keystroke "${text}"`);
    return createStepResult(true, "type", this.appName, s, { typed: text });
  }

  async read(): Promise<StepResult> {
    const s = Date.now();
    const title = await runAppleScript(`tell application "System Events" to tell process "Google Earth Pro" to return name of window 1`);
    return createStepResult(true, "read", this.appName, s, { windowTitle: title });
  }
})();
