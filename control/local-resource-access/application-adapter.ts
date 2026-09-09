/**
 * APPLICATION_RESOURCE_V1 registry and adapter.
 * Installed-app discovery never grants invoke authority.
 * Actions are READ_STATE / OPEN_RESOURCE / EXPORT_RESULT / RUN_REGISTERED_ACTION only.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { emitLocalResourceEvent } from "./events";
import type { ApplicationResourceV1 } from "./types";

const APPS = new Map<string, ApplicationResourceV1>();

function texteditPlist(): string {
  const candidates = [
    "/System/Applications/TextEdit.app/Contents/Info.plist",
    "/Applications/TextEdit.app/Contents/Info.plist",
  ];
  return candidates.find((path) => existsSync(path)) ?? candidates[0]!;
}

function builtinTextEdit(): ApplicationResourceV1 {
  const plist = texteditPlist();
  return {
    schema: "APPLICATION_RESOURCE_V1",
    application_id: "app://macos/textedit",
    bundle_id: "com.apple.TextEdit",
    executable_identity: plist.replace("/Contents/Info.plist", ""),
    version: "registered",
    capabilities: ["local.app.list_registered", "local.app.invoke_registered_action", "local.app.discover_installed"],
    allowed_actions: [
      {
        action_id: "textedit.read_state",
        action_type: "READ_STATE",
        capability: "local.app.invoke_registered_action",
        input_schema: { type: "object", properties: {} },
        authority_required: "OWNER_GRANT",
      },
    ],
    data_scope: [plist],
    network_behavior: "LOCAL_ONLY",
    authority_required: "OWNER_GRANT",
    adapter: "control/local-resource-access/application-adapter.ts",
    availability: existsSync(plist) ? "AVAILABLE" : "UNAVAILABLE",
    usage_authorized: false,
    everyday_actions: ["READ"],
  };
}

export function mapEverydayApplicationAction(application_id: string, everyday_action: string): { ok: true; action_id: string } | { ok: false; reason_code: string } {
  ensureBuiltins();
  const app = APPS.get(application_id);
  if (!app) return { ok: false, reason_code: "UNKNOWN_APPLICATION" };
  if (!(app.everyday_actions as readonly string[]).includes(everyday_action)) {
    return { ok: false, reason_code: "EVERYDAY_ACTION_NOT_REGISTERED" };
  }
  if (everyday_action === "READ") {
    const read = app.allowed_actions.find((row) => row.action_type === "READ_STATE");
    if (!read) return { ok: false, reason_code: "EVERYDAY_ACTION_NOT_IMPLEMENTED" };
    return { ok: true, action_id: read.action_id };
  }
  return { ok: false, reason_code: "EVERYDAY_ACTION_NOT_IMPLEMENTED" };
}

function ensureBuiltins(): void {
  if (!APPS.has("app://macos/textedit")) {
    const app = builtinTextEdit();
    APPS.set(app.application_id, app);
  }
}

export function registerApplication(app: ApplicationResourceV1): ApplicationResourceV1 {
  ensureBuiltins();
  APPS.set(app.application_id, { ...app, usage_authorized: true });
  return APPS.get(app.application_id)!;
}

export function getRegisteredApplication(application_id: string): ApplicationResourceV1 | null {
  ensureBuiltins();
  return APPS.get(application_id) ?? null;
}

export function listRegisteredApplications(): readonly ApplicationResourceV1[] {
  ensureBuiltins();
  return [...APPS.values()];
}

function bundleIdFromPlist(plistPath: string): string | null {
  if (!existsSync(plistPath)) return null;
  const text = readFileSync(plistPath, "utf8");
  const match = text.match(/<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/);
  return match?.[1] ?? null;
}

export function discoverInstalledApplications(work_id: string | null, session_id: string): readonly Record<string, unknown>[] {
  ensureBuiltins();
  const roots = ["/Applications", "/System/Applications"];
  const found: Record<string, unknown>[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      if (!name.endsWith(".app")) continue;
      const plist = join(root, name, "Contents/Info.plist");
      const bundle_id = bundleIdFromPlist(plist);
      if (!bundle_id) continue;
      found.push({
        name,
        bundle_id,
        application_id: bundle_id === "com.apple.TextEdit" ? "app://macos/textedit" : `app://discovered/${bundle_id}`,
        version: readFileSync(plist, "utf8").match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/)?.[1] ?? null,
        discovered: true,
        usage_authorized: false,
        registered: [...APPS.values()].some((app) => app.bundle_id === bundle_id && app.usage_authorized),
        known_adapter: bundle_id === "com.apple.TextEdit",
        supported_canonical_actions: bundle_id === "com.apple.TextEdit" ? ["READ"] : [],
        verification_status: bundle_id === "com.apple.TextEdit" ? "RUNTIME_VERIFIED" : "DECLARED",
        authority_status: "DENY",
      });
      emitLocalResourceEvent("APPLICATION_DISCOVERED", work_id, bundle_id, undefined, {
        session_id, resource_id: "resource://local/app/registry", authority_decision: "DENY", locality: "LOCAL",
      });
      if (found.length >= 30) return found;
    }
  }
  return found;
}

export function invokeRegisteredApplicationAction(input: {
  readonly application_id: string;
  readonly action_id: string;
  readonly work_id: string;
  readonly session_id: string;
}): { ok: boolean; reason_code: string; result: Record<string, unknown> } {
  ensureBuiltins();
  emitLocalResourceEvent("APPLICATION_ACTION_REQUESTED", input.work_id, input.action_id, undefined, {
    session_id: input.session_id, resource_id: "resource://local/app/textedit", locality: "LOCAL",
  });
  const app = APPS.get(input.application_id);
  if (!app) {
    emitLocalResourceEvent("APPLICATION_ACTION_DENIED", input.work_id, "UNKNOWN_APPLICATION", undefined, {
      session_id: input.session_id, authority_decision: "DENY", locality: "LOCAL",
    });
    return { ok: false, reason_code: "UNKNOWN_APPLICATION", result: {} };
  }
  const action = app.allowed_actions.find((row) => row.action_id === input.action_id);
  if (!action) {
    emitLocalResourceEvent("APPLICATION_ACTION_DENIED", input.work_id, "UNKNOWN_ACTION", undefined, {
      session_id: input.session_id, authority_decision: "DENY", locality: "LOCAL",
    });
    return { ok: false, reason_code: "UNKNOWN_ACTION", result: {} };
  }
  if (action.action_type === "READ_STATE") {
    const plist = app.data_scope[0];
    if (!plist || !existsSync(plist)) return { ok: false, reason_code: "APPLICATION_UNAVAILABLE", result: {} };
    const text = readFileSync(plist, "utf8");
    const version = text.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/)?.[1] ?? "unknown";
    emitLocalResourceEvent("APPLICATION_ACTION_ALLOWED", input.work_id, input.action_id, undefined, {
      session_id: input.session_id, resource_id: "resource://local/app/textedit", authority_decision: "ALLOW", locality: "LOCAL",
    });
    return {
      ok: true,
      reason_code: "READ_STATE",
      result: { application_id: app.application_id, bundle_id: app.bundle_id, version, action_type: "READ_STATE", locality: "LOCAL" },
    };
  }
  emitLocalResourceEvent("APPLICATION_ACTION_DENIED", input.work_id, "ACTION_TYPE_NOT_IMPLEMENTED", undefined, {
    session_id: input.session_id, authority_decision: "DENY", locality: "LOCAL",
  });
  return { ok: false, reason_code: "ACTION_TYPE_NOT_IMPLEMENTED", result: {} };
}
