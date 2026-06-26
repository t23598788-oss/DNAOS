import { BaseDriver, createStepResult, type StepResult } from "../driver";
import { runAppleScript, escapeAppleScript } from "../../executor/computer-control/osascript";

export const finderDriver = new (class extends BaseDriver {
  appName = "Finder";
  bundleId = "com.apple.finder";
  constructor() { super("Finder"); }

  async search(query: string): Promise<StepResult> {
    const s = Date.now();
    await runAppleScript(`tell application "Finder" to open POSIX file "${escapeAppleScript(query)}"`);
    return createStepResult(true, "search", this.appName, s, { path: query });
  }

  async click(target: string): Promise<StepResult> {
    const s = Date.now();
    if (target === "new_folder") {
      await runAppleScript(`tell application "System Events" to keystroke "n" using {command down, shift down}`);
    }
    return createStepResult(true, "click", this.appName, s, { target });
  }

  async type(text: string): Promise<StepResult> {
    const s = Date.now();
    await runAppleScript(`tell application "System Events" to keystroke "${escapeAppleScript(text)}"`);
    return createStepResult(true, "type", this.appName, s, { typed: text });
  }

  async read(): Promise<StepResult> {
    const s = Date.now();
    const raw = await runAppleScript(`
      tell application "Finder"
        set sel to selection
        set paths to {}
        repeat with f in sel
          set end of paths to POSIX path of (f as alias)
        end repeat
        set AppleScript's text item delimiters to "|||"
        return paths as text
      end tell
    `);
    return createStepResult(true, "read", this.appName, s, { selected: raw.split("|||").filter(Boolean) });
  }

  async close(): Promise<StepResult> {
    const s = Date.now();
    await runAppleScript(`tell application "Finder" to close every window`);
    return createStepResult(true, "close", this.appName, s);
  }
})();
