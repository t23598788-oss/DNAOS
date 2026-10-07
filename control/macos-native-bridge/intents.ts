import { existsSync, readFileSync } from "node:fs";
import { getRegisteredApplication } from "../local-resource-access/contract";
import type { DiscoveredIntentV1 } from "./types";

function plistStrings(text: string, key: string): readonly string[] {
  const block = text.split(`<key>${key}</key>`)[1];
  if (!block) return [];
  const array = block.split("</array>")[0] ?? "";
  return [...array.matchAll(/<string>([^<]+)<\/string>/g)].map((row) => row[1]!).filter(Boolean);
}

export function discoverAppIntents(): readonly DiscoveredIntentV1[] {
  const app = getRegisteredApplication("app://macos/textedit");
  const plist = app?.data_scope[0] ?? "";
  if (!plist || !existsSync(plist)) return [];
  const text = readFileSync(plist, "utf8");
  const ids = plistStrings(text, "INIntentsSupported");
  return ids.map((intent_id) => ({
    application_id: "app://macos/textedit",
    intent_id,
    intent_title: intent_id,
    parameters: [],
    input_schema: { type: "object" },
    output_schema: { type: "object" },
    side_effects: "UNKNOWN",
    foreground_required: true,
    owner_authority_state: "DENY" as const,
    grants_execution_permission: false as const,
  }));
}

export function discoverAppShortcuts(): readonly DiscoveredIntentV1[] {
  const app = getRegisteredApplication("app://macos/textedit");
  const plist = app?.data_scope[0] ?? "";
  if (!plist || !existsSync(plist)) return [];
  const text = readFileSync(plist, "utf8");
  const ids = [...plistStrings(text, "AppShortcuts"), ...plistStrings(text, "WFWorkflows")];
  return ids.map((intent_id) => ({
    application_id: "app://macos/textedit",
    intent_id,
    intent_title: intent_id,
    parameters: [],
    input_schema: { type: "object" },
    output_schema: { type: "object" },
    side_effects: "UNKNOWN",
    foreground_required: true,
    owner_authority_state: "DENY" as const,
    grants_execution_permission: false as const,
  }));
}
