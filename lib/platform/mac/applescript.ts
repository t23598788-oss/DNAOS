/**
 * AppleScript Runner — จุดเดียวที่เรียก child_process
 */

import { execFile } from "child_process";

export interface MacResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  reason?: string;
}

export async function runScript(script: string, timeout = 15000): Promise<MacResult> {
  try {
    const out = await exec("osascript", ["-e", script], timeout);
    return { ok: true, data: out };
  } catch (e) {
    return { ok: false, error: (e as Error).message, reason: "AppleScript failed" };
  }
}

export async function runShell(cmd: string, args: string[] = [], timeout = 15000): Promise<MacResult> {
  try {
    const out = await exec(cmd, args, timeout);
    return { ok: true, data: out };
  } catch (e) {
    return { ok: false, error: (e as Error).message, reason: `${cmd} failed` };
  }
}

export function esc(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function exec(cmd: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.trim() || err.message));
      else resolve(stdout.trim());
    });
  });
}
