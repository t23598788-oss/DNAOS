/**
 * App Executor — เปิด/ปิด/ตรวจสถานะโปรแกรม macOS
 */

import { openApp, isProcessRunning, waitUntilRunning } from "@/lib/v6-executor/runtime/shell";
import { runScript } from "./applescript";

export async function open(appName: string): Promise<void> {
  await openApp(appName);
}

export async function close(appName: string): Promise<void> {
  await runScript(`tell application "${appName}" to quit`);
}

export async function isRunning(appName: string): Promise<boolean> {
  return isProcessRunning(appName);
}

export async function waitReady(appName: string, timeoutMs = 8000): Promise<boolean> {
  return waitUntilRunning(appName, timeoutMs);
}
