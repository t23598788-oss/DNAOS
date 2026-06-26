/**
 * Accessibility Executor — CLICK / TYPE_TEXT / PRESS_KEY / SCROLL / READ_WINDOW
 */

import { runScript, esc, type MacResult } from "./applescript";

const SYS = "System Events";

export async function click(target: string, app?: string): Promise<MacResult> {
  if (app) {
    return runScript(`tell application "${SYS}" to tell process "${esc(app)}" to click button "${esc(target)}" of window 1`);
  }
  return runScript(`tell application "${SYS}" to key code 36`); // Enter as default click
}

export async function typeText(text: string): Promise<MacResult> {
  // Paste via clipboard — handles Thai text correctly
  const r1 = await runScript(`set the clipboard to "${esc(text)}"`);
  if (!r1.ok) return r1;
  await new Promise(r => setTimeout(r, 100));
  return runScript(`tell application "${SYS}" to keystroke "v" using command down`);
}

export async function pressKey(key: string): Promise<MacResult> {
  // Support formats: "enter", "tab", "escape", "cmd+c", "cmd+shift+d"
  const parts = key.toLowerCase().split("+");
  const mainKey = parts.pop()!;
  const mods = parts;

  const keyCode = keyCodes[mainKey];
  const modStr = mods.map(m => modMap[m] ?? `${m} down`).filter(Boolean).join(", ");

  if (keyCode !== undefined) {
    const using = modStr ? ` using {${modStr}}` : "";
    return runScript(`tell application "${SYS}" to key code ${keyCode}${using}`);
  }

  if (mainKey.length === 1) {
    const using = modStr ? ` using {${modStr}}` : "";
    return runScript(`tell application "${SYS}" to keystroke "${esc(mainKey)}"${using}`);
  }

  return { ok: false, error: `Unknown key: ${key}`, reason: "ใช้ชื่อปุ่มเช่น enter, tab, escape, cmd+c" };
}

export async function scroll(direction: "up" | "down", amount = 3): Promise<MacResult> {
  const delta = direction === "up" ? amount : -amount;
  return runScript(`
    tell application "${SYS}"
      set frontApp to name of first process whose frontmost is true
      tell process frontApp
        scroll area 1 of window 1 by ${delta}
      end tell
    end tell
  `);
}

export async function readWindow(app?: string): Promise<MacResult> {
  const target = app ? `tell process "${esc(app)}"` : `tell (first process whose frontmost is true)`;
  return runScript(`
    tell application "${SYS}"
      ${target}
        set winName to name of window 1
        set uiElements to name of every UI element of window 1
        set AppleScript's text item delimiters to "|||"
        return winName & ":::" & (uiElements as text)
      end tell
    end tell
  `);
}

const keyCodes: Record<string, number> = {
  enter: 36, return: 36, tab: 48, space: 49, delete: 51, backspace: 51,
  escape: 53, esc: 53, left: 123, right: 124, down: 125, up: 126,
  f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100,
  f9: 101, f10: 109, f11: 103, f12: 111,
  home: 115, end: 119, pageup: 116, pagedown: 121,
};

const modMap: Record<string, string> = {
  cmd: "command down", command: "command down",
  opt: "option down", option: "option down", alt: "option down",
  ctrl: "control down", control: "control down",
  shift: "shift down",
};
