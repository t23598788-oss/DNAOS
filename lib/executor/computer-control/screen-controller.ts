/**
 * Screen Controller
 *
 * อ่านสถานะหน้าจอ หน้าต่าง แอป จับภาพหน้าจอ
 * รอจนกว่าหน้าต่างจะเปิด หรือ UI เปลี่ยน
 */

import { ActionResult, ScreenAction, WindowInfo } from "./types";
import { runAppleScript, escapeAppleScript, runShell } from "./osascript";

export async function executeScreen(action: ScreenAction): Promise<ActionResult> {
  const start = Date.now();

  try {
    switch (action.command) {
      case "read_window_list": {
        const windows = await getWindowList();
        return ok(action, start, { windows, count: windows.length });
      }

      case "read_active_window": {
        const active = await getActiveWindow();
        return ok(action, start, active);
      }

      case "capture_screenshot": {
        const path = action.savePath ?? `/tmp/dna-screenshot-${Date.now()}.png`;
        await captureScreenshot(path);
        return ok(action, start, { path });
      }

      case "read_window_title": {
        if (!action.app) return fail(action, start, "ต้องระบุ app");
        const title = await getWindowTitle(action.app);
        return ok(action, start, { app: action.app, title });
      }

      case "read_app_state": {
        if (!action.app) return fail(action, start, "ต้องระบุ app");
        const state = await getAppState(action.app);
        return ok(action, start, state);
      }

      case "wait_window_exists": {
        if (!action.windowName) return fail(action, start, "ต้องระบุ windowName");
        const timeout = action.timeoutMs ?? 10_000;
        const found = await waitForWindow(action.windowName, timeout);
        if (found) return ok(action, start, { found: action.windowName });
        return fail(action, start, `หน้าต่าง "${action.windowName}" ไม่เปิดภายใน ${timeout}ms`);
      }

      case "wait_ui_change": {
        const timeout = action.timeoutMs ?? 5_000;
        const changed = await waitForUIChange(action.app, timeout);
        if (changed) return ok(action, start, { uiChanged: true });
        return fail(action, start, `UI ไม่เปลี่ยนภายใน ${timeout}ms`);
      }

      default:
        return fail(action, start, `ไม่รองรับ screen command: ${action.command}`);
    }
  } catch (e) {
    return fail(action, start, (e as Error).message);
  }
}

export async function getWindowList(): Promise<WindowInfo[]> {
  const raw = await runAppleScript(`
    set output to ""
    tell application "System Events"
      set procs to every process whose background only is false
      repeat with p in procs
        set appName to name of p
        set wins to every window of p
        repeat with i from 1 to count of wins
          set w to item i of wins
          set wTitle to name of w
          set output to output & appName & ":::" & wTitle & ":::" & i & "|||"
        end repeat
      end repeat
    end tell
    return output
  `);

  if (!raw) return [];

  return raw
    .split("|||")
    .filter(Boolean)
    .map((entry) => {
      const [app, title, index] = entry.split(":::");
      return { app, title: title ?? "", index: parseInt(index ?? "1", 10) };
    });
}

export async function getActiveWindow(): Promise<{ app: string; title: string }> {
  const app = await runAppleScript(`
    tell application "System Events"
      return name of first process whose frontmost is true
    end tell
  `);

  let title = "";
  try {
    title = await runAppleScript(`
      tell application "System Events"
        tell process "${escapeAppleScript(app)}"
          return name of window 1
        end tell
      end tell
    `);
  } catch {
    // some apps don't expose window title
  }

  return { app, title };
}

async function captureScreenshot(path: string): Promise<void> {
  await runShell("screencapture", ["-x", path]);
}

async function getWindowTitle(appName: string): Promise<string> {
  return runAppleScript(`
    tell application "System Events"
      tell process "${escapeAppleScript(appName)}"
        if (count of windows) > 0 then
          return name of window 1
        else
          return "ไม่มีหน้าต่าง"
        end if
      end tell
    end tell
  `);
}

async function getAppState(appName: string): Promise<Record<string, unknown>> {
  const running = await runAppleScript(`
    tell application "System Events"
      return (name of every process) contains "${escapeAppleScript(appName)}"
    end tell
  `);

  if (running !== "true") {
    return { app: appName, running: false, frontmost: false, windows: 0 };
  }

  const info = await runAppleScript(`
    tell application "System Events"
      tell process "${escapeAppleScript(appName)}"
        set isFront to frontmost
        set winCount to count of windows
        return (isFront as text) & ":::" & (winCount as text)
      end tell
    end tell
  `);

  const [frontmost, windowCount] = info.split(":::");
  return {
    app: appName,
    running: true,
    frontmost: frontmost === "true",
    windows: parseInt(windowCount ?? "0", 10),
  };
}

async function waitForWindow(
  windowName: string,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const escaped = escapeAppleScript(windowName);

  while (Date.now() < deadline) {
    const found = await runAppleScript(`
      tell application "System Events"
        set allWindows to name of every window of every process whose background only is false
        set flat to {}
        repeat with wList in allWindows
          set flat to flat & wList
        end repeat
        if flat contains "${escaped}" then
          return "true"
        else
          return "false"
        end if
      end tell
    `);
    if (found === "true") return true;
    await sleep(500);
  }
  return false;
}

async function waitForUIChange(
  appName: string | undefined,
  timeoutMs: number
): Promise<boolean> {
  const before = appName ? await getWindowTitle(appName) : (await getActiveWindow()).title;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await sleep(300);
    const after = appName ? await getWindowTitle(appName) : (await getActiveWindow()).title;
    if (after !== before) return true;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function ok(action: ScreenAction, start: number, result: unknown): ActionResult {
  return {
    status: "success",
    action: `screen.${action.command}`,
    target: action.app,
    durationMs: Date.now() - start,
    result,
  };
}

function fail(action: ScreenAction, start: number, error: string): ActionResult {
  return {
    status: "failed",
    action: `screen.${action.command}`,
    target: action.app,
    durationMs: Date.now() - start,
    error,
  };
}
