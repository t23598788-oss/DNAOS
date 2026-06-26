import { BaseDriver, createStepResult, type StepResult } from "../driver";
import { runAppleScript, escapeAppleScript } from "../../executor/computer-control/osascript";

export const mailDriver = new (class extends BaseDriver {
  appName = "Mail";
  bundleId = "com.apple.mail";
  constructor() { super("Mail"); }

  async search(query: string): Promise<StepResult> {
    const s = Date.now();
    await runAppleScript(`tell application "System Events" to keystroke "f" using {command down, option down}`);
    await new Promise(r => setTimeout(r, 300));
    await runAppleScript(`tell application "System Events" to keystroke "${escapeAppleScript(query)}"`);
    return createStepResult(true, "search", this.appName, s, { query });
  }

  async click(target: string): Promise<StepResult> {
    const s = Date.now();
    if (target === "compose") await runAppleScript(`tell application "System Events" to keystroke "n" using command down`);
    else if (target === "subject" || target === "body") await runAppleScript(`tell application "System Events" to key code 48`);
    else if (target.startsWith("shortcut:")) await runAppleScript(`tell application "System Events" to keystroke "${escapeAppleScript(target.slice(9))}" using {command down, shift down}`);
    return createStepResult(true, "click", this.appName, s, { target });
  }

  async type(text: string): Promise<StepResult> {
    const s = Date.now();
    await runAppleScript(`tell application "System Events" to keystroke "${escapeAppleScript(text)}"`);
    return createStepResult(true, "type", this.appName, s, { chars: text.length });
  }

  async read(): Promise<StepResult> {
    const s = Date.now();
    const count = await runAppleScript(`tell application "Mail" to return count of messages of inbox`);
    return createStepResult(true, "read", this.appName, s, { inboxCount: count });
  }
})();
