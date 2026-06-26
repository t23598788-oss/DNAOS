/**
 * State Monitor
 *
 * ตรวจสอบสถานะโปรแกรม — เปิดอยู่? โฟกัสอยู่? พร้อมใช้?
 * ใช้ AppleScript ผ่าน computer-control layer
 */

import { runAppleScript, escapeAppleScript, isLocalMac, runShell } from "../executor/computer-control/osascript";
import type { AppStatus } from "./driver";

export async function isRunning(appName: string): Promise<boolean> {
  if (!isLocalMac()) return false;
  try {
    const result = await runShell("pgrep", ["-xq", appName]);
    return true;
  } catch {
    try {
      const ps = await runShell("pgrep", ["-fl", appName]);
      return ps.length > 0;
    } catch {
      return false;
    }
  }
}

export async function isFocused(appName: string): Promise<boolean> {
  if (!isLocalMac()) return false;
  try {
    const result = await runShell("lsappinfo", ["front"]);
    return result.includes(appName);
  } catch {
    return false;
  }
}

export async function activate(appName: string): Promise<void> {
  if (!isLocalMac()) throw new Error("macOS only");
  await runShell("open", ["-a", appName]);
}

export async function waitUntilReady(
  appName: string,
  timeoutMs: number = 10_000
): Promise<boolean> {
  if (!isLocalMac()) return false;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await isRunning(appName)) return true;
    await sleep(500);
  }
  return false;
}

export async function getAppStatus(appName: string): Promise<AppStatus> {
  if (!isLocalMac()) return "closed";

  const running = await isRunning(appName);
  if (!running) return "closed";

  const focused = await isFocused(appName);
  if (focused) return "focused";

  return "background";
}

export async function getAllRunningApps(): Promise<string[]> {
  if (!isLocalMac()) return [];
  try {
    const raw = await runShell("lsappinfo", ["list"]);
    const names = raw.match(/"LSDisplayName"="([^"]+)"/g) ?? [];
    return names.map((m) => m.replace(/"LSDisplayName"="/, "").replace(/"$/, ""));
  } catch {
    return [];
  }
}

export async function getFocusedApp(): Promise<string> {
  if (!isLocalMac()) return "";
  try {
    const raw = await runShell("lsappinfo", ["info", "-only", "name", "-app", "front"]);
    const match = raw.match(/"([^"]+)"/);
    return match ? match[1] : "";
  } catch {
    return "";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
