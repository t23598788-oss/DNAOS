/**
 * Clipboard Controller
 *
 * จัดการ Clipboard ของ macOS
 * รองรับ copy/paste/store/restore/transfer ระหว่างแอป
 */

import { ActionResult, ClipboardAction } from "./types";
import { runAppleScript, escapeAppleScript, runShell } from "./osascript";

let storedClipboard: string | null = null;

export async function executeClipboard(action: ClipboardAction): Promise<ActionResult> {
  const start = Date.now();

  try {
    switch (action.command) {
      case "copy": {
        if (action.text) {
          await runAppleScript(`set the clipboard to "${escapeAppleScript(action.text)}"`);
          return ok(action, start, { copied: action.text.length + " chars" });
        }
        // copy จากแอปปัจจุบัน (Cmd+C)
        await runAppleScript(`
          tell application "System Events"
            keystroke "c" using command down
          end tell
        `);
        await sleep(200);
        const content = await getClipboard();
        return ok(action, start, { copied: content.length + " chars" });
      }

      case "paste": {
        if (action.text) {
          await runAppleScript(`set the clipboard to "${escapeAppleScript(action.text)}"`);
          await sleep(100);
        }
        await runAppleScript(`
          tell application "System Events"
            keystroke "v" using command down
          end tell
        `);
        return ok(action, start, { pasted: true });
      }

      case "store": {
        storedClipboard = await getClipboard();
        return ok(action, start, { stored: storedClipboard.length + " chars" });
      }

      case "restore": {
        if (storedClipboard === null) return fail(action, start, "ไม่มี clipboard ที่เก็บไว้");
        await runAppleScript(`set the clipboard to "${escapeAppleScript(storedClipboard)}"`);
        return ok(action, start, { restored: storedClipboard.length + " chars" });
      }

      case "transfer": {
        if (!action.sourceApp || !action.targetApp)
          return fail(action, start, "ต้องระบุ sourceApp และ targetApp");

        // 1. ไปแอปต้นทาง copy
        await runAppleScript(`tell application "${escapeAppleScript(action.sourceApp)}" to activate`);
        await sleep(300);
        await runAppleScript(`
          tell application "System Events"
            keystroke "c" using command down
          end tell
        `);
        await sleep(300);

        const transferred = await getClipboard();

        // 2. ไปแอปปลายทาง paste
        await runAppleScript(`tell application "${escapeAppleScript(action.targetApp)}" to activate`);
        await sleep(300);
        await runAppleScript(`
          tell application "System Events"
            keystroke "v" using command down
          end tell
        `);

        return ok(action, start, {
          from: action.sourceApp,
          to: action.targetApp,
          chars: transferred.length,
        });
      }

      default:
        return fail(action, start, `ไม่รองรับ clipboard command: ${action.command}`);
    }
  } catch (e) {
    return fail(action, start, (e as Error).message);
  }
}

export async function getClipboard(): Promise<string> {
  return runShell("pbpaste", []);
}

export async function setClipboard(text: string): Promise<void> {
  await runAppleScript(`set the clipboard to "${escapeAppleScript(text)}"`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function ok(action: ClipboardAction, start: number, result: unknown): ActionResult {
  return {
    status: "success",
    action: `clipboard.${action.command}`,
    durationMs: Date.now() - start,
    result,
  };
}

function fail(action: ClipboardAction, start: number, error: string): ActionResult {
  return {
    status: "failed",
    action: `clipboard.${action.command}`,
    durationMs: Date.now() - start,
    error,
  };
}
