/**
 * Site-tool / WebMCP surface. Maps to existing canonical operations.
 * Discovery does not execute. Browser has no filesystem or shell.
 * Not a second MCP server: the same gateway functions the MCP tools already call.
 */

import {
  capabilitiesPublicView,
  emitLocalResourceEvent,
  invokeLocalCapability,
  listLocalResourcesForSession,
  listPersistedInventory,
  refreshMachineInventory,
} from "../local-resource-access/contract";
import {
  attachActionPreview,
  openOwnerReviewView,
  renderActivityView,
  renderCanonicalView,
} from "../canonical-view/contract";
import { evaluateAiClient } from "./bindings";
import { siteToolCatalog } from "./discovery";
import { utf8Bytes } from "./host-runtime";
import { SIDE_EFFECT_CAPABILITIES, SITE_TOOL_ALLOWLIST } from "./types";

export function listSiteTools(): Record<string, unknown> {
  emitLocalResourceEvent("AI_TOOL_DISCOVERY", null, "site-tools", undefined, {
    locality: "LOCAL", action: "DISCOVERY_ONLY", authority_decision: "DENY",
  });
  return siteToolCatalog();
}

export async function invokeSiteTool(input: {
  readonly tool_name: string;
  readonly arguments: Record<string, unknown>;
  readonly ai_client_id: string;
  readonly session_id: string;
  readonly work_id?: string;
}): Promise<Record<string, unknown>> {
  if (!SITE_TOOL_ALLOWLIST.includes(input.tool_name)) {
    return { ok: false, reason_code: "SITE_TOOL_NOT_ALLOWLISTED", executed: false };
  }
  const auth = evaluateAiClient(input.ai_client_id, input.session_id);
  if (auth.decision !== "ALLOW") {
    return { ok: false, reason_code: auth.reason_code, executed: false, owner_enabled: false };
  }
  const work_id = String(input.work_id ?? input.arguments.work_id ?? `work-site-${Date.now()}`);
  emitLocalResourceEvent("AI_CAPABILITY_REQUESTED", work_id, input.tool_name, undefined, {
    session_id: input.session_id, action: input.tool_name, locality: "LOCAL",
  });
  const args = input.arguments;
  let body: Record<string, unknown> = {};
  if (input.tool_name === "dna_os.get_machine_inventory") {
    body = { inventory: refreshMachineInventory(work_id, input.session_id, input.ai_client_id), persisted: listPersistedInventory() };
  } else if (input.tool_name === "dna_os.list_local_resources") {
    body = { resources: listLocalResourcesForSession(input.ai_client_id, input.session_id) };
  } else if (input.tool_name === "dna_os.get_local_capabilities") {
    body = { capabilities: capabilitiesPublicView() };
  } else if (input.tool_name === "dna_os.render_canonical_view") {
    body = {
      view: renderCanonicalView({
        view_type: String(args.view_type ?? "SAFE_GENERIC_VIEW") as never,
        data_schema: typeof args.data_schema === "string" ? args.data_schema : undefined,
        rows: Array.isArray(args.rows) ? args.rows as Record<string, unknown>[] : undefined,
        source_resource_ids: Array.isArray(args.source_resource_ids) ? args.source_resource_ids.map(String) : undefined,
      }),
    };
  } else if (input.tool_name === "dna_os.open_owner_review") {
    body = {
      review: openOwnerReviewView({
        work_id,
        ai_client_id: input.ai_client_id,
        session_id: input.session_id,
        view_type: String(args.view_type ?? "FILE_LIST_V1") as never,
        source_resource_ids: Array.isArray(args.source_resource_ids) ? args.source_resource_ids.map(String) : undefined,
      }),
    };
  } else if (input.tool_name === "dna_os.get_activity_view") {
    body = { view: renderActivityView(typeof args.work_id === "string" ? args.work_id : work_id) };
  } else if (input.tool_name === "dna_os.create_action_preview") {
    const review_id = String(args.review_id ?? "");
    const previewed = attachActionPreview(review_id, {
      work_id,
      action: String(args.action ?? ""),
      resource_id: String(args.resource_id ?? ""),
      input: (args.input && typeof args.input === "object") ? args.input as Record<string, unknown> : {},
    });
    body = { review: previewed, PREVIEW_CREATED: !("ok" in previewed) };
  } else if (input.tool_name === "dna_os.invoke_local_capability") {
    const capability = String(args.capability ?? "");
    if (capability === "execute_any_command" || capability === "read_any_path" || capability === "write_any_path") {
      return { ok: false, reason_code: "UNKNOWN_CAPABILITY", executed: false };
    }
    const nested = (args.input && typeof args.input === "object") ? args.input as Record<string, unknown> : {};
    const logical = String(nested.logical_path ?? nested.source_logical ?? "");
    if (logical.includes("..") || logical.startsWith("/") || logical.includes("\\")) {
      return { ok: false, reason_code: "ARBITRARY_PATH_DENIED", executed: false };
    }
    if (SIDE_EFFECT_CAPABILITIES.includes(capability)) {
      return { ok: false, reason_code: "PREVIEW_REQUIRED", executed: false, SIDE_EFFECT_PREVIEW_REQUIRED: true };
    }
    const invoked = await invokeLocalCapability({
      ai_client_id: input.ai_client_id,
      session_id: input.session_id,
      work_id,
      capability: capability as never,
      resource_id: String(args.resource_id ?? ""),
      input: nested,
    });
    body = { invoked, existing_gateway: true };
  } else {
    return { ok: false, reason_code: "UNKNOWN_TOOL", executed: false };
  }
  return {
    ok: true,
    existing_gateway: true,
    site_tool: input.tool_name,
    result_bytes: utf8Bytes(body),
    result: body,
  };
}
