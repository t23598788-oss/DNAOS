/**
 * Adapter discovery and registry. Existence never grants authority.
 */

import { existsSync, readFileSync } from "node:fs";
import {
  discoverInstalledApplications,
  emitLocalResourceEvent,
  getRegisteredApplication,
  listRegisteredApplications,
  matchingCapabilityBindingPolicy,
} from "../local-resource-access/contract";
import { discoverDevices } from "./devices";
import { listPersistedAdapters, persistAdapters } from "./persist";
import type { LocalAppCapabilityRegistryV1, LocalToolAdapterV1 } from "./types";

function adapter(partial: Omit<LocalToolAdapterV1, "schema" | "grants_authority" | "evidence_policy">): LocalToolAdapterV1 {
  return {
    schema: "LOCAL_TOOL_ADAPTER_FABRIC_V1",
    grants_authority: false,
    evidence_policy: "LOCAL_EXECUTION_ENVELOPE",
    ...partial,
  };
}

function plistFlags(plistPath: string): { url_scheme: boolean; app_intent: boolean; shortcut: boolean } {
  if (!plistPath || !existsSync(plistPath)) return { url_scheme: false, app_intent: false, shortcut: false };
  const text = readFileSync(plistPath, "utf8");
  return {
    url_scheme: text.includes("CFBundleURLTypes"),
    app_intent: text.includes("NSUserActivityTypes") || text.includes("INIntentsSupported"),
    shortcut: text.includes("WFWorkflows") || text.includes("AppShortcuts"),
  };
}

function ownerEnabled(ai_identity: string, session_id: string, binding_id: string): boolean {
  const policy = matchingCapabilityBindingPolicy(ai_identity, session_id);
  if (!policy) return false;
  return policy.enabled_binding_ids.includes(binding_id) || policy.enabled_binding_ids.includes("*");
}

export function refreshLocalToolFabric(work_id: string, session_id: string, ai_identity: string): readonly LocalToolAdapterV1[] {
  const rows: LocalToolAdapterV1[] = [];
  const enabledTextedit = ownerEnabled(ai_identity, session_id, "app://macos/textedit");
  const enabledFiles = ownerEnabled(ai_identity, session_id, "resource://local/files/fixture-corpus");
  const enabledDisk = ownerEnabled(ai_identity, session_id, "resource://local/os/disk");
  const enabledNet = ownerEnabled(ai_identity, session_id, "resource://local/os/network");
  const textedit = getRegisteredApplication("app://macos/textedit");
  const flags = plistFlags(textedit?.data_scope[0] ?? "");

  rows.push(adapter({
    adapter_id: "adapter://app/textedit/file-interface",
    adapter_type: "FILE_INTERFACE",
    resource_id: "resource://local/app/textedit",
    application_id: "app://macos/textedit",
    service_id: null, device_id: null,
    discovery_source: "APPLICATION_RESOURCE_V1",
    transport: "plist-metadata",
    executable_or_endpoint_identity: textedit?.executable_identity ?? null,
    capabilities_declared: ["READ"],
    capabilities_verified: textedit?.availability === "AVAILABLE" ? ["READ"] : [],
    canonical_action_mapping: [{ native: "textedit.read_state", canonical: "READ" }],
    input_schema: { type: "object", properties: {} }, output_schema: { type: "object" },
    accepted_input_types: [], returned_output_types: ["APPLICATION_STATE"],
    resource_handles_accepted: [], resource_handles_returned: ["APPLICATION_STATE_HANDLE"],
    read_scope: textedit?.data_scope ?? [], write_scope: [], execute_scope: ["textedit.read_state"], network_scope: [],
    authority_required: "OWNER_GRANT", side_effect_class: "NONE",
    availability: enabledTextedit ? "OWNER_ENABLED" : (textedit?.availability === "AVAILABLE" ? "CAPABILITY_VERIFIED" : "UNAVAILABLE"),
    runtime_verified: textedit?.availability === "AVAILABLE",
    owner_enabled: enabledTextedit,
    gateway_capability: "local.app.invoke_registered_action",
  }));

  if (flags.url_scheme) {
    rows.push(adapter({
      adapter_id: "adapter://app/textedit/url-scheme", adapter_type: "URL_SCHEME",
      resource_id: "resource://local/app/textedit", application_id: "app://macos/textedit",
      service_id: null, device_id: null, discovery_source: "Info.plist", transport: "url-scheme",
      executable_or_endpoint_identity: textedit?.bundle_id ?? null,
      capabilities_declared: ["OPEN"], capabilities_verified: [],
      canonical_action_mapping: [{ native: "url.open", canonical: "OPEN" }],
      input_schema: { type: "object" }, output_schema: { type: "object" },
      accepted_input_types: ["URL"], returned_output_types: [],
      resource_handles_accepted: [], resource_handles_returned: [],
      read_scope: [], write_scope: [], execute_scope: [], network_scope: [],
      authority_required: "OWNER_GRANT", side_effect_class: "NONE",
      availability: "INTERFACE_FOUND", runtime_verified: false, owner_enabled: false, gateway_capability: null,
    }));
  }

  rows.push(adapter({
    adapter_id: "adapter://files/fixture-corpus/file-interface", adapter_type: "FILE_INTERFACE",
    resource_id: "resource://local/files/fixture-corpus", application_id: null, service_id: null, device_id: null,
    discovery_source: "LOCAL_RESOURCE_V1", transport: "filesystem-adapter",
    executable_or_endpoint_identity: "macos-filesystem",
    capabilities_declared: ["SEARCH", "READ", "COPY", "EXTRACT", "SUMMARIZE"],
    capabilities_verified: ["SEARCH", "READ", "COPY", "EXTRACT", "SUMMARIZE"],
    canonical_action_mapping: [
      { native: "local.files.search", canonical: "SEARCH" },
      { native: "local.file.read", canonical: "READ" },
      { native: "local.document.extract_text", canonical: "EXTRACT" },
      { native: "local.document.summarize", canonical: "SUMMARIZE" },
      { native: "local.file.copy", canonical: "COPY" },
    ],
    input_schema: { type: "object" }, output_schema: { type: "object" },
    accepted_input_types: ["QUERY", "DOCUMENT_HANDLE"], returned_output_types: ["SEARCH_HITS", "TEXT", "FILE_HANDLE"],
    resource_handles_accepted: ["FILE_HANDLE", "DOCUMENT_HANDLE"], resource_handles_returned: ["FILE_HANDLE", "DOCUMENT_HANDLE"],
    read_scope: ["control/local-resource-access/fixtures/corpus"], write_scope: [],
    execute_scope: ["SEARCH", "READ", "EXTRACT", "SUMMARIZE", "COPY"], network_scope: [],
    authority_required: "OWNER_GRANT", side_effect_class: "CREATE",
    availability: enabledFiles ? "OWNER_ENABLED" : "CAPABILITY_VERIFIED",
    runtime_verified: true, owner_enabled: enabledFiles, gateway_capability: "local.files.search",
  }));

  rows.push(adapter({
    adapter_id: "adapter://files/convert/unavailable", adapter_type: "PROCESS_GATE",
    resource_id: "resource://local/files/fixture-corpus", application_id: null, service_id: null, device_id: null,
    discovery_source: "document-adapter.convertRegistered", transport: "registered-job",
    executable_or_endpoint_identity: null,
    capabilities_declared: ["CONVERT"], capabilities_verified: [],
    canonical_action_mapping: [{ native: "local.document.convert_registered", canonical: "CONVERT" }],
    input_schema: { type: "object" }, output_schema: { type: "object" },
    accepted_input_types: ["DOCUMENT_HANDLE"], returned_output_types: ["PDF_HANDLE"],
    resource_handles_accepted: ["DOCUMENT_HANDLE"], resource_handles_returned: ["PDF_HANDLE"],
    read_scope: [], write_scope: [], execute_scope: [], network_scope: [],
    authority_required: "OWNER_GRANT", side_effect_class: "CREATE",
    availability: "UNAVAILABLE", runtime_verified: false, owner_enabled: false,
    gateway_capability: "local.document.convert_registered",
  }));

  rows.push(adapter({
    adapter_id: "adapter://compute/process-gate", adapter_type: "PROCESS_GATE",
    resource_id: "resource://local/compute/registered-jobs", application_id: null, service_id: null, device_id: null,
    discovery_source: "LOCAL_PROCESS_GATE_V1", transport: "process-gate",
    executable_or_endpoint_identity: "local.compute.true",
    capabilities_declared: ["COMPARE"], capabilities_verified: ["COMPARE"],
    canonical_action_mapping: [{ native: "local.compute.run_registered_job", canonical: "COMPARE" }],
    input_schema: { type: "object" }, output_schema: { type: "object" },
    accepted_input_types: ["JOB_ID"], returned_output_types: ["JOB_RESULT"],
    resource_handles_accepted: [], resource_handles_returned: ["EVIDENCE_HANDLE"],
    read_scope: [], write_scope: [], execute_scope: ["local.compute.true"], network_scope: [],
    authority_required: "OWNER_GRANT", side_effect_class: "NONE",
    availability: "CAPABILITY_VERIFIED", runtime_verified: true, owner_enabled: false,
    gateway_capability: "local.compute.run_registered_job",
  }));

  rows.push(adapter({
    adapter_id: "adapter://os/disk", adapter_type: "OS_SERVICE",
    resource_id: "resource://local/os/disk", application_id: null, service_id: "os://disk",
    device_id: "device://storage/this-machine", discovery_source: "OS_RESOURCE_V1",
    transport: "registered-os-inspect", executable_or_endpoint_identity: "local.os.df",
    capabilities_declared: ["READ"], capabilities_verified: ["READ"],
    canonical_action_mapping: [{ native: "local.system.disk.summary", canonical: "READ" }],
    input_schema: { type: "object" }, output_schema: { type: "object" },
    accepted_input_types: [], returned_output_types: ["STATUS"],
    resource_handles_accepted: [], resource_handles_returned: ["DEVICE_HANDLE"],
    read_scope: ["disk-summary"], write_scope: [], execute_scope: [], network_scope: [],
    authority_required: "OWNER_GRANT", side_effect_class: "NONE",
    availability: enabledDisk ? "OWNER_ENABLED" : "CAPABILITY_VERIFIED",
    runtime_verified: true, owner_enabled: enabledDisk, gateway_capability: "local.system.disk.summary",
  }));

  const enabledProc = ownerEnabled(ai_identity, session_id, "resource://local/os/process-table");
  const enabledMount = ownerEnabled(ai_identity, session_id, "resource://local/os/mounts");
  const enabledMetrics = ownerEnabled(ai_identity, session_id, "resource://local/os/metrics");

  rows.push(adapter({
    adapter_id: "adapter://os/process", adapter_type: "OS_SERVICE",
    resource_id: "resource://local/os/process-table", application_id: null, service_id: "os://process",
    device_id: null, discovery_source: "OS_RESOURCE_V1",
    transport: "registered-os-inspect", executable_or_endpoint_identity: "local.os.ps-list",
    capabilities_declared: ["READ"], capabilities_verified: ["READ"],
    canonical_action_mapping: [{ native: "local.system.process.list", canonical: "READ" }],
    input_schema: { type: "object" }, output_schema: { type: "object" },
    accepted_input_types: [], returned_output_types: ["STATUS"],
    resource_handles_accepted: [], resource_handles_returned: ["DEVICE_HANDLE"],
    read_scope: ["process-table"], write_scope: [], execute_scope: [], network_scope: [],
    authority_required: "OWNER_GRANT", side_effect_class: "NONE",
    availability: enabledProc ? "OWNER_ENABLED" : "CAPABILITY_VERIFIED",
    runtime_verified: true, owner_enabled: enabledProc, gateway_capability: "local.system.process.list",
  }));

  rows.push(adapter({
    adapter_id: "adapter://os/mounts", adapter_type: "OS_SERVICE",
    resource_id: "resource://local/os/mounts", application_id: null, service_id: "os://mounts",
    device_id: null, discovery_source: "OS_RESOURCE_V1",
    transport: "registered-os-inspect", executable_or_endpoint_identity: "local.os.mount",
    capabilities_declared: ["READ"], capabilities_verified: ["READ"],
    canonical_action_mapping: [{ native: "local.system.mount.list", canonical: "READ" }],
    input_schema: { type: "object" }, output_schema: { type: "object" },
    accepted_input_types: [], returned_output_types: ["STATUS"],
    resource_handles_accepted: [], resource_handles_returned: ["DEVICE_HANDLE"],
    read_scope: ["mount-status"], write_scope: [], execute_scope: [], network_scope: [],
    authority_required: "OWNER_GRANT", side_effect_class: "NONE",
    availability: enabledMount ? "OWNER_ENABLED" : "CAPABILITY_VERIFIED",
    runtime_verified: true, owner_enabled: enabledMount, gateway_capability: "local.system.mount.list",
  }));

  rows.push(adapter({
    adapter_id: "adapter://os/metrics", adapter_type: "OS_SERVICE",
    resource_id: "resource://local/os/metrics", application_id: null, service_id: "os://metrics",
    device_id: null, discovery_source: "OS_RESOURCE_V1",
    transport: "node:os", executable_or_endpoint_identity: "os.loadavg",
    capabilities_declared: ["READ"], capabilities_verified: ["READ"],
    canonical_action_mapping: [{ native: "local.system.resource_usage", canonical: "READ" }],
    input_schema: { type: "object" }, output_schema: { type: "object" },
    accepted_input_types: [], returned_output_types: ["STATUS"],
    resource_handles_accepted: [], resource_handles_returned: ["DEVICE_HANDLE"],
    read_scope: ["power-and-load"], write_scope: [], execute_scope: [], network_scope: [],
    authority_required: "OWNER_GRANT", side_effect_class: "NONE",
    availability: enabledMetrics ? "OWNER_ENABLED" : "CAPABILITY_VERIFIED",
    runtime_verified: true, owner_enabled: enabledMetrics, gateway_capability: "local.system.resource_usage",
  }));

  rows.push(adapter({
    adapter_id: "adapter://os/clipboard", adapter_type: "OS_SERVICE",
    resource_id: null, application_id: null, service_id: "os://clipboard", device_id: null,
    discovery_source: "OS_RESOURCE_V1", transport: "none",
    executable_or_endpoint_identity: null,
    capabilities_declared: ["READ"], capabilities_verified: [],
    canonical_action_mapping: [],
    input_schema: { type: "object" }, output_schema: { type: "object" },
    accepted_input_types: [], returned_output_types: [],
    resource_handles_accepted: [], resource_handles_returned: [],
    read_scope: [], write_scope: [], execute_scope: [], network_scope: [],
    authority_required: "OWNER_GRANT", side_effect_class: "NONE",
    availability: "UNSUPPORTED", runtime_verified: false, owner_enabled: false, gateway_capability: null,
  }));

  rows.push(adapter({
    adapter_id: "adapter://os/network", adapter_type: "OS_SERVICE",
    resource_id: "resource://local/os/network", application_id: null, service_id: "os://network",
    device_id: "device://network/this-machine", discovery_source: "OS_RESOURCE_V1",
    transport: "node:os.networkInterfaces", executable_or_endpoint_identity: "os.networkInterfaces",
    capabilities_declared: ["READ"], capabilities_verified: ["READ"],
    canonical_action_mapping: [{ native: "local.system.network.summary", canonical: "READ" }],
    input_schema: { type: "object" }, output_schema: { type: "object" },
    accepted_input_types: [], returned_output_types: ["STATUS"],
    resource_handles_accepted: [], resource_handles_returned: ["DEVICE_HANDLE"],
    read_scope: ["interface-names"], write_scope: [], execute_scope: [], network_scope: [],
    authority_required: "OWNER_GRANT", side_effect_class: "NONE",
    availability: enabledNet ? "OWNER_ENABLED" : "CAPABILITY_VERIFIED",
    runtime_verified: true, owner_enabled: enabledNet, gateway_capability: "local.system.network.summary",
  }));

  rows.push(adapter({
    adapter_id: "adapter://dna-os/webmcp", adapter_type: "WEBMCP",
    resource_id: null, application_id: null, service_id: "service://dna-os/circuit", device_id: null,
    discovery_source: "circuit-well-known-webmcp", transport: "http-loopback",
    executable_or_endpoint_identity: "/.well-known/webmcp.json",
    capabilities_declared: [], capabilities_verified: [], canonical_action_mapping: [],
    input_schema: { type: "object" }, output_schema: { type: "object" },
    accepted_input_types: [], returned_output_types: [],
    resource_handles_accepted: [], resource_handles_returned: [],
    read_scope: [], write_scope: [], execute_scope: [], network_scope: ["loopback"],
    authority_required: "OWNER_GRANT", side_effect_class: "NONE",
    availability: "DISCOVERED", runtime_verified: false, owner_enabled: false, gateway_capability: null,
  }));

  const discovered = discoverInstalledApplications(work_id, session_id);
  for (const app of discovered) {
    emitLocalResourceEvent("TOOL_DISCOVERED", work_id, String(app.bundle_id ?? ""), undefined, {
      session_id, resource_id: String(app.application_id ?? ""), authority_decision: "DENY", locality: "LOCAL",
    });
    if (app.known_adapter) continue;
    rows.push(adapter({
      adapter_id: `adapter://discovered/${String(app.bundle_id)}/none`,
      adapter_type: "ACCESSIBILITY_FALLBACK",
      resource_id: null, application_id: String(app.application_id), service_id: null, device_id: null,
      discovery_source: "installed-app-scan", transport: "none",
      executable_or_endpoint_identity: String(app.bundle_id),
      capabilities_declared: [], capabilities_verified: [], canonical_action_mapping: [],
      input_schema: { type: "object" }, output_schema: { type: "object" },
      accepted_input_types: [], returned_output_types: [],
      resource_handles_accepted: [], resource_handles_returned: [],
      read_scope: [], write_scope: [], execute_scope: [], network_scope: [],
      authority_required: "OWNER_APPROVAL_REQUIRED", side_effect_class: "NONE",
      availability: "UNSUPPORTED", runtime_verified: false, owner_enabled: false, gateway_capability: null,
    }));
  }

  discoverDevices(work_id, session_id);
  persistAdapters(rows);
  for (const row of rows) {
    emitLocalResourceEvent("ADAPTER_DISCOVERED", work_id, row.adapter_id, undefined, {
      session_id, resource_id: row.resource_id ?? undefined, locality: "LOCAL", action: row.adapter_type,
    });
    if (row.runtime_verified) {
      emitLocalResourceEvent("ADAPTER_REGISTERED", work_id, row.adapter_id, undefined, {
        session_id, resource_id: row.resource_id ?? undefined, locality: "LOCAL",
      });
      emitLocalResourceEvent("CAPABILITY_RUNTIME_VERIFIED", work_id, row.capabilities_verified.join(","), undefined, {
        session_id, resource_id: row.resource_id ?? undefined, locality: "LOCAL",
      });
    }
  }
  return rows;
}

export function listLocalTools(): readonly LocalToolAdapterV1[] {
  return listPersistedAdapters();
}

export function getLocalTool(adapter_id: string): LocalToolAdapterV1 | null {
  return listLocalTools().find((row) => row.adapter_id === adapter_id) ?? null;
}

export function listToolCapabilities(): readonly {
  readonly adapter_id: string;
  readonly adapter_type: LocalToolAdapterV1["adapter_type"];
  readonly capabilities_declared: readonly string[];
  readonly capabilities_verified: readonly string[];
  readonly canonical_actions: readonly string[];
  readonly owner_enabled: boolean;
  readonly availability: LocalToolAdapterV1["availability"];
}[] {
  return listLocalTools().map((row) => ({
    adapter_id: row.adapter_id,
    adapter_type: row.adapter_type,
    capabilities_declared: row.capabilities_declared,
    capabilities_verified: row.capabilities_verified,
    canonical_actions: row.capabilities_verified,
    owner_enabled: row.owner_enabled,
    availability: row.availability,
  }));
}

export function listLocalAppCapabilityRegistry(ai_identity: string, session_id: string, work_id: string): readonly LocalAppCapabilityRegistryV1[] {
  const adapters = listLocalTools().length ? listLocalTools() : refreshLocalToolFabric(work_id, session_id, ai_identity);
  const discovered = discoverInstalledApplications(work_id, session_id);
  const rows: { application_id: string; display_name: string; bundle: string; version: string | null }[] = [];
  const seen = new Set<string>();
  for (const app of listRegisteredApplications()) {
    seen.add(app.application_id);
    rows.push({
      application_id: app.application_id,
      display_name: app.bundle_id,
      bundle: app.bundle_id,
      version: app.version,
    });
  }
  for (const app of discovered) {
    const application_id = String(app.application_id);
    if (seen.has(application_id)) continue;
    seen.add(application_id);
    rows.push({
      application_id,
      display_name: String(app.name ?? app.bundle_id),
      bundle: String(app.bundle_id),
      version: typeof app.version === "string" ? app.version : null,
    });
  }
  return rows.map((app) => {
    const related = adapters.filter((row) => row.application_id === app.application_id);
    const verified = [...new Set(related.flatMap((row) => row.capabilities_verified))];
    return {
      schema: "LOCAL_APP_CAPABILITY_REGISTRY_V1",
      application_id: app.application_id,
      display_name: app.display_name,
      bundle_executable_identity: app.bundle,
      installed_version: app.version,
      available_adapter_types: related.filter((row) => row.availability !== "UNSUPPORTED").map((row) => row.adapter_type),
      verified_capabilities: verified,
      canonical_actions: verified,
      classification: verified.includes("READ") ? "READ" : "NONE",
      network_behavior: "LOCAL_ONLY",
      owner_authority_state: related.some((row) => row.owner_enabled) ? "ALLOW" : "DENY",
      runtime_availability: related.some((row) => row.runtime_verified) ? "AVAILABLE" : "DISCOVERED",
      category_does_not_imply_capability: true,
    };
  });
}
