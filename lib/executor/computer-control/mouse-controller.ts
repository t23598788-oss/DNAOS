/**
 * Mouse Controller
 *
 * สั่งเมาส์ คลิก ลาก เลื่อน ผ่าน macOS Automation
 * ใช้ AppleScript + cliclick (ถ้ามี) เป็น fallback
 */

import { ActionResult, MouseAction } from "./types";
import { runJxa, runShell } from "./osascript";

export async function executeMouse(action: MouseAction): Promise<ActionResult> {
  const start = Date.now();

  try {
    switch (action.command) {
      case "move": {
        if (action.x == null || action.y == null) return fail(action, start, "ต้องระบุ x, y");
        await mouseMove(action.x, action.y);
        return ok(action, start, { moved: { x: action.x, y: action.y } });
      }

      case "click": {
        if (action.x == null || action.y == null) return fail(action, start, "ต้องระบุ x, y");
        await mouseClick(action.x, action.y);
        return ok(action, start, { clicked: { x: action.x, y: action.y } });
      }

      case "double_click": {
        if (action.x == null || action.y == null) return fail(action, start, "ต้องระบุ x, y");
        await mouseDoubleClick(action.x, action.y);
        return ok(action, start, { doubleClicked: { x: action.x, y: action.y } });
      }

      case "right_click": {
        if (action.x == null || action.y == null) return fail(action, start, "ต้องระบุ x, y");
        await mouseRightClick(action.x, action.y);
        return ok(action, start, { rightClicked: { x: action.x, y: action.y } });
      }

      case "drag": {
        if (action.x == null || action.y == null || action.toX == null || action.toY == null)
          return fail(action, start, "ต้องระบุ x, y, toX, toY");
        await mouseDrag(action.x, action.y, action.toX, action.toY);
        return ok(action, start, { dragged: { from: { x: action.x, y: action.y }, to: { x: action.toX, y: action.toY } } });
      }

      case "drop": {
        return ok(action, start, { dropped: true });
      }

      case "scroll": {
        const dir = action.scrollDirection ?? "down";
        const amount = action.scrollAmount ?? 3;
        await mouseScroll(dir, amount);
        return ok(action, start, { scrolled: { direction: dir, amount } });
      }

      case "hover": {
        if (action.x == null || action.y == null) return fail(action, start, "ต้องระบุ x, y");
        await mouseMove(action.x, action.y);
        return ok(action, start, { hovering: { x: action.x, y: action.y } });
      }

      default:
        return fail(action, start, `ไม่รองรับ mouse command: ${action.command}`);
    }
  } catch (e) {
    return fail(action, start, (e as Error).message);
  }
}

async function mouseMove(x: number, y: number): Promise<void> {
  if (await hasCliClick()) {
    await runShell("cliclick", ["m:" + x + "," + y]);
    return;
  }
  await runJxa(`
    ObjC.import('CoreGraphics');
    var point = $.CGPointMake(${x}, ${y});
    var event = $.CGEventCreateMouseEvent(null, $.kCGEventMouseMoved, point, $.kCGMouseButtonLeft);
    $.CGEventPost($.kCGHIDEventTap, event);
  `);
}

async function mouseClick(x: number, y: number): Promise<void> {
  if (await hasCliClick()) {
    await runShell("cliclick", ["c:" + x + "," + y]);
    return;
  }
  await runJxa(`
    ObjC.import('CoreGraphics');
    var point = $.CGPointMake(${x}, ${y});
    var down = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseDown, point, $.kCGMouseButtonLeft);
    var up = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseUp, point, $.kCGMouseButtonLeft);
    $.CGEventPost($.kCGHIDEventTap, down);
    $.CGEventPost($.kCGHIDEventTap, up);
  `);
}

async function mouseDoubleClick(x: number, y: number): Promise<void> {
  if (await hasCliClick()) {
    await runShell("cliclick", ["dc:" + x + "," + y]);
    return;
  }
  await runJxa(`
    ObjC.import('CoreGraphics');
    var point = $.CGPointMake(${x}, ${y});
    var down1 = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseDown, point, $.kCGMouseButtonLeft);
    $.CGEventSetIntegerValueField(down1, $.kCGMouseEventClickState, 1);
    var up1 = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseUp, point, $.kCGMouseButtonLeft);
    $.CGEventSetIntegerValueField(up1, $.kCGMouseEventClickState, 1);
    var down2 = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseDown, point, $.kCGMouseButtonLeft);
    $.CGEventSetIntegerValueField(down2, $.kCGMouseEventClickState, 2);
    var up2 = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseUp, point, $.kCGMouseButtonLeft);
    $.CGEventSetIntegerValueField(up2, $.kCGMouseEventClickState, 2);
    $.CGEventPost($.kCGHIDEventTap, down1);
    $.CGEventPost($.kCGHIDEventTap, up1);
    $.CGEventPost($.kCGHIDEventTap, down2);
    $.CGEventPost($.kCGHIDEventTap, up2);
  `);
}

async function mouseRightClick(x: number, y: number): Promise<void> {
  if (await hasCliClick()) {
    await runShell("cliclick", ["rc:" + x + "," + y]);
    return;
  }
  await runJxa(`
    ObjC.import('CoreGraphics');
    var point = $.CGPointMake(${x}, ${y});
    var down = $.CGEventCreateMouseEvent(null, $.kCGEventRightMouseDown, point, $.kCGMouseButtonRight);
    var up = $.CGEventCreateMouseEvent(null, $.kCGEventRightMouseUp, point, $.kCGMouseButtonRight);
    $.CGEventPost($.kCGHIDEventTap, down);
    $.CGEventPost($.kCGHIDEventTap, up);
  `);
}

async function mouseDrag(fromX: number, fromY: number, toX: number, toY: number): Promise<void> {
  if (await hasCliClick()) {
    await runShell("cliclick", ["dd:" + fromX + "," + fromY, "du:" + toX + "," + toY]);
    return;
  }
  await runJxa(`
    ObjC.import('CoreGraphics');
    var from = $.CGPointMake(${fromX}, ${fromY});
    var to = $.CGPointMake(${toX}, ${toY});
    var down = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseDown, from, $.kCGMouseButtonLeft);
    var drag = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseDragged, to, $.kCGMouseButtonLeft);
    var up = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseUp, to, $.kCGMouseButtonLeft);
    $.CGEventPost($.kCGHIDEventTap, down);
    $.CGEventPost($.kCGHIDEventTap, drag);
    $.CGEventPost($.kCGHIDEventTap, up);
  `);
}

async function mouseScroll(direction: string, amount: number): Promise<void> {
  const dy = direction === "up" ? amount : direction === "down" ? -amount : 0;
  const dx = direction === "left" ? amount : direction === "right" ? -amount : 0;

  if (await hasCliClick()) {
    if (dy !== 0) await runShell("cliclick", ["sc:" + dy]);
    return;
  }
  await runJxa(`
    ObjC.import('CoreGraphics');
    var event = $.CGEventCreateScrollWheelEvent(null, $.kCGScrollEventUnitLine, 2, ${dy}, ${dx});
    $.CGEventPost($.kCGHIDEventTap, event);
  `);
}

let _hasCliClick: boolean | null = null;
async function hasCliClick(): Promise<boolean> {
  if (_hasCliClick !== null) return _hasCliClick;
  try {
    await runShell("which", ["cliclick"]);
    _hasCliClick = true;
  } catch {
    _hasCliClick = false;
  }
  return _hasCliClick;
}

function ok(action: MouseAction, start: number, result: unknown): ActionResult {
  return {
    status: "success",
    action: `mouse.${action.command}`,
    durationMs: Date.now() - start,
    result,
  };
}

function fail(action: MouseAction, start: number, error: string): ActionResult {
  return {
    status: "failed",
    action: `mouse.${action.command}`,
    durationMs: Date.now() - start,
    error,
  };
}
