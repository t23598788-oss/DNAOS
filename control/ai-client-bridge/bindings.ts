/**
 * AI_CLIENT_BINDING_V1 — provider identity grants no authority.
 */

import { emitLocalResourceEvent } from "../local-resource-access/contract";
import { nowIso } from "./host-runtime";
import { listPersistedBindings, persistBinding } from "./persist";
import { SITE_TOOL_ALLOWLIST, type AiClientBindingState, type AiClientBindingV1, type AiClientType, type AiConnectionType, type AiClientProvider } from "./types";

export function listAiClientBindings(): readonly AiClientBindingV1[] {
  return listPersistedBindings<AiClientBindingV1>();
}

export function latestAiClientBinding(ai_client_id: string, session_id?: string): AiClientBindingV1 | null {
  const rows = listAiClientBindings().filter((row) =>
    row.ai_client_id === ai_client_id && (session_id === undefined || row.session_id === session_id),
  );
  return rows[rows.length - 1] ?? null;
}

function writeBinding(partial: Omit<AiClientBindingV1, "schema" | "grants_authority" | "last_seen_at">): AiClientBindingV1 {
  const row: AiClientBindingV1 = {
    schema: "AI_CLIENT_BINDING_V1",
    grants_authority: false,
    last_seen_at: nowIso(),
    ...partial,
  };
  persistBinding(row);
  return row;
}

export function discoverAiClient(input: {
  readonly ai_client_id: string;
  readonly provider: AiClientProvider;
  readonly client_type: AiClientType;
  readonly connection_type: AiConnectionType;
  readonly session_id: string;
  readonly capabilities_requested?: readonly string[];
}): AiClientBindingV1 {
  const row = writeBinding({
    ai_client_id: input.ai_client_id,
    provider: input.provider,
    client_type: input.client_type,
    connection_type: input.connection_type,
    session_id: input.session_id,
    capabilities_requested: input.capabilities_requested ?? [...SITE_TOOL_ALLOWLIST],
    capabilities_exposed: [],
    owner_authority_state: "DENY",
    locality: "EXTERNAL_AI",
    data_egress_policy: "MINIMIZED_EXTERNAL",
    verification_state: "DISCOVERED",
    binding_state: "DISCOVERED",
  });
  emitLocalResourceEvent("AI_CLIENT_DISCOVERED", null, input.ai_client_id, undefined, {
    session_id: input.session_id, authority_decision: "DENY", locality: "LOCAL", action: "DISCOVER",
  });
  return row;
}

export function connectAiClient(ai_client_id: string, session_id: string): AiClientBindingV1 | { ok: false; reason_code: string } {
  const prev = latestAiClientBinding(ai_client_id, session_id) ?? latestAiClientBinding(ai_client_id);
  if (!prev) return { ok: false, reason_code: "UNKNOWN_AI_CLIENT" };
  const row = writeBinding({
    ...prev,
    session_id,
    binding_state: prev.owner_authority_state === "ALLOW" ? "SESSION_ACTIVE" : "CONNECTED",
    verification_state: prev.owner_authority_state === "ALLOW" ? prev.verification_state : "CONNECTED",
    owner_authority_state: prev.owner_authority_state,
    capabilities_exposed: prev.owner_authority_state === "ALLOW" ? prev.capabilities_exposed : [],
  });
  emitLocalResourceEvent("AI_CLIENT_CONNECTED", null, ai_client_id, undefined, {
    session_id, authority_decision: row.owner_authority_state, locality: "LOCAL", action: "CONNECT",
  });
  return row;
}

export function verifyAiClientToolDiscovery(ai_client_id: string, session_id: string, discovered_tools: readonly string[]): AiClientBindingV1 | { ok: false; reason_code: string } {
  const prev = latestAiClientBinding(ai_client_id, session_id) ?? latestAiClientBinding(ai_client_id);
  if (!prev) return { ok: false, reason_code: "UNKNOWN_AI_CLIENT" };
  const row = writeBinding({
    ...prev,
    session_id,
    binding_state: prev.owner_authority_state === "ALLOW" ? "OWNER_ENABLED" : "TOOL_DISCOVERY_VERIFIED",
    verification_state: "TOOL_DISCOVERY_VERIFIED",
    capabilities_requested: discovered_tools,
    capabilities_exposed: prev.owner_authority_state === "ALLOW" ? prev.capabilities_exposed : [],
    owner_authority_state: prev.owner_authority_state,
  });
  emitLocalResourceEvent("AI_TOOL_DISCOVERY", null, ai_client_id, undefined, {
    session_id, authority_decision: "DENY", locality: "LOCAL", action: "TOOLS_LIST",
  });
  return row;
}

export function enableAiClient(input: {
  readonly ai_client_id: string;
  readonly session_id: string;
  readonly capabilities_exposed: readonly string[];
  readonly data_egress_policy?: AiClientBindingV1["data_egress_policy"];
}): AiClientBindingV1 | { ok: false; reason_code: string } {
  const prev = latestAiClientBinding(input.ai_client_id, input.session_id) ?? latestAiClientBinding(input.ai_client_id);
  if (!prev) return { ok: false, reason_code: "UNKNOWN_AI_CLIENT" };
  const exposed = input.capabilities_exposed.filter((name) => SITE_TOOL_ALLOWLIST.includes(name) || name.startsWith("local."));
  const row = writeBinding({
    ...prev,
    session_id: input.session_id,
    capabilities_exposed: exposed,
    owner_authority_state: "ALLOW",
    binding_state: "OWNER_ENABLED",
    verification_state: "OWNER_ENABLED",
    data_egress_policy: input.data_egress_policy ?? prev.data_egress_policy,
  });
  emitLocalResourceEvent("OWNER_CAPABILITY_ENABLED", null, input.ai_client_id, undefined, {
    session_id: input.session_id, authority_decision: "ALLOW", locality: "LOCAL", action: "ENABLE_AI_CLIENT",
  });
  return row;
}

export function blockAiClient(ai_client_id: string, session_id: string): AiClientBindingV1 | { ok: false; reason_code: string } {
  const prev = latestAiClientBinding(ai_client_id, session_id) ?? latestAiClientBinding(ai_client_id);
  if (!prev) return { ok: false, reason_code: "UNKNOWN_AI_CLIENT" };
  return writeBinding({
    ...prev,
    session_id,
    owner_authority_state: "DENY",
    binding_state: "BLOCKED",
    verification_state: "BLOCKED",
    capabilities_exposed: [],
  });
}

export function evaluateAiClient(ai_client_id: string, session_id: string): {
  readonly decision: "ALLOW" | "DENY";
  readonly reason_code: string;
  readonly owner_enabled: boolean;
  readonly binding: AiClientBindingV1 | null;
} {
  const binding = latestAiClientBinding(ai_client_id, session_id) ?? latestAiClientBinding(ai_client_id);
  if (!binding) {
    return { decision: "DENY", reason_code: "UNKNOWN_AI_DEFAULT_DENY", owner_enabled: false, binding: null };
  }
  if (binding.binding_state === "BLOCKED") {
    return { decision: "DENY", reason_code: "AI_CLIENT_BLOCKED", owner_enabled: false, binding };
  }
  if (binding.owner_authority_state !== "ALLOW") {
    return { decision: "DENY", reason_code: "OWNER_ENABLED_REQUIRED", owner_enabled: false, binding };
  }
  return { decision: "ALLOW", reason_code: "AI_CLIENT_OWNER_ENABLED", owner_enabled: true, binding };
}

export function googleChromeGeminiAvailability(): Record<string, string> {
  return {
    GOOGLE_CHROME_BINDING: "NOT_AVAILABLE",
    GEMINI_BINDING: "NOT_AVAILABLE",
    WEB_SEARCH: "NOT_AVAILABLE",
    PAGE_READ: "NOT_AVAILABLE",
    SITE_TOOL_DISCOVERY: "DNA_OS_CIRCUIT",
    REMOTE_RESOURCE_SEARCH: "NOT_AVAILABLE",
    reason: "No runtime-verified Google/Chrome/Gemini MCP adapter is bound in this repository",
  };
}
