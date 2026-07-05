/**
 * AppleScript Runner — ที่เดียวที่เรียก osascript
 * wraps lib/v6-executor/runtime/shell ด้วย typed result
 */

import { osascript, shell, esc as shellEsc } from "@/lib/v6-executor/runtime/shell";

export interface MacResult {
  ok: boolean;
  output: string;
  error?: string;
}

export async function runScript(script: string, timeoutMs = 15000): Promise<MacResult> {
  try {
    const output = await osascript(script, timeoutMs);
    return { ok: true, output };
  } catch (e: any) {
    return { ok: false, output: "", error: e.message ?? String(e) };
  }
}

export async function runShell(cmd: string, args: string[] = [], timeoutMs = 15000): Promise<MacResult> {
  try {
    const output = await shell(cmd, args, timeoutMs);
    return { ok: true, output };
  } catch (e: any) {
    return { ok: false, output: "", error: e.message ?? String(e) };
  }
}

export function esc(text: string): string {
  return shellEsc(text);
}
