/**
 * Shortcuts — สั่งรัน macOS Shortcuts ผ่าน CLI
 */

import { runShell } from "./applescript";

export async function run(shortcutName: string, input?: string): Promise<string> {
  const args = ["run", shortcutName];
  if (input !== undefined) args.push("--input-string", input);
  const { ok, output, error } = await runShell("shortcuts", args);
  if (!ok) throw new Error(`shortcuts.run("${shortcutName}") failed: ${error}`);
  return output;
}

export async function list(): Promise<string[]> {
  const { ok, output, error } = await runShell("shortcuts", ["list"]);
  if (!ok) throw new Error(`shortcuts.list failed: ${error}`);
  return output
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}
