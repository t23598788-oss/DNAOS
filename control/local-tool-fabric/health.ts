/**
 * TOOL_CAPABILITY_HEALTH_V1 — install ≠ adapter ≠ verified ≠ authorized.
 */

import { listPersistedHealth, persistHealth } from "./persist";
import { getLocalTool, listLocalTools } from "./adapters";
import { listDevices } from "./devices";
import type { ToolCapabilityHealthV1 } from "./types";

export function getToolHealth(tool_id: string): ToolCapabilityHealthV1 | null {
  const adapter = getLocalTool(tool_id);
  if (!adapter) {
    const device = listDevices().find((row) => row.device_id === tool_id);
    if (!device) return null;
    return {
      schema: "TOOL_CAPABILITY_HEALTH_V1",
      tool_id,
      installed: device.availability !== "UNAVAILABLE",
      reachable: device.availability === "AVAILABLE",
      version: null,
      adapter_healthy: Boolean(device.resource_id),
      authentication_required: false,
      runtime_verified: Boolean(device.resource_id),
      last_successful_invocation: null,
      last_error: null,
      owner_enabled: device.owner_enabled,
      APPLICATION_INSTALLED: device.availability !== "UNAVAILABLE",
      ADAPTER_AVAILABLE: Boolean(device.resource_id),
      CAPABILITY_VERIFIED: Boolean(device.resource_id),
      AUTHORIZED: false,
    };
  }
  const history = listPersistedHealth<{ tool_id?: string; last_successful_invocation?: string | null; last_error?: string | null }>()
    .filter((row) => row.tool_id === tool_id);
  const last = history[history.length - 1];
  const installed = Boolean(adapter.application_id) || adapter.availability !== "UNSUPPORTED";
  return {
    schema: "TOOL_CAPABILITY_HEALTH_V1",
    tool_id,
    installed,
    reachable: adapter.availability !== "UNAVAILABLE" && adapter.availability !== "UNSUPPORTED",
    version: null,
    adapter_healthy: adapter.runtime_verified,
    authentication_required: false,
    runtime_verified: adapter.runtime_verified,
    last_successful_invocation: last?.last_successful_invocation ?? null,
    last_error: last?.last_error ?? null,
    owner_enabled: adapter.owner_enabled,
    APPLICATION_INSTALLED: installed,
    ADAPTER_AVAILABLE: adapter.runtime_verified || adapter.availability === "INTERFACE_FOUND" || adapter.availability === "ADAPTER_REGISTERED" || adapter.availability === "CAPABILITY_VERIFIED" || adapter.availability === "OWNER_ENABLED",
    CAPABILITY_VERIFIED: adapter.capabilities_verified.length > 0,
    AUTHORIZED: adapter.owner_enabled,
  };
}

export function listToolHealth(): readonly ToolCapabilityHealthV1[] {
  return listLocalTools().map((row) => getToolHealth(row.adapter_id)).filter((row): row is ToolCapabilityHealthV1 => row !== null);
}

export { persistHealth };
