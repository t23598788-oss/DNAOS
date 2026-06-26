/**
 * Execution Engine
 *
 * แปลง ComputerAction → เรียก Controller ที่ถูกต้อง
 * ทุกขั้นตอน observable — ส่ง ActionResult กลับเสมอ
 *
 * Human Command → Capability → Computer Actions → OS Events → App Result
 */

import { ComputerAction, ActionResult } from "./types";
import { executeDevice } from "./device-controller";
import { executeKeyboard } from "./keyboard-controller";
import { executeMouse } from "./mouse-controller";
import { executeScreen } from "./screen-controller";
import { executeClipboard } from "./clipboard-controller";
import { isLocalMac } from "./osascript";

export async function executeAction(action: ComputerAction): Promise<ActionResult> {
  if (!isLocalMac()) {
    return {
      status: "failed",
      action: action.type,
      durationMs: 0,
      error: "Computer Control ทำงานได้เฉพาะ macOS local เท่านั้น — ไม่รองรับบน Vercel",
    };
  }

  switch (action.type) {
    case "device":
      return executeDevice(action);
    case "keyboard":
      return executeKeyboard(action);
    case "mouse":
      return executeMouse(action);
    case "screen":
      return executeScreen(action);
    case "clipboard":
      return executeClipboard(action);
    default:
      return {
        status: "failed",
        action: "unknown",
        durationMs: 0,
        error: `ไม่รู้จัก action type: ${(action as ComputerAction).type}`,
      };
  }
}

export async function executeActions(
  actions: ComputerAction[]
): Promise<ActionResult[]> {
  const results: ActionResult[] = [];
  for (const action of actions) {
    const result = await executeAction(action);
    results.push(result);
    if (result.status === "failed") break;
  }
  return results;
}
