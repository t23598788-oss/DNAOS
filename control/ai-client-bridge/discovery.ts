/**
 * Read-only client discovery. No execution. No secrets, tokens, or absolute machine paths.
 */

import {
  capabilitiesPublicView,
  getEverydayAction,
  listEverydayActions,
  listLocalResourcesForSession,
} from "../local-resource-access/contract";
import { listDocumentTemplates, REGISTERED_VIEW_TYPES } from "../canonical-view/contract";
import { evaluateAiClient } from "./bindings";
import { SITE_TOOL_ALLOWLIST } from "./types";

const HIDDEN = /\/Users\/|\/home\/|keychain:\/\/|ghp_|sk-|password|secret/i;

function scrub(value: unknown): unknown {
  const blob = JSON.stringify(value);
  if (HIDDEN.test(blob)) {
    return { redacted: true, reason_code: "HIDDEN_MACHINE_MATERIAL" };
  }
  return value;
}

export function siteToolCatalog(): Record<string, unknown> {
  return {
    schema: "WEBMCP_SITE_TOOL_SURFACE",
    execution_path: "EXISTING_DNA_OS_MCP_TOOLS",
    second_mcp_server: false,
    second_control_plane: false,
    arbitrary_javascript: false,
    direct_filesystem_from_browser: false,
    discovery_executes: false,
    tools: SITE_TOOL_ALLOWLIST.map((name) => ({ name, maps_to: name })),
  };
}

export function getAiClientDiscovery(ai_client_id: string, session_id: string): Record<string, unknown> {
  const auth = evaluateAiClient(ai_client_id, session_id);
  const approval_required = listEverydayActions()
    .filter((row) => row.owner_approval_requirement === "OWNER_APPROVAL_REQUIRED")
    .map((row) => row.action_id);
  const resources = auth.owner_enabled
    ? listLocalResourcesForSession(ai_client_id, session_id).map((row) => ({
      resource_id: row.resource_id,
      resource_type: row.resource_type,
      availability: row.availability,
    }))
    : [];
  const capabilities = auth.owner_enabled
    ? capabilitiesPublicView().map((row) => ({
      capability: row.capability,
      required_authority: row.required_authority,
    }))
    : [];
  return {
    schema: "AI_CLIENT_DISCOVERY_V1",
    ai_client_id,
    owner_authority_state: auth.decision,
    owner_enabled: auth.owner_enabled,
    reason_code: auth.reason_code,
    discovery_grants_authority: false,
    site_tools: SITE_TOOL_ALLOWLIST,
    resources: scrub(resources),
    capabilities: scrub(capabilities),
    views: [...REGISTERED_VIEW_TYPES],
    templates: listDocumentTemplates().map((row) => ({
      template_id: row.template_id,
      document_type: row.document_type,
      legal_correctness_claimed: row.legal_correctness_claimed,
    })),
    actions_requiring_approval: approval_required,
    delete_requires_approval: getEverydayAction("DELETE")?.owner_approval_requirement === "OWNER_APPROVAL_REQUIRED",
  };
}
