/**
 * macOS Platform Layer — Entry Point
 *
 * Command → Workflow → Action → macOS Platform Layer → macOS
 *
 * Route Action → Executor → macOS API
 * ทุก Action คืน { ok, data?, error?, reason? }
 */

import type { MacResult } from "./applescript";
import * as app from "./app-executor";
import * as win from "./window-executor";
import * as acc from "./accessibility";
import * as shortcut from "./shortcuts";
import * as url from "./url-schemes";
import * as script from "./applescript";
import { checkPermission, type PermissionName } from "./permissions";
import capabilities from "./capabilities.json";

type ActionDef = { executor: string; method: string; permission: string | null };
const actionMap = capabilities.actions as Record<string, ActionDef>;

export async function executeAction(
  action: string,
  params: Record<string, string> = {}
): Promise<MacResult> {
  const def = actionMap[action];
  if (!def) return { ok: false, error: `Unknown action: ${action}`, reason: "ไม่อยู่ใน capabilities.json" };

  // ตรวจสิทธิ์
  if (def.permission) {
    const perm = await checkPermission(def.permission as PermissionName, params.app ?? params.target);
    if (!perm.ok) return perm;
  }

  // Route ไปยัง Executor
  switch (def.executor) {
    case "app":
      if (def.method === "open") return app.open(params.target ?? params.app ?? "");
      if (def.method === "close") return app.close(params.target ?? params.app ?? "");
      break;

    case "window":
      if (def.method === "focus") return win.focus(params.target ?? params.app ?? "");
      if (def.method === "list") return win.list();
      if (def.method === "capture") return win.captureWindow(params.target ?? params.app ?? "", params.savePath);
      if (def.method === "ocr") return win.ocr(params.imagePath ?? "");
      break;

    case "accessibility":
      if (def.method === "click") return acc.click(params.target ?? "", params.app);
      if (def.method === "typeText") return acc.typeText(params.text ?? "");
      if (def.method === "pressKey") return acc.pressKey(params.key ?? "");
      if (def.method === "scroll") return acc.scroll((params.direction ?? "down") as "up" | "down", parseInt(params.amount ?? "3"));
      if (def.method === "readWindow") return acc.readWindow(params.app);
      break;

    case "shortcuts":
      if (def.method === "run") return shortcut.run(params.name ?? "", params.input);
      break;

    case "urlScheme":
      if (def.method === "open") return url.open(params.url ?? "");
      break;

    case "applescript":
      if (def.method === "run") return script.runScript(params.script ?? "");
      break;
  }

  return { ok: false, error: `No handler for ${action}/${def.method}`, reason: "Executor/method mismatch" };
}

export async function executeActions(
  actions: { action: string; params?: Record<string, string> }[]
): Promise<{ ok: boolean; results: MacResult[] }> {
  const results: MacResult[] = [];
  for (const a of actions) {
    const r = await executeAction(a.action, a.params ?? {});
    results.push(r);
    if (!r.ok) return { ok: false, results };
  }
  return { ok: true, results };
}

export function listActions(): string[] {
  return Object.keys(actionMap);
}

export function getActionInfo(action: string): ActionDef | null {
  return actionMap[action] ?? null;
}

export function isLocalMac(): boolean {
  return typeof process !== "undefined" && process.platform === "darwin";
}
