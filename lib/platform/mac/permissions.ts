/**
 * Permissions — ตรวจสอบสิทธิ์ macOS (Accessibility, Screen Recording, ฯลฯ)
 */

import { runShell } from "./applescript";

export type PermissionName =
  | "accessibility"
  | "screen-recording"
  | "camera"
  | "microphone"
  | "full-disk-access"
  | "location"
  | "contacts"
  | "calendar"
  | "reminders"
  | "photos";

const PREFS_PANEL: Record<PermissionName, string> = {
  "accessibility":    "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  "screen-recording": "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  "camera":           "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera",
  "microphone":       "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
  "full-disk-access": "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
  "location":         "x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices",
  "contacts":         "x-apple.systempreferences:com.apple.preference.security?Privacy_Contacts",
  "calendar":         "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars",
  "reminders":        "x-apple.systempreferences:com.apple.preference.security?Privacy_Reminders",
  "photos":           "x-apple.systempreferences:com.apple.preference.security?Privacy_Photos",
};

export async function checkPermission(name: PermissionName): Promise<boolean> {
  if (name === "accessibility") {
    const { ok, output } = await runShell("osascript", [
      "-e",
      'tell application "System Events" to get name of every process',
    ]);
    return ok && output.length > 0;
  }
  // For other permissions, attempt the macOS tcc database check via sqlite
  const { ok, output } = await runShell("sqlite3", [
    "/Library/Application Support/com.apple.TCC/TCC.db",
    `SELECT allowed FROM access WHERE service='kTCCService${name}' LIMIT 1;`,
  ]);
  return ok && output.trim() === "1";
}

export async function openSettings(name: PermissionName): Promise<void> {
  const url = PREFS_PANEL[name];
  await runShell("open", [url]);
}
