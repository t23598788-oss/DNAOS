/**
 * MACHINE_CAPABILITY_INVENTORY_V1 — discovered apps/services plus registered adapters.
 * Discovery never sets OWNER_ENABLED.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { discoverInstalledApplications, getRegisteredApplication, listRegisteredApplications } from "./application-adapter";
import { classifyApplicationCategory } from "./capability-states";
import { emitLocalResourceEvent } from "./events";
import { dataPath, nowIso } from "./host-runtime";
import { matchingCapabilityBindingPolicy } from "./owner-capability-policy";
import { listRemoteServiceBindings, getRemoteServiceBinding, publicRemoteServiceView } from "./remote-service-binding";
import type { ApplicationCategory, BindableActionId, InventoryLifecycle, MachineCapabilityInventoryV1 } from "./types";

function inventoryFile(): string {
  return dataPath("machine-inventory.jsonl", "MACHINE_CAPABILITY_INVENTORY_LOG");
}

function persist(rows: readonly MachineCapabilityInventoryV1[]): void {
  const p = inventoryFile();
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, `${JSON.stringify({ refreshed_at: nowIso(), rows })}\n`, "utf8");
}

export function listPersistedInventory(): readonly MachineCapabilityInventoryV1[] {
  const p = inventoryFile();
  if (!existsSync(p)) return [];
  let latest: MachineCapabilityInventoryV1[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as { rows?: MachineCapabilityInventoryV1[] };
      if (Array.isArray(parsed.rows)) latest = parsed.rows;
    } catch { /* skip */ }
  }
  return latest;
}

function lifecycleFor(adapter: boolean, verified: readonly string[], owner_enabled: boolean, available: boolean): InventoryLifecycle {
  if (!available) return "UNAVAILABLE";
  if (owner_enabled) return "OWNER_ENABLED";
  if (verified.length > 0) return "CAPABILITY_VERIFIED";
  if (adapter) return "REGISTERED";
  return "DISCOVERED";
}

export function refreshMachineInventory(work_id: string, session_id: string, ai_identity: string): readonly MachineCapabilityInventoryV1[] {
  const policy = matchingCapabilityBindingPolicy(ai_identity, session_id);
  const discovered = discoverInstalledApplications(work_id, session_id);
  const rows: MachineCapabilityInventoryV1[] = [];

  for (const app of discovered) {
    const bundle_id = String(app.bundle_id ?? "");
    const display = String(app.name ?? bundle_id);
    const application_id = bundle_id === "com.apple.TextEdit" ? "app://macos/textedit" : `app://discovered/${bundle_id}`;
    const registered = getRegisteredApplication(application_id);
    const adapter = Boolean(registered?.allowed_actions.length);
    const declared = (registered?.everyday_actions ?? []) as BindableActionId[];
    const verified = adapter && declared.includes("READ") ? (["READ"] as BindableActionId[]) : [];
    const owner_enabled = Boolean(policy && (policy.enabled_binding_ids.includes(application_id) || policy.enabled_binding_ids.includes("*")));
    const category = classifyApplicationCategory(bundle_id, display);
    const lifecycle = lifecycleFor(adapter, verified, owner_enabled, true);
    rows.push({
      schema: "MACHINE_CAPABILITY_INVENTORY_V1",
      machine_resource_id: application_id,
      resource_type: "APPLICATION",
      application_id,
      bundle_id,
      executable_identity: registered?.executable_identity ?? null,
      version: registered?.version ?? null,
      availability: registered?.availability ?? "AVAILABLE",
      adapter_available: adapter,
      connection_required: false,
      credential_ref_present: false,
      capabilities_declared: declared,
      capabilities_verified: verified,
      data_locations: registered?.data_scope ?? [],
      network_dependency: "LOCAL_ONLY",
      locality: "LOCAL",
      owner_authority_state: owner_enabled ? "ALLOW" : "DENY",
      lifecycle,
      last_verified_at: verified.length > 0 ? nowIso() : null,
      category,
    });
    emitLocalResourceEvent("APPLICATION_DISCOVERED", work_id, bundle_id, undefined, {
      session_id, resource_id: application_id, authority_decision: "DENY", locality: "LOCAL", action: "DISCOVER",
    });
    if (adapter) {
      emitLocalResourceEvent("APPLICATION_REGISTERED", work_id, application_id, undefined, {
        session_id, resource_id: application_id, authority_decision: owner_enabled ? "ALLOW" : "DENY", locality: "LOCAL",
      });
      emitLocalResourceEvent("CAPABILITY_DECLARED", work_id, declared.join(","), undefined, {
        session_id, resource_id: application_id, locality: "LOCAL",
      });
      if (verified.length > 0) {
        emitLocalResourceEvent("CAPABILITY_VERIFIED", work_id, verified.join(","), undefined, {
          session_id, resource_id: application_id, locality: "LOCAL",
        });
      }
    }
  }

  rows.push({
    schema: "MACHINE_CAPABILITY_INVENTORY_V1",
    machine_resource_id: "resource://local/files/fixture-corpus",
    resource_type: "FILE_SYSTEM",
    application_id: null,
    bundle_id: null,
    executable_identity: "macos-filesystem",
    version: "LOCAL_RESOURCE_V1",
    availability: "AVAILABLE",
    adapter_available: true,
    connection_required: false,
    credential_ref_present: false,
    capabilities_declared: ["SEARCH", "READ", "COPY", "SUMMARIZE", "EXTRACT"],
    capabilities_verified: ["SEARCH", "READ", "COPY", "SUMMARIZE", "EXTRACT"],
    data_locations: ["control/local-resource-access/fixtures/corpus"],
    network_dependency: "LOCAL_ONLY",
    locality: "LOCAL",
    owner_authority_state: "DENY",
    lifecycle: "CAPABILITY_VERIFIED",
    last_verified_at: nowIso(),
    category: "OTHER",
  });

  for (const service of listRemoteServiceBindings(ai_identity, session_id)) {
    const verified = service.canonical_action_mapping.filter((row) => row.states.RUNTIME_VERIFIED).map((row) => row.action);
    const declared = service.capabilities;
    const owner_enabled = service.owner_authority_state === "ALLOW";
    rows.push({
      schema: "MACHINE_CAPABILITY_INVENTORY_V1",
      machine_resource_id: service.service_id,
      resource_type: "REMOTE_SERVICE",
      application_id: null,
      bundle_id: null,
      executable_identity: service.provider,
      version: null,
      availability: service.availability === "BOUND" ? "AVAILABLE" : "UNAVAILABLE",
      adapter_available: service.canonical_action_mapping.some((row) => row.states.ADAPTER_PRESENT),
      connection_required: true,
      credential_ref_present: Boolean(service.credential_ref),
      capabilities_declared: declared,
      capabilities_verified: verified,
      data_locations: service.network_destinations,
      network_dependency: "OWNER_APPROVAL_REQUIRED",
      locality: "REMOTE",
      owner_authority_state: service.owner_authority_state,
      lifecycle: lifecycleFor(service.canonical_action_mapping.some((row) => row.states.ADAPTER_PRESENT), verified, owner_enabled, service.availability === "BOUND"),
      last_verified_at: null,
      category: "REMOTE",
    });
    emitLocalResourceEvent(service.availability === "BOUND" ? "REMOTE_SERVICE_BOUND" : service.availability === "NOT_AVAILABLE" ? "REMOTE_SERVICE_UNAVAILABLE" : "REMOTE_SERVICE_DISCOVERED", work_id, service.service_id, undefined, {
      session_id, resource_id: service.service_id, authority_decision: service.owner_authority_state, locality: "LOCAL",
    });
  }

  persist(rows);
  emitLocalResourceEvent("MACHINE_INVENTORY_REFRESHED", work_id, `count=${rows.length}`, undefined, {
    session_id, resource_id: "resource://local/inventory/machine", locality: "LOCAL", result_status: "COMPLETED",
  });
  return rows;
}

export function listApplicationInventory(ai_identity: string | null = null, session_id: string | null = null): readonly Record<string, unknown>[] {
  const policy = ai_identity && session_id ? matchingCapabilityBindingPolicy(ai_identity, session_id) : null;
  return listRegisteredApplications().map((app) => {
    const owner_enabled = Boolean(policy && (policy.enabled_binding_ids.includes(app.application_id) || policy.enabled_binding_ids.includes("*")));
    return {
      application_id: app.application_id,
      display_name: app.bundle_id,
      bundle_id: app.bundle_id,
      version: app.version,
      executable_identity: app.executable_identity,
      known_adapter: app.adapter,
      supported_canonical_actions: app.everyday_actions,
      verification_status: app.everyday_actions.includes("READ") ? "RUNTIME_VERIFIED" : "DECLARED",
      authority_status: owner_enabled ? "OWNER_ENABLED" : "DENY",
      usage_authorized: false,
      category: classifyApplicationCategory(app.bundle_id, app.bundle_id) as ApplicationCategory,
    };
  });
}

export function getApplicationCapabilities(application_id: string, ai_identity: string | null = null, session_id: string | null = null): Record<string, unknown> | null {
  const app = getRegisteredApplication(application_id);
  if (!app) return null;
  const policy = ai_identity && session_id ? matchingCapabilityBindingPolicy(ai_identity, session_id) : null;
  const owner_enabled = Boolean(policy && (policy.enabled_binding_ids.includes(application_id) || policy.enabled_binding_ids.includes("*")));
  return {
    application_id: app.application_id,
    everyday_actions: app.everyday_actions,
    allowed_actions: app.allowed_actions.map((row) => row.action_id),
    states: {
      DECLARED: true,
      ADAPTER_PRESENT: true,
      AUTHENTICATION_READY: true,
      RUNTIME_VERIFIED: app.everyday_actions.includes("READ"),
      OWNER_ENABLED: owner_enabled,
    },
    usage_authorized: false,
    owner_authority_state: owner_enabled ? "ALLOW" : "DENY",
  };
}

export function getCapabilityBindingStatus(binding_id: string, ai_identity: string, session_id: string): Record<string, unknown> {
  const app = getApplicationCapabilities(binding_id, ai_identity, session_id);
  if (app) return { binding_id, kind: "APPLICATION", ...app };
  const remote = getRemoteServiceBinding(binding_id, ai_identity, session_id);
  if (remote) return { binding_id, kind: "REMOTE_SERVICE", ...publicRemoteServiceView(remote) };
  return { binding_id, found: false, owner_authority_state: "DENY" };
}
