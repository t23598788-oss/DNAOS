import { BaseDriver, createStepResult, type StepResult } from "../driver";
import { runAppleScript, escapeAppleScript } from "../../executor/computer-control/osascript";

export const chromeDriver = new (class extends BaseDriver {
  appName = "Google Chrome";
  bundleId = "com.google.Chrome";
  constructor() { super("Google Chrome"); }

  async search(query: string): Promise<StepResult> {
    const s = Date.now();
    await runAppleScript(`tell application "Google Chrome" to open location "https://www.google.com/search?q=${encodeURIComponent(query)}"`);
    return createStepResult(true, "search", this.appName, s, { query });
  }

  async click(target: string): Promise<StepResult> {
    const s = Date.now();
    if (target.startsWith("url:")) {
      await runAppleScript(`tell application "Google Chrome" to open location "${escapeAppleScript(target.slice(4))}"`);
      return createStepResult(true, "click", this.appName, s, { url: target.slice(4) });
    }
    if (target.startsWith("shortcut:")) {
      await runAppleScript(`tell application "System Events" to keystroke "${escapeAppleScript(target.slice(9))}" using command down`);
    }
    return createStepResult(true, "click", this.appName, s, { target });
  }

  async type(text: string): Promise<StepResult> {
    const s = Date.now();
    await runAppleScript(`tell application "System Events" to keystroke "${escapeAppleScript(text)}"`);
    return createStepResult(true, "type", this.appName, s, { chars: text.length });
  }

  async read(): Promise<StepResult> {
    const s = Date.now();
    const url = await runAppleScript(`tell application "Google Chrome" to return URL of active tab of window 1`);
    const title = await runAppleScript(`tell application "Google Chrome" to return title of active tab of window 1`);
    return createStepResult(true, "read", this.appName, s, { url, title });
  }
})();
