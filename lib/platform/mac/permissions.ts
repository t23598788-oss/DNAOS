/**
 * macOS Permission Checker
 */

import { runScript, runShell, type MacResult } from "./applescript";

export type PermissionName = "accessibility" | "automation" | "screen_recording" | "files_and_folders" | "notifications";

export async function checkPermission(name: PermissionName, appName?: string): Promise<MacResult> {
  switch (name) {
    case "accessibility":
      return checkAccessibility();
    case "automation":
      return checkAutomation(appName ?? "System Events");
    case "screen_recording":
      return checkScreenRecording();
    case "files_and_folders":
      return { ok: true, reason: "not checked" };
    case "notifications":
      return { ok: true, reason: "not checked" };
  }
}

async function checkAccessibility(): Promise<MacResult> {
  const r = await runScript(`tell application "System Events" to return name of first process whose frontmost is true`);
  if (r.ok) return { ok: true, reason: "Accessibility granted" };
  return { ok: false, error: "Accessibility not granted", reason: "System Settings > Privacy & Security > Accessibility" };
}

async function checkAutomation(app: string): Promise<MacResult> {
  const r = await runScript(`tell application "${app}" to return name`);
  if (r.ok) return { ok: true, reason: `Automation for ${app} granted` };
  return { ok: false, error: `Automation for ${app} not granted`, reason: "System Settings > Privacy & Security > Automation" };
}

async function checkScreenRecording(): Promise<MacResult> {
  const r = await runShell("screencapture", ["-x", "-t", "jpg", "/dev/null"]);
  if (r.ok) return { ok: true, reason: "Screen Recording granted" };
  return { ok: false, error: "Screen Recording not granted", reason: "System Settings > Privacy & Security > Screen Recording" };
}

export async function openSettings(pane: string): Promise<MacResult> {
  return runShell("open", [`x-apple.systempreferences:com.apple.preference.security?${pane}`]);
}
