import { BaseDriver, createStepResult, type StepResult } from "../driver";
import { runAppleScript, escapeAppleScript } from "../../executor/computer-control/osascript";

export const terminalDriver = new (class extends BaseDriver {
  appName = "Terminal";
  bundleId = "com.apple.Terminal";
  constructor() { super("Terminal"); }

  async search(query: string): Promise<StepResult> {
    const s = Date.now();
    await runAppleScript(`tell application "Terminal" to do script "find . -name \\"${escapeAppleScript(query)}\\""`);
    return createStepResult(true, "search", this.appName, s, { query });
  }

  async click(target: string): Promise<StepResult> {
    const s = Date.now();
    if (target === "submit") await runAppleScript(`tell application "System Events" to key code 36`);
    return createStepResult(true, "click", this.appName, s, { target });
  }

  async type(text: string): Promise<StepResult> {
    const s = Date.now();
    await runAppleScript(`tell application "Terminal" to do script "${escapeAppleScript(text)}" in selected tab of window 1`);
    return createStepResult(true, "type", this.appName, s, { command: text });
  }

  async read(): Promise<StepResult> {
    const s = Date.now();
    const content = await runAppleScript(`tell application "Terminal" to return contents of selected tab of window 1`);
    return createStepResult(true, "read", this.appName, s, { content: content.slice(-500) });
  }
})();
