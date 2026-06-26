/**
 * DNA OS V6 — Computer Control Layer
 *
 * Human → DNA Command → Computer Actions → macOS → Application
 *
 * ไม่ใช่ AI — เป็นมือที่จับเมาส์จับคีย์บอร์ดสั่ง macOS แทนมนุษย์
 * ทำงานได้เฉพาะ local macOS เท่านั้น
 */

// Core helpers
export { isLocalMac, runAppleScript, runJxa, runShell } from "./osascript";

// Types
export type {
  ActionResult,
  ActionStatus,
  ComputerAction,
  DeviceAction,
  KeyboardAction,
  MouseAction,
  ScreenAction,
  ClipboardAction,
  MacModifier,
  QueuedAction,
  ExecutionMode,
  ExecutionStep,
  ExecutionPlan,
  AppController,
  WindowInfo,
} from "./types";

// Controllers
export { executeDevice, listRunningApps, isAppRunning } from "./device-controller";
export { executeKeyboard } from "./keyboard-controller";
export { executeMouse } from "./mouse-controller";
export { executeScreen, getWindowList, getActiveWindow } from "./screen-controller";
export { executeClipboard, getClipboard, setClipboard } from "./clipboard-controller";

// Execution
export { executeAction, executeActions } from "./execution-engine";
export {
  executePlan,
  cancelExecution,
  getActivePlan,
  createPlan,
  sequentialStep,
  parallelStep,
  conditionalStep,
} from "./execution-queue";

// App Registry
export {
  registerApp,
  getAppController,
  listRegisteredApps,
  listAppActions,
  executeAppAction,
} from "./app-registry";

// App Controllers — ลงทะเบียนอัตโนมัติ
import { registerApp } from "./app-registry";
import { lineController } from "./apps/line";
import { chromeController } from "./apps/chrome";
import { googleMapsController } from "./apps/google-maps";
import { googleEarthController } from "./apps/google-earth";
import { vscodeController } from "./apps/vscode";
import { finderController } from "./apps/finder";
import { terminalController } from "./apps/terminal";
import { githubDesktopController } from "./apps/github-desktop";
import { pdfViewerController } from "./apps/pdf-viewer";
import { mailController } from "./apps/mail";
import { calendarController } from "./apps/calendar";

const builtInApps = [
  lineController,
  chromeController,
  googleMapsController,
  googleEarthController,
  vscodeController,
  finderController,
  terminalController,
  githubDesktopController,
  pdfViewerController,
  mailController,
  calendarController,
];

for (const app of builtInApps) {
  registerApp(app);
}
