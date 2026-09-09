import { hostname } from "node:os";
import { listRegisteredApplications } from "../local-resource-access/contract";
import { listDevices, listLocalTools } from "../local-tool-fabric/contract";
import { listMacosBridges } from "./bridge";
import { getMacosPermissionState } from "./permissions";
import { nowIso } from "./host-runtime";
import { listPersistedBaselines, persistBaseline, persistDrift } from "./persist";
import { emitLocalResourceEvent } from "../local-resource-access/contract";
import type { CapabilityDriftV1, DriftClass, OwnerMachineBaselineV1 } from "./types";

export function recordOwnerMachineBaseline(owner_enabled_resources: readonly string[] = []): OwnerMachineBaselineV1 {
  const bridges = listMacosBridges();
  const row: OwnerMachineBaselineV1 = {
    schema: "OWNER_MACHINE_BASELINE_V1",
    baseline_id: `baseline-${nowIso()}`,
    machine_id: `machine://macos/${hostname()}`,
    macos_version: bridges[0]?.macos_version ?? "",
    recorded_at: nowIso(),
    registered_apps: listRegisteredApplications().map((app) => app.application_id),
    verified_native_interfaces: bridges.filter((row) => row.runtime_verified).map((row) => row.interface_type),
    registered_devices: listDevices().map((row) => row.device_id),
    owner_enabled_resources: [...owner_enabled_resources],
    tcc_states: [...getMacosPermissionState()],
    registered_command_capabilities: [...new Set(bridges.flatMap((row) => row.capabilities_verified))],
    secrets_copied: false,
  };
  persistBaseline(row);
  return row;
}

export function detectCapabilityDrift(): CapabilityDriftV1 {
  const previous = listPersistedBaselines<OwnerMachineBaselineV1>();
  const last = previous[previous.length - 1];
  const next = recordOwnerMachineBaseline(last?.owner_enabled_resources ?? []);
  if (!last) {
    const row: CapabilityDriftV1 = { schema: "MACOS_CAPABILITY_DRIFT_V1", classification: "NO_CHANGE", detail: "first-baseline", auto_enabled: false };
    persistDrift(row);
    return row;
  }
  const addedApps = next.registered_apps.filter((id) => !last.registered_apps.includes(id));
  const removedApps = last.registered_apps.filter((id) => !next.registered_apps.includes(id));
  const addedCaps = next.registered_command_capabilities.filter((id) => !last.registered_command_capabilities.includes(id));
  const removedCaps = last.registered_command_capabilities.filter((id) => !next.registered_command_capabilities.includes(id));
  const permChanged = JSON.stringify(next.tcc_states.map((row) => [row.permission, row.state])) !== JSON.stringify(last.tcc_states.map((row) => [row.permission, row.state]));
  const tools = listLocalTools();
  void tools;
  let classification: DriftClass = "NO_CHANGE";
  let detail = "stable";
  if (removedCaps.length || removedApps.length) {
    classification = "CAPABILITY_REMOVED";
    detail = `removed:${[...removedCaps, ...removedApps].join(",")}`;
  } else if (addedCaps.length || addedApps.length) {
    classification = "CAPABILITY_ADDED";
    detail = `added:${[...addedCaps, ...addedApps].join(",")}`;
  } else if (permChanged) {
    classification = "PERMISSION_CHANGED";
    detail = "tcc";
  }
  if (classification === "CAPABILITY_ADDED") classification = "OWNER_REVIEW_REQUIRED";
  const row: CapabilityDriftV1 = { schema: "MACOS_CAPABILITY_DRIFT_V1", classification, detail, auto_enabled: false };
  persistDrift(row);
  emitLocalResourceEvent("MACOS_DRIFT_DETECTED", null, classification, undefined, { locality: "LOCAL" });
  return row;
}
