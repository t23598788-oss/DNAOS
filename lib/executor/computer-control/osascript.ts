/**
 * AppleScript Runner
 *
 * ท่อตรงไป macOS — ใช้ osascript สั่ง Automation
 * ทำงานได้เฉพาะ local (next dev) ไม่ทำงานบน Vercel
 */

import { execFile } from "child_process";

const DEFAULT_TIMEOUT = 15_000;

export function isLocalMac(): boolean {
  return process.platform === "darwin";
}

export async function runAppleScript(
  script: string,
  timeoutMs: number = DEFAULT_TIMEOUT
): Promise<string> {
  if (!isLocalMac()) {
    throw new Error("Computer Control ทำงานได้เฉพาะบน macOS เท่านั้น");
  }

  return new Promise((resolve, reject) => {
    execFile(
      "osascript",
      ["-e", script],
      { timeout: timeoutMs },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr?.trim() || error.message));
        } else {
          resolve(stdout.trim());
        }
      }
    );
  });
}

export async function runJxa(
  script: string,
  timeoutMs: number = DEFAULT_TIMEOUT
): Promise<string> {
  if (!isLocalMac()) {
    throw new Error("Computer Control ทำงานได้เฉพาะบน macOS เท่านั้น");
  }

  return new Promise((resolve, reject) => {
    execFile(
      "osascript",
      ["-l", "JavaScript", "-e", script],
      { timeout: timeoutMs },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr?.trim() || error.message));
        } else {
          resolve(stdout.trim());
        }
      }
    );
  });
}

export async function runShell(
  command: string,
  args: string[] = [],
  timeoutMs: number = DEFAULT_TIMEOUT
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || error.message));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

export function escapeAppleScript(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
