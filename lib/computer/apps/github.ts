import { BaseDriver, createStepResult, type StepResult } from "../driver";
import { runAppleScript, escapeAppleScript } from "../../executor/computer-control/osascript";

export const githubDriver = new (class extends BaseDriver {
  appName = "GitHub Desktop";
  bundleId = "com.github.GitHubClient";
  constructor() { super("GitHub Desktop"); }

  async search(query: string): Promise<StepResult> {
    const s = Date.now();
    await runAppleScript(`tell application "System Events" to keystroke "f" using command down`);
    await new Promise(r => setTimeout(r, 300));
    await runAppleScript(`tell application "System Events" to keystroke "${escapeAppleScript(query)}"`);
    return createStepResult(true, "search", this.appName, s, { query });
  }

  async click(target: string): Promise<StepResult> {
    const s = Date.now();
    if (target === "commit" || target === "submit") await runAppleScript(`tell application "System Events" to keystroke return using command down`);
    else if (target === "push") await runAppleScript(`tell application "System Events" to keystroke "p" using command down`);
    else if (target === "pull") await runAppleScript(`tell application "System Events" to keystroke "p" using {command down, shift down}`);
    else if (target.startsWith("shortcut:")) await runAppleScript(`tell application "System Events" to keystroke "${escapeAppleScript(target.slice(9))}" using command down`);
    return createStepResult(true, "click", this.appName, s, { target });
  }

  async type(text: string): Promise<StepResult> {
    const s = Date.now();
    await runAppleScript(`tell application "System Events" to keystroke "${escapeAppleScript(text)}"`);
    return createStepResult(true, "type", this.appName, s, { typed: text });
  }

  async read(): Promise<StepResult> {
    const s = Date.now();
    const title = await runAppleScript(`tell application "System Events" to tell process "GitHub Desktop" to return name of window 1`);
    return createStepResult(true, "read", this.appName, s, { windowTitle: title });
  }
})();
