/**
 * Application/tool actions execute only through the existing local capability gateway.
 */

import {
  FORBIDDEN_CAPABILITY_NAMES,
  emitLocalResourceEvent,
  evaluateProcessJobRequest,
  invokeLocalCapability,
} from "../local-resource-access/contract";
import { getLocalTool } from "./adapters";
import { invokeAccessibilityFallback, resolveLocalToolRoute } from "./native-first";
import { persistHealth } from "./persist";
import { nowIso } from "./host-runtime";

const SIDE_EFFECTS = new Set(["COPY", "MOVE", "DELETE", "WRITE", "CREATE", "SHARE", "PRINT"]);

export async function executeLocalToolAction(input: {
  readonly adapter_id?: string;
  readonly action: string;
  readonly ai_client_id: string;
  readonly session_id: string;
  readonly work_id: string;
  readonly payload?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  emitLocalResourceEvent("TOOL_ACTION_REQUESTED", input.work_id, input.action, undefined, {
    session_id: input.session_id, locality: "LOCAL", action: input.adapter_id ?? input.action,
  });
  if (FORBIDDEN_CAPABILITY_NAMES.includes(input.action as never) || /sudo|shell|applescript|ui.script/i.test(input.action)) {
    emitLocalResourceEvent("TOOL_ACTION_BLOCKED", input.work_id, "FORBIDDEN", undefined, {
      session_id: input.session_id, authority_decision: "DENY", locality: "LOCAL",
    });
    return { ok: false, reason_code: "FORBIDDEN_CAPABILITY", ARBITRARY_SHELL_ACCESS: false, SUDO_ACCESS: false };
  }
  const shell = evaluateProcessJobRequest({ job_id: "sudo" });
  void shell;
  const adapter = input.adapter_id
    ? getLocalTool(input.adapter_id)
    : resolveLocalToolRoute({ action: input.action }).selected;
  if (!adapter) {
    emitLocalResourceEvent("TOOL_ACTION_BLOCKED", input.work_id, "UNKNOWN_ADAPTER", undefined, {
      session_id: input.session_id, authority_decision: "DENY", locality: "LOCAL",
    });
    return { ok: false, reason_code: "UNKNOWN_ADAPTER" };
  }
  if (adapter.adapter_type === "ACCESSIBILITY_FALLBACK") {
    const blocked = invokeAccessibilityFallback();
    emitLocalResourceEvent("TOOL_ACTION_BLOCKED", input.work_id, blocked.reason_code, undefined, {
      session_id: input.session_id, authority_decision: "DENY", locality: "LOCAL",
    });
    return { ...blocked, ARBITRARY_UI_AUTOMATION: false };
  }
  if (!adapter.runtime_verified || !adapter.capabilities_verified.includes(input.action)) {
    emitLocalResourceEvent("TOOL_ACTION_BLOCKED", input.work_id, "CAPABILITY_NOT_VERIFIED", undefined, {
      session_id: input.session_id, authority_decision: "DENY", locality: "LOCAL",
    });
    return { ok: false, reason_code: "CAPABILITY_NOT_VERIFIED" };
  }
  if (!adapter.owner_enabled) {
    emitLocalResourceEvent("TOOL_ACTION_BLOCKED", input.work_id, "OWNER_DISABLED", undefined, {
      session_id: input.session_id, authority_decision: "DENY", locality: "LOCAL",
    });
    return { ok: false, reason_code: "OWNER_DISABLED", OWNER_ENABLED_REQUIRED: true };
  }
  if (!adapter.gateway_capability || !adapter.resource_id) {
    emitLocalResourceEvent("TOOL_ACTION_BLOCKED", input.work_id, "NO_GATEWAY_CONTRACT", undefined, {
      session_id: input.session_id, authority_decision: "DENY", locality: "LOCAL",
    });
    return { ok: false, reason_code: "NO_GATEWAY_CONTRACT" };
  }
  if (SIDE_EFFECTS.has(input.action) && input.payload?.preview_approved !== true) {
    return { ok: false, reason_code: "PREVIEW_REQUIRED", SIDE_EFFECT_PREVIEW_REQUIRED: true, executed: false };
  }
  const mapped = adapter.canonical_action_mapping.find((row) => row.canonical === input.action)?.native ?? adapter.gateway_capability;
  const capability = mapped.startsWith("local.") ? mapped : adapter.gateway_capability;
  emitLocalResourceEvent("TOOL_ACTION_ALLOWED", input.work_id, input.action, undefined, {
    session_id: input.session_id, resource_id: adapter.resource_id, authority_decision: "ALLOW", locality: "LOCAL",
  });
  emitLocalResourceEvent("TOOL_ACTION_STARTED", input.work_id, capability, undefined, {
    session_id: input.session_id, resource_id: adapter.resource_id, locality: "LOCAL",
  });
  const payload = { ...(input.payload ?? {}) };
  if (adapter.application_id && capability === "local.app.invoke_registered_action") {
    payload.application_id = adapter.application_id;
    payload.action_id = adapter.canonical_action_mapping[0]?.native;
    payload.everyday_action = input.action;
  }
  const invoked = await invokeLocalCapability({
    ai_client_id: input.ai_client_id,
    session_id: input.session_id,
    work_id: input.work_id,
    capability: capability as never,
    resource_id: adapter.resource_id,
    input: payload,
  });
  persistHealth({
    schema: "TOOL_CAPABILITY_HEALTH_V1",
    tool_id: adapter.adapter_id,
    last_successful_invocation: invoked.ok ? nowIso() : null,
    last_error: invoked.ok ? null : String(invoked.authority.reason_code),
    owner_enabled: true,
  });
  emitLocalResourceEvent("TOOL_ACTION_COMPLETED", input.work_id, invoked.ok ? "COMPLETED" : "DENIED", invoked.envelope.execution_id, {
    session_id: input.session_id, resource_id: adapter.resource_id, locality: "LOCAL",
    result_status: invoked.envelope.result_status,
  });
  return { ok: invoked.ok, adapter_id: adapter.adapter_id, invoked, native_interface: adapter.adapter_type };
}
