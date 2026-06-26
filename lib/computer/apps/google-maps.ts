import { BaseDriver, createStepResult, type StepResult } from "../driver";
import { runAppleScript, escapeAppleScript, runShell } from "../../executor/computer-control/osascript";

export const googleMapsDriver = new (class extends BaseDriver {
  appName = "Google Maps";
  bundleId = "com.google.Chrome";
  constructor() { super("Google Chrome"); }

  async launch(): Promise<StepResult> {
    const s = Date.now();
    await runShell("open", ["https://maps.google.com"]);
    return createStepResult(true, "launch", this.appName, s);
  }

  async search(query: string): Promise<StepResult> {
    const s = Date.now();
    await runShell("open", [`https://maps.google.com/maps/search/${encodeURIComponent(query)}`]);
    return createStepResult(true, "search", this.appName, s, { query });
  }

  async click(target: string): Promise<StepResult> {
    const s = Date.now();
    if (target.startsWith("url:")) await runShell("open", [target.slice(4)]);
    return createStepResult(true, "click", this.appName, s, { target });
  }

  async type(text: string): Promise<StepResult> {
    const s = Date.now();
    await runAppleScript(`tell application "System Events" to keystroke "${escapeAppleScript(text)}"`);
    return createStepResult(true, "type", this.appName, s, { typed: text });
  }

  async read(): Promise<StepResult> {
    const s = Date.now();
    const url = await runAppleScript(`tell application "Google Chrome" to return URL of active tab of window 1`);
    return createStepResult(true, "read", this.appName, s, { url });
  }
})();
