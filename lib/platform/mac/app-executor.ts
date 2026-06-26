/**
 * App Executor — OPEN_APP / CLOSE_APP
 */

import { runShell, runScript, esc, type MacResult } from "./applescript";
import apps from "./apps.json";

type AppRegistry = Record<string, { bundleId: string; macName: string; url?: string }>;

export async function open(appName: string): Promise<MacResult> {
  const app = (apps as AppRegistry)[appName];
  if (!app) return { ok: false, error: `Unknown app: ${appName}`, reason: "ไม่อยู่ใน apps.json" };

  if (app.url) {
    return runShell("open", [app.url]);
  }
  return runShell("open", ["-a", app.macName]);
}

export async function close(appName: string): Promise<MacResult> {
  const app = (apps as AppRegistry)[appName];
  if (!app) return { ok: false, error: `Unknown app: ${appName}`, reason: "ไม่อยู่ใน apps.json" };

  return runScript(`tell application "${esc(app.macName)}" to quit`);
}

export async function isRunning(appName: string): Promise<boolean> {
  const app = (apps as AppRegistry)[appName];
  if (!app) return false;
  const r = await runShell("pgrep", ["-fl", app.macName]);
  return r.ok;
}

export async function waitReady(appName: string, timeoutMs = 5000): Promise<MacResult> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isRunning(appName)) return { ok: true, data: { ready: appName } };
    await new Promise(r => setTimeout(r, 400));
  }
  return { ok: false, error: `${appName} not ready`, reason: `Timeout ${timeoutMs}ms` };
}
