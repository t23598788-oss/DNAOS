/**
 * Mac Platform — จุดเริ่มต้นของ Platform Layer (macOS)
 * ส่ง action ไปยังส่วนย่อย (app-executor, accessibility, shortcuts, ฯลฯ)
 */

import * as appExec from "./app-executor";
import * as accessibility from "./accessibility";
import * as shortcuts from "./shortcuts";
import * as urlSchemes from "./url-schemes";
import * as windowExec from "./window-executor";
import { isLocalMac as _isLocalMac } from "@/lib/v6-executor/runtime/platform";
export { checkPermission, openSettings } from "./permissions";
export type { PermissionName } from "./permissions";

export type ActionName =
  | "open-app"
  | "close-app"
  | "is-running"
  | "wait-ready"
  | "click"
  | "type-text"
  | "press-key"
  | "scroll"
  | "read-window"
  | "run-shortcut"
  | "list-shortcuts"
  | "open-url"
  | "focus-window"
  | "list-windows"
  | "capture-screen"
  | "capture-window"
  | "ocr";

export interface ActionInfo {
  name: ActionName;
  description: string;
  params: string[];
}

const ACTION_REGISTRY: ActionInfo[] = [
  { name: "open-app",        description: "เปิดโปรแกรม",                    params: ["appName"] },
  { name: "close-app",       description: "ปิดโปรแกรม",                    params: ["appName"] },
  { name: "is-running",      description: "ตรวจสอบว่าโปรแกรมกำลังรันอยู่", params: ["appName"] },
  { name: "wait-ready",      description: "รอจนกว่าโปรแกรมจะพร้อม",        params: ["appName", "timeoutMs?"] },
  { name: "click",           description: "คลิกที่พิกัด x,y",              params: ["x", "y"] },
  { name: "type-text",       description: "พิมพ์ข้อความ",                  params: ["text"] },
  { name: "press-key",       description: "กดปุ่มคีย์บอร์ด",               params: ["key", "modifiers?"] },
  { name: "scroll",          description: "เลื่อนหน้าจอ",                  params: ["x", "y", "amount"] },
  { name: "read-window",     description: "อ่านรายการหน้าต่างของโปรแกรม",  params: ["appName"] },
  { name: "run-shortcut",    description: "รัน macOS Shortcut",            params: ["name", "input?"] },
  { name: "list-shortcuts",  description: "แสดง Shortcuts ทั้งหมด",        params: [] },
  { name: "open-url",        description: "เปิด URL หรือ URL scheme",      params: ["url"] },
  { name: "focus-window",    description: "โฟกัสหน้าต่างโปรแกรม",          params: ["appName"] },
  { name: "list-windows",    description: "แสดงหน้าต่างที่เปิดอยู่ทั้งหมด", params: [] },
  { name: "capture-screen",  description: "จับภาพหน้าจอ",                  params: ["outputPath?"] },
  { name: "capture-window",  description: "จับภาพหน้าต่างของโปรแกรม",     params: ["appName", "outputPath?"] },
  { name: "ocr",             description: "อ่านข้อความจากรูปภาพ",           params: ["imagePath"] },
];

export async function executeAction(name: ActionName, params: Record<string, any> = {}): Promise<any> {
  switch (name) {
    case "open-app":       return appExec.open(params.appName);
    case "close-app":      return appExec.close(params.appName);
    case "is-running":     return appExec.isRunning(params.appName);
    case "wait-ready":     return appExec.waitReady(params.appName, params.timeoutMs);
    case "click":          return accessibility.click(params.x, params.y);
    case "type-text":      return accessibility.typeText(params.text);
    case "press-key":      return accessibility.pressKey(params.key, params.modifiers);
    case "scroll":         return accessibility.scroll(params.x, params.y, params.amount);
    case "read-window":    return accessibility.readWindow(params.appName);
    case "run-shortcut":   return shortcuts.run(params.name, params.input);
    case "list-shortcuts": return shortcuts.list();
    case "open-url":       return urlSchemes.open(params.url);
    case "focus-window":   return windowExec.focus(params.appName);
    case "list-windows":   return windowExec.list();
    case "capture-screen": return windowExec.capture(params.outputPath);
    case "capture-window": return windowExec.captureWindow(params.appName, params.outputPath);
    case "ocr":            return windowExec.ocr(params.imagePath);
    default:               throw new Error(`mac-platform: unknown action "${name}"`);
  }
}

export async function executeActions(actions: Array<{ name: ActionName; params?: Record<string, any> }>): Promise<any[]> {
  return Promise.all(actions.map((a) => executeAction(a.name, a.params ?? {})));
}

export function listActions(): ActionInfo[] {
  return ACTION_REGISTRY;
}

export function getActionInfo(name: ActionName): ActionInfo | undefined {
  return ACTION_REGISTRY.find((a) => a.name === name);
}

export function isLocalMac(): boolean {
  return _isLocalMac();
}

