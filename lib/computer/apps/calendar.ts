import { BaseDriver, createStepResult, type StepResult } from "../driver";
import { runAppleScript, escapeAppleScript } from "../../executor/computer-control/osascript";

export const calendarDriver = new (class extends BaseDriver {
  appName = "Calendar";
  bundleId = "com.apple.iCal";
  constructor() { super("Calendar"); }

  async search(query: string): Promise<StepResult> {
    const s = Date.now();
    await runAppleScript(`tell application "System Events" to keystroke "f" using command down`);
    await new Promise(r => setTimeout(r, 300));
    await runAppleScript(`tell application "System Events" to keystroke "${escapeAppleScript(query)}"`);
    return createStepResult(true, "search", this.appName, s, { query });
  }

  async click(target: string): Promise<StepResult> {
    const s = Date.now();
    if (target === "new_event") await runAppleScript(`tell application "System Events" to keystroke "n" using command down`);
    else if (target === "submit") await runAppleScript(`tell application "System Events" to key code 36`);
    return createStepResult(true, "click", this.appName, s, { target });
  }

  async type(text: string): Promise<StepResult> {
    const s = Date.now();
    await runAppleScript(`tell application "System Events" to keystroke "${escapeAppleScript(text)}"`);
    return createStepResult(true, "type", this.appName, s, { typed: text });
  }

  async read(): Promise<StepResult> {
    const s = Date.now();
    const title = await runAppleScript(`tell application "System Events" to tell process "Calendar" to return name of window 1`);
    return createStepResult(true, "read", this.appName, s, { windowTitle: title });
  }
})();
