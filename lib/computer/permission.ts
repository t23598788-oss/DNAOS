/**
 * Permission Checker
 *
 * ตรวจสิทธิ์ macOS ก่อน Execute ทุกครั้ง
 * - Accessibility
 * - Automation Permission
 * - Screen Recording
 * - Full Disk Access
 *
 * ถ้าไม่มีสิทธิ์ → แจ้งผู้ใช้ → เปิดหน้า System Settings
 */

import { runAppleScript, runShell, isLocalMac } from "../executor/computer-control/osascript";

export type PermissionType =
  | "accessibility"
  | "automation"
  | "screen_recording"
  | "full_disk_access";

export type PermissionStatus = "granted" | "denied" | "unknown" | "not_applicable";

export interface PermissionCheck {
  type: PermissionType;
  status: PermissionStatus;
  required: boolean;
  message: string;
}

export interface PermissionReport {
  allGranted: boolean;
  checks: PermissionCheck[];
  blockers: PermissionCheck[];
}

export async function checkAccessibility(): Promise<PermissionCheck> {
  if (!isLocalMac()) {
    return { type: "accessibility", status: "not_applicable", required: true, message: "ไม่ใช่ macOS" };
  }
  try {
    const result = await runAppleScript(`
      tell application "System Events"
        return name of first process whose frontmost is true
      end tell
    `);
    if (result) {
      return { type: "accessibility", status: "granted", required: true, message: "Accessibility พร้อมใช้งาน" };
    }
    return { type: "accessibility", status: "denied", required: true, message: "ต้องเปิด Accessibility ใน System Settings" };
  } catch {
    return { type: "accessibility", status: "denied", required: true, message: "ต้องเปิด Accessibility → System Settings > Privacy & Security > Accessibility" };
  }
}

export async function checkAutomation(appName: string): Promise<PermissionCheck> {
  if (!isLocalMac()) {
    return { type: "automation", status: "not_applicable", required: true, message: "ไม่ใช่ macOS" };
  }
  try {
    await runAppleScript(`
      tell application "${appName}"
        return name
      end tell
    `);
    return { type: "automation", status: "granted", required: true, message: `Automation สำหรับ ${appName} พร้อม` };
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("not allowed") || msg.includes("assistive")) {
      return { type: "automation", status: "denied", required: true, message: `ต้องอนุญาต Automation สำหรับ ${appName} → System Settings > Privacy & Security > Automation` };
    }
    return { type: "automation", status: "unknown", required: true, message: `ตรวจสอบ Automation สำหรับ ${appName} ไม่ได้: ${msg}` };
  }
}

export async function checkScreenRecording(): Promise<PermissionCheck> {
  if (!isLocalMac()) {
    return { type: "screen_recording", status: "not_applicable", required: false, message: "ไม่ใช่ macOS" };
  }
  try {
    await runShell("screencapture", ["-x", "-t", "jpg", "/dev/null"]);
    return { type: "screen_recording", status: "granted", required: false, message: "Screen Recording พร้อมใช้งาน" };
  } catch {
    return { type: "screen_recording", status: "denied", required: false, message: "ต้องเปิด Screen Recording → System Settings > Privacy & Security > Screen Recording" };
  }
}

export async function checkFullDiskAccess(): Promise<PermissionCheck> {
  if (!isLocalMac()) {
    return { type: "full_disk_access", status: "not_applicable", required: false, message: "ไม่ใช่ macOS" };
  }
  try {
    await runShell("ls", ["/Library/Application Support/com.apple.TCC/TCC.db"]);
    return { type: "full_disk_access", status: "granted", required: false, message: "Full Disk Access พร้อมใช้งาน" };
  } catch {
    return { type: "full_disk_access", status: "denied", required: false, message: "Full Disk Access ไม่ได้เปิด (ไม่จำเป็นสำหรับการใช้งานปกติ)" };
  }
}

export async function checkAllPermissions(appName?: string): Promise<PermissionReport> {
  const checks = await Promise.all([
    checkAccessibility(),
    checkAutomation(appName ?? "System Events"),
    checkScreenRecording(),
    checkFullDiskAccess(),
  ]);

  const blockers = checks.filter((c) => c.required && c.status === "denied");

  return {
    allGranted: blockers.length === 0,
    checks,
    blockers,
  };
}

export async function checkBeforeExecute(appName: string): Promise<{ ok: boolean; error?: string }> {
  const acc = await checkAccessibility();
  if (acc.status === "denied") {
    return { ok: false, error: acc.message };
  }

  const auto = await checkAutomation(appName);
  if (auto.status === "denied") {
    return { ok: false, error: auto.message };
  }

  return { ok: true };
}

export async function openPermissionSettings(type: PermissionType): Promise<void> {
  const panes: Record<PermissionType, string> = {
    accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
    automation: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation",
    screen_recording: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    full_disk_access: "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
  };
  await runShell("open", [panes[type]]);
}
