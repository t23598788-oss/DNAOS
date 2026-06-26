import { BaseDriver, createStepResult, type StepResult } from "../driver";
import { runAppleScript, escapeAppleScript, runShell } from "../../executor/computer-control/osascript";

export const vscodeDriver = new (class extends BaseDriver {
  appName = "VS Code";
  bundleId = "com.microsoft.VSCode";
  constructor() { super("Visual Studio Code"); }

  async search(query: string): Promise<StepResult> {
    const s = Date.now();
    if (query.includes("/") || query.includes(".")) {
      await runShell("code", [query]);
    } else {
      await runAppleScript(`tell application "System Events" to keystroke "p" using command down`);
      await new Promise(r => setTimeout(r, 300));
      await runAppleScript(`tell application "System Events" to keystroke "${escapeAppleScript(query)}"`);
    }
    return createStepResult(true, "search", this.appName, s, { query });
  }

  async click(target: string): Promise<StepResult> {
    const s = Date.now();
    if (target === "terminal") await runAppleScript(`tell application "System Events" to keystroke "\`" using control down`);
    else if (target === "command_palette") await runAppleScript(`tell application "System Events" to keystroke "p" using {command down, shift down}`);
    else if (target.startsWith("shortcut:")) await runAppleScript(`tell application "System Events" to keystroke "${escapeAppleScript(target.slice(9))}" using command down`);
    return createStepResult(true, "click", this.appName, s, { target });
  }

  async type(text: string): Promise<StepResult> {
    const s = Date.now();
    await runAppleScript(`tell application "System Events" to keystroke "${escapeAppleScript(text)}"`);
    return createStepResult(true, "type", this.appName, s, { chars: text.length });
  }

  async read(): Promise<StepResult> {
    const s = Date.now();
    const title = await runAppleScript(`tell application "System Events" to tell process "Code" to return name of window 1`);
    return createStepResult(true, "read", this.appName, s, { windowTitle: title });
  }
})();
