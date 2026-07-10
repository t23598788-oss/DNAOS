/**
 * Shell / AppleScript Runner — Node only
 * ที่เดียวที่เรียก child_process ได้
 */

import { execFile } from "child_process";

export async function shell(cmd: string, args: string[] = [], timeoutMs = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.trim() || err.message));
      else resolve(stdout.trim());
    });
  });
}

export async function osascript(script: string, timeoutMs = 15000): Promise<string> {
  return shell("osascript", ["-e", script], timeoutMs);
}

export async function openApp(name: string): Promise<void> {
  await shell("open", ["-a", name]);
}

export async function openUrl(url: string): Promise<void> {
  await shell("open", [url]);
}

export async function isProcessRunning(name: string): Promise<boolean> {
  try {
    await shell("pgrep", ["-fl", name]);
    return true;
  } catch {
    return false;
  }
}

export async function waitUntilRunning(name: string, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isProcessRunning(name)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

export function esc(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
