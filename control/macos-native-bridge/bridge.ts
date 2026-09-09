import { existsSync, readFileSync } from "node:fs";
import { hostname, release, type } from "node:os";
import { getRegisteredApplication, matchingCapabilityBindingPolicy } from "../local-resource-access/contract";
import { isDarwin } from "./host-runtime";
import { persistBridgeSnapshot, listBridgeSnapshots } from "./persist";
import type { MacosNativeBridgeV1, NativeInterfaceType } from "./types";

function ownerEnabled(ai_identity: string, session_id: string): boolean {
  const policy = matchingCapabilityBindingPolicy(ai_identity, session_id);
  if (!policy) return false;
  return policy.enabled_binding_ids.includes("macos://bridge/this-machine")
    || policy.enabled_binding_ids.includes("app://macos/textedit")
    || policy.enabled_binding_ids.includes("*");
}

function macosVersion(): string {
  if (!isDarwin()) return type();
  return release();
}

function row(partial: Omit<MacosNativeBridgeV1, "schema" | "grants_authority" | "evidence_policy" | "authority_required" | "machine_id" | "macos_version">): MacosNativeBridgeV1 {
  return {
    schema: "MACOS_NATIVE_CONTROL_BRIDGE_V1",
    machine_id: `machine://macos/${hostname()}`,
    macos_version: macosVersion(),
    authority_required: "OWNER_GRANT",
    evidence_policy: "LOCAL_EXECUTION_ENVELOPE",
    grants_authority: false,
    ...partial,
  };
}

export function refreshMacosBridge(work_id: string, session_id: string, ai_identity: string): readonly MacosNativeBridgeV1[] {
  const enabled = ownerEnabled(ai_identity, session_id);
  const ls = existsSync("/usr/bin/open") && existsSync("/System/Library/Frameworks/CoreServices.framework");
  const textedit = getRegisteredApplication("app://macos/textedit");
  const plist = textedit?.data_scope[0] ?? "";
  const plistText = plist && existsSync(plist) ? readFileSync(plist, "utf8") : "";
  const hasIntent = plistText.includes("INIntentsSupported") || plistText.includes("NSUserActivityTypes");
  const hasShortcut = plistText.includes("AppShortcuts") || plistText.includes("WFWorkflows");
  const esFramework = existsSync("/System/Library/Frameworks/EndpointSecurity.framework");
  const rows: MacosNativeBridgeV1[] = [
    row({
      bridge_id: "bridge://macos/app-intents",
      interface_type: "APP_INTENTS",
      native_identity: "Info.plist INIntentsSupported",
      capabilities_declared: hasIntent ? ["OPEN"] : [],
      capabilities_verified: [],
      tcc_requirement: "NONE",
      entitlement_requirement: "NONE",
      execution_scope: [],
      observation_scope: ["APPLICATION_LAUNCH"],
      side_effect_class: "NONE",
      availability: hasIntent ? "INTERFACE_FOUND" : "DISCOVERED",
      runtime_verified: false,
      owner_enabled: false,
    }),
    row({
      bridge_id: "bridge://macos/app-shortcuts",
      interface_type: "APP_SHORTCUTS",
      native_identity: "Info.plist AppShortcuts",
      capabilities_declared: hasShortcut ? ["OPEN"] : [],
      capabilities_verified: [],
      tcc_requirement: "NONE",
      entitlement_requirement: "NONE",
      execution_scope: [],
      observation_scope: ["APPLICATION_LAUNCH"],
      side_effect_class: "NONE",
      availability: hasShortcut ? "INTERFACE_FOUND" : "DISCOVERED",
      runtime_verified: false,
      owner_enabled: false,
    }),
    row({
      bridge_id: "bridge://macos/launch-services",
      interface_type: "LAUNCH_SERVICES",
      native_identity: "/usr/bin/open",
      capabilities_declared: ["OPEN_APPLICATION", "OPEN_DOCUMENT", "OPEN_URL", "REVEAL_RESOURCE", "GET_DEFAULT_APPLICATION", "GET_RESOURCE_DISPLAY_METADATA"],
      capabilities_verified: ls ? ["OPEN_APPLICATION", "OPEN_DOCUMENT", "REVEAL_RESOURCE", "GET_DEFAULT_APPLICATION", "GET_RESOURCE_DISPLAY_METADATA"] : [],
      tcc_requirement: "NONE",
      entitlement_requirement: "NONE",
      execution_scope: ls ? ["OPEN_APPLICATION", "OPEN_DOCUMENT", "REVEAL_RESOURCE"] : [],
      observation_scope: ["APPLICATION_LAUNCH", "FILE_OPEN", "PROCESS_EXEC"],
      side_effect_class: "OPEN",
      availability: !isDarwin() ? "UNAVAILABLE" : enabled && ls ? "OWNER_ENABLED" : ls ? "CAPABILITY_VERIFIED" : "NOT_AVAILABLE",
      runtime_verified: ls,
      owner_enabled: enabled && ls,
    }),
    row({
      bridge_id: "bridge://macos/nsworkspace",
      interface_type: "NSWORKSPACE",
      native_identity: "NSWorkspace via Launch Services CLI",
      capabilities_declared: ["OPEN_APPLICATION", "OPEN_DOCUMENT", "REVEAL_RESOURCE"],
      capabilities_verified: ls ? ["OPEN_APPLICATION", "OPEN_DOCUMENT", "REVEAL_RESOURCE"] : [],
      tcc_requirement: "NONE",
      entitlement_requirement: "NONE",
      execution_scope: [],
      observation_scope: ["APPLICATION_LAUNCH"],
      side_effect_class: "OPEN",
      availability: ls ? "CAPABILITY_VERIFIED" : "NOT_AVAILABLE",
      runtime_verified: ls,
      owner_enabled: false,
    }),
    row({
      bridge_id: "bridge://macos/process-gate",
      interface_type: "PROCESS_GATE",
      native_identity: "LOCAL_PROCESS_GATE_V1",
      capabilities_declared: ["COMPARE", "READ"],
      capabilities_verified: ["COMPARE"],
      tcc_requirement: "NONE",
      entitlement_requirement: "NONE",
      execution_scope: ["local.compute.true"],
      observation_scope: ["PROCESS_EXEC", "PROCESS_EXIT"],
      side_effect_class: "NONE",
      availability: "CAPABILITY_VERIFIED",
      runtime_verified: true,
      owner_enabled: false,
    }),
    row({
      bridge_id: "bridge://macos/os-service",
      interface_type: "OS_SERVICE",
      native_identity: "OS_RESOURCE_V1",
      capabilities_declared: ["READ"],
      capabilities_verified: ["READ"],
      tcc_requirement: "NONE",
      entitlement_requirement: "NONE",
      execution_scope: [],
      observation_scope: ["MOUNT", "NETWORK_EGRESS_METADATA"],
      side_effect_class: "NONE",
      availability: "CAPABILITY_VERIFIED",
      runtime_verified: true,
      owner_enabled: false,
    }),
    row({
      bridge_id: "bridge://macos/es-notify",
      interface_type: "ENDPOINT_SECURITY_NOTIFY",
      native_identity: "com.apple.developer.endpoint-security.client",
      capabilities_declared: esFramework ? ["NOTIFY_ONLY"] : [],
      capabilities_verified: [],
      tcc_requirement: "NONE",
      entitlement_requirement: "com.apple.developer.endpoint-security.client",
      execution_scope: [],
      observation_scope: [],
      side_effect_class: "NONE",
      availability: "NOT_AVAILABLE",
      runtime_verified: false,
      owner_enabled: false,
    }),
    row({
      bridge_id: "bridge://macos/es-auth",
      interface_type: "ENDPOINT_SECURITY_AUTH",
      native_identity: "ES_EVENT_TYPE_AUTH_*",
      capabilities_declared: [],
      capabilities_verified: [],
      tcc_requirement: "NONE",
      entitlement_requirement: "com.apple.developer.endpoint-security.client",
      execution_scope: [],
      observation_scope: [],
      side_effect_class: "DENY_OS_EVENT",
      availability: "NOT_AVAILABLE",
      runtime_verified: false,
      owner_enabled: false,
    }),
    row({
      bridge_id: "bridge://macos/accessibility-fallback",
      interface_type: "ACCESSIBILITY_FALLBACK",
      native_identity: "AXUIElement",
      capabilities_declared: [],
      capabilities_verified: [],
      tcc_requirement: "Accessibility",
      entitlement_requirement: "NONE",
      execution_scope: [],
      observation_scope: [],
      side_effect_class: "NONE",
      availability: "UNSUPPORTED",
      runtime_verified: false,
      owner_enabled: false,
    }),
  ];
  persistBridgeSnapshot({ work_id, session_id, rows, grants_authority: false });
  return rows;
}

export function listMacosBridges(): readonly MacosNativeBridgeV1[] {
  const snaps = listBridgeSnapshots<{ rows?: MacosNativeBridgeV1[] }>();
  return snaps[snaps.length - 1]?.rows ?? [];
}

export function getMacosBridgeStatus(ai_identity: string, session_id: string, work_id: string): Record<string, unknown> {
  const rows = listMacosBridges().length ? listMacosBridges() : refreshMacosBridge(work_id, session_id, ai_identity);
  return {
    schema: "MACOS_NATIVE_CONTROL_BRIDGE_V1",
    discovery_grants_authority: false,
    ENFORCEMENT_ENABLED: false,
    AI_HAS_SYSTEM_ENFORCEMENT_AUTHORITY: false,
    bridges: rows,
  };
}

export function listMacosCapabilities(): readonly { interface_type: NativeInterfaceType; capabilities_verified: readonly string[]; owner_enabled: boolean; availability: string }[] {
  return listMacosBridges().map((row) => ({
    interface_type: row.interface_type,
    capabilities_verified: row.capabilities_verified,
    owner_enabled: row.owner_enabled,
    availability: row.availability,
  }));
}

export { ownerEnabled as macosBridgeOwnerEnabled };
