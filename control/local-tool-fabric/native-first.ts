/**
 * NATIVE_INTERFACE_FIRST_V1 — never pick accessibility when a structured adapter exists.
 */

import { ADAPTER_PREFERENCE, NATIVE_INTERFACE_ORDER } from "./types";
import { getLocalTool, listLocalTools } from "./adapters";
import type { AdapterType, LocalToolAdapterV1 } from "./types";

export function resolveLocalToolRoute(input: {
  readonly action: string;
  readonly application_id?: string;
  readonly resource_id?: string;
  readonly device_id?: string;
}): {
  readonly schema: "NATIVE_INTERFACE_FIRST_V1";
  readonly order: typeof NATIVE_INTERFACE_ORDER;
  readonly selected: LocalToolAdapterV1 | null;
  readonly reason_code: string;
  readonly accessibility_used: false;
} {
  const candidates = listLocalTools().filter((row) => {
    if (input.application_id && row.application_id !== input.application_id) return false;
    if (input.resource_id && row.resource_id !== input.resource_id) return false;
    if (input.device_id && row.device_id !== input.device_id) return false;
    if (row.adapter_type === "ACCESSIBILITY_FALLBACK") return false;
    if (row.availability === "UNAVAILABLE" || row.availability === "UNSUPPORTED") return false;
    return row.capabilities_verified.includes(input.action);
  });
  const ranked = [...candidates].sort((a, b) => ADAPTER_PREFERENCE[a.adapter_type] - ADAPTER_PREFERENCE[b.adapter_type]);
  const selected = ranked[0] ?? null;
  return {
    schema: "NATIVE_INTERFACE_FIRST_V1",
    order: NATIVE_INTERFACE_ORDER,
    selected,
    reason_code: selected ? "STRUCTURED_NATIVE_PREFERRED" : "NO_VERIFIED_ADAPTER",
    accessibility_used: false,
  };
}

export function invokeAccessibilityFallback(): { ok: false; reason_code: "ACCESSIBILITY_FALLBACK_NOT_REGISTERED" | "ARBITRARY_UI_AUTOMATION_DENIED" } {
  return { ok: false, reason_code: "ACCESSIBILITY_FALLBACK_NOT_REGISTERED" };
}

export function adapterPreferenceRank(type: AdapterType): number {
  return ADAPTER_PREFERENCE[type];
}

export { getLocalTool };
