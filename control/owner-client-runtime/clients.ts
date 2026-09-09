/**
 * UNIVERSAL_CLIENT_V1 — vendor is metadata. Authentication is not authority.
 */

import { emitLocalResourceEvent } from "../local-resource-access/contract";
import { discoverAiClient, enableAiClient, SITE_TOOL_ALLOWLIST } from "../ai-client-bridge/contract";
import { nowIso } from "./host-runtime";
import { listPersistedClients, persistClient } from "./persist";
import type { ClientFamily, UniversalClientV1 } from "./types";

export function listUniversalClients(): readonly UniversalClientV1[] {
  const latest = new Map<string, UniversalClientV1>();
  for (const row of listPersistedClients<UniversalClientV1>()) latest.set(row.client_id, row);
  return [...latest.values()].sort((a, b) => a.client_id.localeCompare(b.client_id));
}

export function getUniversalClient(client_id: string): UniversalClientV1 | null {
  return listUniversalClients().find((row) => row.client_id === client_id) ?? null;
}

function write(row: UniversalClientV1): UniversalClientV1 {
  persistClient(row);
  return row;
}

export function registerUniversalClient(input: {
  readonly client_id: string;
  readonly client_family: ClientFamily;
  readonly provider: string;
  readonly runtime_type?: string;
  readonly connection_type?: string;
  readonly protocol?: string;
  readonly protocol_version?: string;
  readonly session_work_scope: string;
  readonly capabilities_declared?: readonly string[];
}): UniversalClientV1 {
  const row: UniversalClientV1 = {
    schema: "UNIVERSAL_CLIENT_V1",
    client_id: input.client_id,
    client_family: input.client_family,
    provider: input.provider,
    runtime_type: input.runtime_type ?? input.client_family,
    device_identity: "this-machine",
    connection_type: input.connection_type ?? "MCP",
    protocol: input.protocol ?? "MCP",
    protocol_version: input.protocol_version ?? "legacy-compatible",
    authenticated_identity: null,
    owner_binding: false,
    capabilities_declared: input.capabilities_declared ?? [],
    capabilities_verified: [],
    session_work_scope: input.session_work_scope,
    data_access_scope: [],
    action_scope: [],
    egress_scope: [],
    approval_scope: [],
    availability: "AVAILABLE",
    last_verified_at: nowIso(),
    authenticated: false,
    owner_authority_state: "DENY",
    grants_authority: false,
  };
  if (input.client_family === "AI_CHAT_CLIENT" || input.client_family === "MCP_CLIENT" || input.client_family === "WEB_SITE_TOOL_CLIENT" || input.client_family === "AI_LOCAL_ASSISTANT") {
    discoverAiClient({
      ai_client_id: input.client_id,
      provider: input.provider === "google" ? "google" : input.provider === "openai" ? "openai" : "other",
      client_type: input.client_family === "WEB_SITE_TOOL_CLIENT" ? "SITE_TOOL" : "CHATGPT",
      connection_type: "MCP",
      session_id: input.session_work_scope,
    });
  }
  return write(row);
}

export function authenticateUniversalClient(client_id: string, authenticated_identity: string): UniversalClientV1 | { ok: false; reason_code: string } {
  const prev = getUniversalClient(client_id);
  if (!prev) return { ok: false, reason_code: "UNKNOWN_CLIENT" };
  const row = write({
    ...prev,
    authenticated: true,
    authenticated_identity,
    last_verified_at: nowIso(),
    owner_authority_state: prev.owner_authority_state,
    owner_binding: prev.owner_binding,
  });
  emitLocalResourceEvent("CLIENT_AUTHENTICATED", null, client_id, undefined, {
    session_id: prev.session_work_scope, locality: "LOCAL", action: "AUTHENTICATE", authority_decision: "DENY",
  });
  return row;
}

export function enableUniversalClient(client_id: string, scopes: {
  readonly data_access_scope: readonly string[];
  readonly action_scope: readonly string[];
}): UniversalClientV1 | { ok: false; reason_code: string } {
  const prev = getUniversalClient(client_id);
  if (!prev) return { ok: false, reason_code: "UNKNOWN_CLIENT" };
  discoverAiClient({
    ai_client_id: client_id,
    provider: prev.provider === "google" ? "google" : prev.provider === "openai" ? "openai" : "other",
    client_type: prev.client_family === "WEB_SITE_TOOL_CLIENT" ? "SITE_TOOL" : prev.client_family === "AI_CODING_CLIENT" ? "MCP" : "CHATGPT",
    connection_type: "MCP",
    session_id: prev.session_work_scope,
  });
  enableAiClient({
    ai_client_id: client_id,
    session_id: prev.session_work_scope,
    capabilities_exposed: [...SITE_TOOL_ALLOWLIST],
  });
  return write({
    ...prev,
    owner_binding: true,
    owner_authority_state: "ALLOW",
    availability: "AVAILABLE",
    data_access_scope: scopes.data_access_scope,
    action_scope: scopes.action_scope,
    capabilities_verified: prev.capabilities_declared,
    last_verified_at: nowIso(),
  });
}

export function markClientUnavailable(client_id: string): UniversalClientV1 | { ok: false; reason_code: string } {
  const prev = getUniversalClient(client_id);
  if (!prev) return { ok: false, reason_code: "UNKNOWN_CLIENT" };
  const row = write({ ...prev, availability: "PROVIDER_UNAVAILABLE", last_verified_at: nowIso() });
  emitLocalResourceEvent("PROVIDER_UNAVAILABLE", null, client_id, undefined, {
    session_id: prev.session_work_scope, locality: "LOCAL", action: "UNAVAILABLE",
  });
  return row;
}

export function disconnectClient(client_id: string): UniversalClientV1 | { ok: false; reason_code: string } {
  const prev = getUniversalClient(client_id);
  if (!prev) return { ok: false, reason_code: "UNKNOWN_CLIENT" };
  const row = write({ ...prev, availability: "DISCONNECTED", last_verified_at: nowIso() });
  emitLocalResourceEvent("CLIENT_DISCONNECTED", null, client_id, undefined, {
    session_id: prev.session_work_scope, locality: "LOCAL", action: "DISCONNECT",
  });
  return row;
}

export function evaluateUniversalClient(client_id: string, protocol_version?: string): {
  readonly decision: "ALLOW" | "DENY";
  readonly reason_code: string;
  readonly authenticated: boolean;
  readonly owner_enabled: boolean;
  readonly protocol_version_affects_authority: false;
  readonly detected_protocol_version: string;
  readonly client: UniversalClientV1 | null;
} {
  const client = getUniversalClient(client_id);
  const detected = protocol_version ?? client?.protocol_version ?? "legacy-compatible";
  if (!client) {
    return {
      decision: "DENY", reason_code: "UNKNOWN_CLIENT_DEFAULT_DENY", authenticated: false,
      owner_enabled: false, protocol_version_affects_authority: false, detected_protocol_version: detected, client: null,
    };
  }
  if (client.availability === "PROVIDER_UNAVAILABLE") {
    emitLocalResourceEvent("CLIENT_AUTHORIZATION_CHECKED", null, "PROVIDER_UNAVAILABLE", undefined, {
      session_id: client.session_work_scope, authority_decision: "DENY", action: client_id, locality: "LOCAL",
    });
    return {
      decision: "DENY", reason_code: "PROVIDER_UNAVAILABLE", authenticated: client.authenticated,
      owner_enabled: client.owner_binding, protocol_version_affects_authority: false, detected_protocol_version: detected, client,
    };
  }
  if (!client.owner_binding || client.owner_authority_state !== "ALLOW") {
    emitLocalResourceEvent("CLIENT_AUTHORIZATION_CHECKED", null, "AUTHENTICATED_NOT_AUTHORIZED", undefined, {
      session_id: client.session_work_scope, authority_decision: "DENY", action: client_id, locality: "LOCAL",
    });
    return {
      decision: "DENY",
      reason_code: client.authenticated ? "AUTHENTICATED_WITHOUT_OWNER_AUTHORITY" : "DEFAULT_DENY",
      authenticated: client.authenticated,
      owner_enabled: false,
      protocol_version_affects_authority: false,
      detected_protocol_version: detected,
      client,
    };
  }
  emitLocalResourceEvent("CLIENT_AUTHORIZATION_CHECKED", null, "OWNER_ENABLED", undefined, {
    session_id: client.session_work_scope, authority_decision: "ALLOW", action: client_id, locality: "LOCAL",
  });
  return {
    decision: "ALLOW", reason_code: "OWNER_ENABLED", authenticated: client.authenticated,
    owner_enabled: true, protocol_version_affects_authority: false, detected_protocol_version: detected, client,
  };
}

export function getClientStatus(client_id: string): Record<string, unknown> {
  const evald = evaluateUniversalClient(client_id);
  return {
    authentication_equals_authority: false,
    provider_identity_grants_authority: false,
    ...evald,
  };
}
