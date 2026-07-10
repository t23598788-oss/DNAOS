/**
 * Accessibility — คลิก/พิมพ์/กดปุ่ม/เลื่อน/อ่านหน้าต่าง ผ่าน macOS Accessibility API
 * ใช้ AppleScript System Events เป็น backend
 */

import { runScript } from "./applescript";
import { esc } from "./applescript";

export async function click(x: number, y: number): Promise<void> {
  const { ok, error } = await runScript(
    `tell application "System Events" to click at {${x}, ${y}}`
  );
  if (!ok) throw new Error(`accessibility.click failed: ${error}`);
}

export async function typeText(text: string): Promise<void> {
  const { ok, error } = await runScript(
    `tell application "System Events" to keystroke "${esc(text)}"`
  );
  if (!ok) throw new Error(`accessibility.typeText failed: ${error}`);
}

export async function pressKey(key: string, modifiers: string[] = []): Promise<void> {
  const mods = modifiers.length > 0 ? ` using {${modifiers.join(", ")}}` : "";
  const { ok, error } = await runScript(
    `tell application "System Events" to key code "${key}"${mods}`
  );
  if (!ok) throw new Error(`accessibility.pressKey failed: ${error}`);
}

export async function scroll(x: number, y: number, amount: number): Promise<void> {
  const { ok, error } = await runScript(
    `tell application "System Events" to scroll {${x}, ${y}} by ${amount}`
  );
  if (!ok) throw new Error(`accessibility.scroll failed: ${error}`);
}

export async function readWindow(appName: string): Promise<string> {
  const { ok, output, error } = await runScript(`
    tell application "System Events"
      tell process "${esc(appName)}"
        return name of every window
      end tell
    end tell
  `);
  if (!ok) throw new Error(`accessibility.readWindow failed: ${error}`);
  return output;
}
