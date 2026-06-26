/**
 * App Controller Registry
 *
 * ระบบ pluggable — เพิ่มแอปใหม่ไม่ต้องแก้ V6
 * แต่ละแอปลงทะเบียน actions ของตัวเอง
 */

import { ActionResult, AppController } from "./types";

const registry = new Map<string, AppController>();

export function registerApp(controller: AppController): void {
  registry.set(controller.appName.toLowerCase(), controller);
}

export function getAppController(appName: string): AppController | undefined {
  return registry.get(appName.toLowerCase());
}

export function listRegisteredApps(): string[] {
  return Array.from(registry.keys());
}

export function listAppActions(appName: string): string[] {
  const ctrl = registry.get(appName.toLowerCase());
  if (!ctrl) return [];
  return Object.keys(ctrl.actions);
}

export async function executeAppAction(
  appName: string,
  actionName: string,
  args: Record<string, unknown> = {}
): Promise<ActionResult> {
  const start = Date.now();
  const ctrl = registry.get(appName.toLowerCase());

  if (!ctrl) {
    return {
      status: "failed",
      action: `app.${appName}.${actionName}`,
      durationMs: Date.now() - start,
      error: `ไม่พบ App Controller: ${appName} — ลงทะเบียนก่อนใช้`,
    };
  }

  const handler = ctrl.actions[actionName];
  if (!handler) {
    return {
      status: "failed",
      action: `app.${appName}.${actionName}`,
      durationMs: Date.now() - start,
      error: `${appName} ไม่มี action: ${actionName} — มี: ${Object.keys(ctrl.actions).join(", ")}`,
    };
  }

  return handler(args);
}
