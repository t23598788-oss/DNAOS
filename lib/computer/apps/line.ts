import { BaseDriver, createStepResult, type StepResult } from "../driver";
import { runAppleScript, escapeAppleScript } from "../../executor/computer-control/osascript";

export const lineDriver = new (class extends BaseDriver {
  appName = "LINE";
  bundleId = "jp.naver.line.mac";
  constructor() { super("LINE"); }

  async search(query: string): Promise<StepResult> {
    const s = Date.now();
    await runAppleScript(`tell application "System Events" to tell process "LINE" to keystroke "f" using command down`);
    await delay(300);
    await runAppleScript(`tell application "System Events" to keystroke "${escapeAppleScript(query)}"`);
    return createStepResult(true, "search", this.appName, s, { query });
  }

  async click(target: string): Promise<StepResult> {
    const s = Date.now();
    if (target === "chat" || target === "submit") {
      await runAppleScript(`tell application "System Events" to key code 36`);
    }
    return createStepResult(true, "click", this.appName, s, { target });
  }

  async type(text: string): Promise<StepResult> {
    const s = Date.now();
    await runAppleScript(`set the clipboard to "${escapeAppleScript(text)}"`);
    await delay(100);
    await runAppleScript(`tell application "System Events" to keystroke "v" using command down`);
    return createStepResult(true, "type", this.appName, s, { chars: text.length });
  }

  async read(): Promise<StepResult> {
    const s = Date.now();
    const title = await runAppleScript(`tell application "System Events" to tell process "LINE" to return name of window 1`);
    return createStepResult(true, "read", this.appName, s, { windowTitle: title });
  }
})();

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }
