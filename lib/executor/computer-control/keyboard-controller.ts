/**
 * Keyboard Controller
 *
 * สั่งพิมพ์ข้อความ กดปุ่ม กด Shortcut ผ่าน System Events
 */

import { ActionResult, KeyboardAction, MacModifier } from "./types";
import { runAppleScript, escapeAppleScript } from "./osascript";

const KEY_CODES: Record<string, number> = {
  return: 36, enter: 36, tab: 48, space: 49, delete: 51,
  escape: 53, esc: 53,
  left: 123, right: 124, down: 125, up: 126,
  f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97,
  f7: 98, f8: 100, f9: 101, f10: 109, f11: 103, f12: 111,
  home: 115, end: 119, pageup: 116, pagedown: 121,
  forwarddelete: 117,
};

export async function executeKeyboard(action: KeyboardAction): Promise<ActionResult> {
  const start = Date.now();

  try {
    switch (action.command) {
      case "type_text": {
        if (!action.text) return fail(action, start, "ต้องระบุ text");
        const escaped = escapeAppleScript(action.text);
        await runAppleScript(`
          tell application "System Events"
            keystroke "${escaped}"
          end tell
        `);
        return ok(action, start, { typed: action.text.length + " chars" });
      }

      case "paste_text": {
        if (!action.text) return fail(action, start, "ต้องระบุ text");
        const escaped = escapeAppleScript(action.text);
        await runAppleScript(`
          set the clipboard to "${escaped}"
          delay 0.1
          tell application "System Events"
            keystroke "v" using command down
          end tell
        `);
        return ok(action, start, { pasted: action.text.length + " chars" });
      }

      case "press_key": {
        if (!action.key) return fail(action, start, "ต้องระบุ key");
        const keyLower = action.key.toLowerCase();
        const code = KEY_CODES[keyLower];
        if (code !== undefined) {
          await runAppleScript(`
            tell application "System Events"
              key code ${code}
            end tell
          `);
        } else if (action.key.length === 1) {
          await runAppleScript(`
            tell application "System Events"
              keystroke "${escapeAppleScript(action.key)}"
            end tell
          `);
        } else {
          return fail(action, start, `ไม่รู้จัก key: ${action.key}`);
        }
        return ok(action, start, { pressed: action.key });
      }

      case "press_shortcut":
      case "key_combination": {
        if (!action.key) return fail(action, start, "ต้องระบุ key");
        const mods = action.modifiers ?? ["command"];
        const modStr = mods.map(modToAppleScript).join(", ");
        const keyLower = action.key.toLowerCase();
        const code = KEY_CODES[keyLower];

        if (code !== undefined) {
          await runAppleScript(`
            tell application "System Events"
              key code ${code} using {${modStr}}
            end tell
          `);
        } else {
          await runAppleScript(`
            tell application "System Events"
              keystroke "${escapeAppleScript(action.key)}" using {${modStr}}
            end tell
          `);
        }
        return ok(action, start, { shortcut: mods.join("+") + "+" + action.key });
      }

      case "hold_key": {
        if (!action.key) return fail(action, start, "ต้องระบุ key");
        // AppleScript doesn't support hold/release natively — simulate with key down event
        await runAppleScript(`
          tell application "System Events"
            key down ${KEY_CODES[action.key.toLowerCase()] ?? 0}
          end tell
        `);
        return ok(action, start, { holding: action.key });
      }

      case "release_key": {
        if (!action.key) return fail(action, start, "ต้องระบุ key");
        await runAppleScript(`
          tell application "System Events"
            key up ${KEY_CODES[action.key.toLowerCase()] ?? 0}
          end tell
        `);
        return ok(action, start, { released: action.key });
      }

      case "submit": {
        await runAppleScript(`
          tell application "System Events"
            key code 36
          end tell
        `);
        return ok(action, start, { submitted: true });
      }

      case "escape": {
        await runAppleScript(`
          tell application "System Events"
            key code 53
          end tell
        `);
        return ok(action, start, { escaped: true });
      }

      case "tab": {
        await runAppleScript(`
          tell application "System Events"
            key code 48
          end tell
        `);
        return ok(action, start, { tabbed: true });
      }

      default:
        return fail(action, start, `ไม่รองรับ keyboard command: ${action.command}`);
    }
  } catch (e) {
    return fail(action, start, (e as Error).message);
  }
}

function modToAppleScript(mod: MacModifier): string {
  switch (mod) {
    case "command": return "command down";
    case "option": return "option down";
    case "control": return "control down";
    case "shift": return "shift down";
    case "fn": return "fn down";
  }
}

function ok(action: KeyboardAction, start: number, result: unknown): ActionResult {
  return {
    status: "success",
    action: `keyboard.${action.command}`,
    durationMs: Date.now() - start,
    result,
  };
}

function fail(action: KeyboardAction, start: number, error: string): ActionResult {
  return {
    status: "failed",
    action: `keyboard.${action.command}`,
    durationMs: Date.now() - start,
    error,
  };
}
