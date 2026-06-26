import { BaseDriver, createStepResult, type StepResult } from "../driver";
import { runAppleScript, escapeAppleScript } from "../../executor/computer-control/osascript";

export const pdfDriver = new (class extends BaseDriver {
  appName = "PDF Viewer";
  bundleId = "com.apple.Preview";
  constructor() { super("Preview"); }

  async search(query: string): Promise<StepResult> {
    const s = Date.now();
    if (query.includes("/")) {
      await runAppleScript(`tell application "Preview" to open POSIX file "${escapeAppleScript(query)}"`);
    } else {
      await runAppleScript(`tell application "System Events" to keystroke "f" using command down`);
      await new Promise(r => setTimeout(r, 300));
      await runAppleScript(`tell application "System Events" to keystroke "${escapeAppleScript(query)}"`);
    }
    return createStepResult(true, "search", this.appName, s, { query });
  }

  async click(target: string): Promise<StepResult> {
    const s = Date.now();
    if (target === "print") await runAppleScript(`tell application "System Events" to keystroke "p" using command down`);
    else if (target === "export") await runAppleScript(`tell application "System Events" to keystroke "e" using command down`);
    return createStepResult(true, "click", this.appName, s, { target });
  }

  async type(text: string): Promise<StepResult> {
    const s = Date.now();
    await runAppleScript(`tell application "System Events" to keystroke "${escapeAppleScript(text)}"`);
    return createStepResult(true, "type", this.appName, s, { typed: text });
  }

  async read(): Promise<StepResult> {
    const s = Date.now();
    const title = await runAppleScript(`tell application "System Events" to tell process "Preview" to return name of window 1`);
    return createStepResult(true, "read", this.appName, s, { windowTitle: title });
  }
})();
