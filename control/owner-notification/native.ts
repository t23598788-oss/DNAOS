/**
 * MACOS_NATIVE_NOTIFICATION_DELIVERY_V1 — UNUserNotificationCenter only.
 * Read settings never requests authorization. Request happens only on Owner enable.
 */

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { NativePermissionState } from "./types";

const HELPER = join(process.cwd(), "control/owner-notification/native/owner-notify.app/Contents/MacOS/owner-notify");

export interface NativeNotificationPort {
  readonly readPermission: () => { state: NativePermissionState; helper_present: boolean; error_code: string | null };
  readonly requestAuthorization: () => { state: NativePermissionState; error_code: string | null };
  readonly schedule: (input: {
    readonly identifier: string;
    readonly title: string;
    readonly body: string;
    readonly category: string;
    readonly thread: string;
    readonly userInfo: Record<string, string>;
  }) => { result: "DELIVERY_ACCEPTED_BY_OS" | "DELIVERY_FAILED"; error_code: string | null };
}

let PORT: NativeNotificationPort | null = null;

export function setNativeNotificationPort(port: NativeNotificationPort | null): void {
  PORT = port;
}

function runHelper(args: readonly string[], stdin = ""): { ok: boolean; json: Record<string, unknown>; error: string | null } {
  if (!existsSync(HELPER)) return { ok: false, json: {}, error: "HELPER_NOT_BUILT" };
  const spawned = spawnSync(HELPER, [...args], {
    input: stdin,
    encoding: "utf8",
    timeout: 8000,
  });
  const text = `${spawned.stdout ?? ""}${spawned.stderr ?? ""}`.trim();
  try {
    const json = JSON.parse(text.split("\n").filter((line) => line.startsWith("{")).at(-1) ?? text) as Record<string, unknown>;
    return { ok: spawned.status === 0, json, error: typeof json.error_code === "string" ? json.error_code : null };
  } catch {
    return { ok: false, json: {}, error: spawned.error?.message ?? "PARSE_ERROR" };
  }
}

export const productionNativeNotificationPort: NativeNotificationPort = {
  readPermission: () => {
    if (!existsSync(HELPER)) return { state: "NOT_AVAILABLE", helper_present: false, error_code: "HELPER_NOT_BUILT" };
    const row = runHelper(["read"]);
    const state = String(row.json.state ?? "ERROR") as NativePermissionState;
    return { state, helper_present: true, error_code: row.error };
  },
  requestAuthorization: () => {
    const row = runHelper(["request"]);
    return { state: String(row.json.state ?? "ERROR") as NativePermissionState, error_code: row.error };
  },
  schedule: (input) => {
    const row = runHelper(["schedule"], JSON.stringify({
      identifier: input.identifier,
      title: input.title,
      body: input.body,
      category: input.category,
      thread: input.thread,
      userInfo: input.userInfo,
    }));
    if (row.ok && String(row.json.result) === "DELIVERY_ACCEPTED_BY_OS") {
      return { result: "DELIVERY_ACCEPTED_BY_OS", error_code: null };
    }
    return { result: "DELIVERY_FAILED", error_code: row.error ?? "SCHEDULE_FAILED" };
  },
};

export function nativeNotificationPort(): NativeNotificationPort {
  return PORT ?? productionNativeNotificationPort;
}

export function helperPath(): string {
  return HELPER;
}
