import { NATIVE_INTERFACE_RANK, MACOS_NATIVE_ROUTE_ORDER } from "./types";
import { listMacosBridges } from "./bridge";
import type { NativeInterfaceType } from "./types";

export function resolveMacosNativeRoute(action: string): {
  readonly schema: "MACOS_NATIVE_ROUTE_POLICY_V1";
  readonly order: typeof MACOS_NATIVE_ROUTE_ORDER;
  readonly selected: NativeInterfaceType | null;
  readonly reason_code: string;
  readonly accessibility_used: false;
  readonly shell_used: false;
} {
  const candidates = listMacosBridges().filter((row) => {
    if (row.interface_type === "ACCESSIBILITY_FALLBACK") return false;
    if (row.availability === "UNAVAILABLE" || row.availability === "UNSUPPORTED" || row.availability === "NOT_AVAILABLE") return false;
    return row.capabilities_verified.includes(action);
  }).sort((a, b) => NATIVE_INTERFACE_RANK[a.interface_type] - NATIVE_INTERFACE_RANK[b.interface_type]);
  const selected = candidates[0]?.interface_type ?? null;
  return {
    schema: "MACOS_NATIVE_ROUTE_POLICY_V1",
    order: MACOS_NATIVE_ROUTE_ORDER,
    selected,
    reason_code: selected ? "STRUCTURED_NATIVE_PREFERRED" : "NO_VERIFIED_NATIVE_ROUTE",
    accessibility_used: false,
    shell_used: false,
  };
}

export function nativeFailureFallback(failed_route: NativeInterfaceType): {
  readonly ok: false;
  readonly reason_code: "APP_INTENT_FAILED" | "NATIVE_ROUTE_FAILED";
  readonly silent_downgrade: false;
  readonly FALLBACK_AVAILABLE_REQUIRES_OWNER_POLICY: readonly NativeInterfaceType[];
} {
  const remaining = listMacosBridges()
    .filter((row) => NATIVE_INTERFACE_RANK[row.interface_type] > NATIVE_INTERFACE_RANK[failed_route])
    .filter((row) => row.interface_type !== "ACCESSIBILITY_FALLBACK")
    .filter((row) => row.runtime_verified)
    .map((row) => row.interface_type);
  return {
    ok: false,
    reason_code: failed_route === "APP_INTENTS" ? "APP_INTENT_FAILED" : "NATIVE_ROUTE_FAILED",
    silent_downgrade: false,
    FALLBACK_AVAILABLE_REQUIRES_OWNER_POLICY: remaining,
  };
}
