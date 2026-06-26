/**
 * Device Controller
 *
 * สั่ง macOS เปิด/ปิด/สลับ/ย่อ/ขยาย แอปพลิเคชัน
 * ใช้ AppleScript + System Events
 */

import { ActionResult, DeviceAction } from "./types";
import { runAppleScript, escapeAppleScript } from "./osascript";

export async function executeDevice(action: DeviceAction): Promise<ActionResult> {
  const start = Date.now();
  const app = escapeAppleScript(action.app);

  try {
    switch (action.command) {
      case "launch":
      case "activate": {
        await runAppleScript(`tell application "${app}" to activate`);
        return ok(action, start, { launched: app });
      }

      case "close": {
        await runAppleScript(`tell application "${app}" to quit`);
        return ok(action, start, { closed: app });
      }

      case "focus_window": {
        const idx = action.windowIndex ?? 1;
        await runAppleScript(`
          tell application "System Events"
            tell process "${app}"
              set frontmost to true
              perform action "AXRaise" of window ${idx}
            end tell
          end tell
        `);
        return ok(action, start, { focused: app, window: idx });
      }

      case "switch_window": {
        await runAppleScript(`
          tell application "System Events"
            tell process "${app}"
              set frontmost to true
              if (count of windows) > 1 then
                perform action "AXRaise" of window 2
              end if
            end tell
          end tell
        `);
        return ok(action, start, { switched: app });
      }

      case "minimize": {
        const idx = action.windowIndex ?? 1;
        await runAppleScript(`
          tell application "System Events"
            tell process "${app}"
              set value of attribute "AXMinimized" of window ${idx} to true
            end tell
          end tell
        `);
        return ok(action, start, { minimized: app, window: idx });
      }

      case "maximize": {
        await runAppleScript(`
          tell application "System Events"
            tell process "${app}"
              set frontmost to true
              set {screenW, screenH} to {1920, 1080}
              try
                set screenW to word 3 of (do shell script "system_profiler SPDisplaysDataType | grep Resolution | head -1")
                set screenH to word 5 of (do shell script "system_profiler SPDisplaysDataType | grep Resolution | head -1")
              end try
              set position of window 1 to {0, 25}
              set size of window 1 to {screenW, screenH - 25}
            end tell
          end tell
        `);
        return ok(action, start, { maximized: app });
      }

      default:
        return fail(action, start, `ไม่รองรับ device command: ${action.command}`);
    }
  } catch (e) {
    return fail(action, start, (e as Error).message);
  }
}

export async function listRunningApps(): Promise<string[]> {
  const raw = await runAppleScript(`
    tell application "System Events"
      set appNames to name of every process whose background only is false
      set AppleScript's text item delimiters to "|||"
      return appNames as text
    end tell
  `);
  return raw.split("|||").map((s) => s.trim()).filter(Boolean);
}

export async function isAppRunning(appName: string): Promise<boolean> {
  const result = await runAppleScript(`
    tell application "System Events"
      return (name of every process) contains "${escapeAppleScript(appName)}"
    end tell
  `);
  return result === "true";
}

function ok(action: DeviceAction, start: number, result: unknown): ActionResult {
  return {
    status: "success",
    action: `device.${action.command}`,
    target: action.app,
    durationMs: Date.now() - start,
    result,
  };
}

function fail(action: DeviceAction, start: number, error: string): ActionResult {
  return {
    status: "failed",
    action: `device.${action.command}`,
    target: action.app,
    durationMs: Date.now() - start,
    error,
  };
}
