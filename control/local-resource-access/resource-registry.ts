/**
 * Explicit local resource registry. Never auto-registers the whole machine.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { dataPath, nowIso, repoRoot } from "./host-runtime";
import type { LocalCapabilityName, LocalResourceType, LocalResourceV1 } from "./types";

function osResource(
  resource_id: string,
  resource_type: LocalResourceType,
  capabilities: readonly LocalCapabilityName[],
  execute_scope: readonly string[],
): LocalResourceV1 {
  return {
    schema: "OS_RESOURCE_V1",
    resource_id,
    resource_type,
    provider: "macos-host",
    machine_scope: "THIS_MACHINE",
    capabilities: [...capabilities, "local.resource.list", "local.resource.capabilities", "local.resource.status"],
    availability: "AVAILABLE",
    authority_required: "OWNER_GRANT",
    data_classification: "INTERNAL",
    locality: "THIS_MACHINE",
    network_egress_policy: "LOCAL_ONLY",
    read_scope: [],
    write_scope: [],
    execute_scope,
    workspace_required: false,
    cost_class: "TRIVIAL",
    evidence_policy: "LOCAL_EXECUTION_ENVELOPE",
    logical_root: resource_id,
  };
}

function registryFile(): string {
  return dataPath("local-resources.jsonl", "LOCAL_RESOURCE_REGISTRY_LOG");
}

const FIXTURE_CORPUS = "control/local-resource-access/fixtures/corpus";
const FIXTURE_WRITABLE = "control/local-resource-access/fixtures/writable";

const FILE_READ_ACTIONS: readonly LocalCapabilityName[] = [
  "local.files.search", "local.files.metadata", "local.files.read_range",
  "local.file.read", "local.file.copy", "local.folder.list", "local.folder.search",
  "local.document.extract_text", "local.document.metadata", "local.pdf.extract_text", "local.pdf.metadata",
  "local.image.metadata", "local.image.convert_registered", "local.document.convert_registered",
  "local.document.summarize", "local.file.share_external", "local.file.publish_external",
  "local.resource.list", "local.resource.capabilities", "local.resource.status",
  "local.workspace.create", "local.workspace.inspect", "local.workspace.list_results",
];

const FILE_WRITE_ACTIONS: readonly LocalCapabilityName[] = [
  ...FILE_READ_ACTIONS,
  "local.file.create", "local.file.move", "local.file.rename", "local.file.delete", "local.folder.create",
];

function builtinResources(): readonly LocalResourceV1[] {
  return [
    {
      schema: "LOCAL_RESOURCE_V1",
      resource_id: "resource://local/files/fixture-corpus",
      resource_type: "FILE_SYSTEM",
      provider: "macos-filesystem",
      machine_scope: "THIS_MACHINE",
      capabilities: FILE_READ_ACTIONS,
      availability: "AVAILABLE",
      authority_required: "OWNER_GRANT",
      data_classification: "INTERNAL",
      locality: "REGISTERED_WORKSPACE",
      network_egress_policy: "LOCAL_ONLY",
      read_scope: [FIXTURE_CORPUS],
      write_scope: [],
      execute_scope: [],
      workspace_required: true,
      cost_class: "TRIVIAL",
      evidence_policy: "LOCAL_EXECUTION_ENVELOPE",
      logical_root: FIXTURE_CORPUS,
    },
    {
      schema: "LOCAL_RESOURCE_V1",
      resource_id: "resource://local/files/fixture-writable",
      resource_type: "FILE_SYSTEM",
      provider: "macos-filesystem",
      machine_scope: "THIS_MACHINE",
      capabilities: FILE_WRITE_ACTIONS,
      availability: "AVAILABLE",
      authority_required: "OWNER_GRANT",
      data_classification: "INTERNAL",
      locality: "REGISTERED_WORKSPACE",
      network_egress_policy: "LOCAL_ONLY",
      read_scope: [FIXTURE_WRITABLE],
      write_scope: [FIXTURE_WRITABLE],
      execute_scope: [],
      workspace_required: true,
      cost_class: "TRIVIAL",
      evidence_policy: "LOCAL_EXECUTION_ENVELOPE",
      logical_root: FIXTURE_WRITABLE,
    },
    {
      schema: "LOCAL_RESOURCE_V1",
      resource_id: "resource://local/git/fixture-corpus",
      resource_type: "GIT_REPOSITORY",
      provider: "local-git",
      machine_scope: "THIS_MACHINE",
      capabilities: ["local.git.status", "local.git.diff", "local.git.search", "local.resource.list", "local.resource.capabilities", "local.resource.status", "local.workspace.create", "local.workspace.inspect"],
      availability: "AVAILABLE",
      authority_required: "OWNER_GRANT",
      data_classification: "INTERNAL",
      locality: "REGISTERED_WORKSPACE",
      network_egress_policy: "LOCAL_ONLY",
      read_scope: [FIXTURE_CORPUS],
      write_scope: [],
      execute_scope: [],
      workspace_required: false,
      cost_class: "TRIVIAL",
      evidence_policy: "LOCAL_EXECUTION_ENVELOPE",
      logical_root: FIXTURE_CORPUS,
    },
    {
      schema: "LOCAL_RESOURCE_V1",
      resource_id: "resource://local/compute/registered-jobs",
      resource_type: "LOCAL_COMPUTE",
      provider: "execution-process-gate",
      machine_scope: "THIS_MACHINE",
      capabilities: ["local.compute.run_registered_job", "local.resource.list", "local.resource.capabilities", "local.resource.status"],
      availability: "AVAILABLE",
      authority_required: "OWNER_GRANT",
      data_classification: "INTERNAL",
      locality: "THIS_MACHINE",
      network_egress_policy: "LOCAL_ONLY",
      read_scope: [],
      write_scope: [],
      execute_scope: ["local.compute.true"],
      workspace_required: false,
      cost_class: "LOCAL_CPU",
      evidence_policy: "LOCAL_EXECUTION_ENVELOPE",
      logical_root: "local-compute://registered",
    },
    osResource("resource://local/os/process-table", "PROCESS", ["local.system.process.list", "local.system.process.inspect"], ["local.os.ps-list", "local.os.ps-inspect"]),
    osResource("resource://local/os/ports", "PORT", ["local.system.port.list"], ["local.os.lsof-listen"]),
    osResource("resource://local/os/network", "NETWORK_INTERFACE", ["local.system.network.summary"], []),
    osResource("resource://local/os/disk", "DISK", ["local.system.disk.summary"], ["local.os.df"]),
    osResource("resource://local/os/mounts", "MOUNT", ["local.system.mount.list"], ["local.os.mount"]),
    osResource("resource://local/os/metrics", "SYSTEM_METRIC", ["local.system.resource_usage"], []),
    osResource("resource://local/os/service/dna-os", "LOCAL_SERVICE", ["local.system.service.status"], []),
    {
      schema: "OS_RESOURCE_V1",
      resource_id: "resource://local/inventory/machine",
      resource_type: "INVENTORY",
      provider: "macos-host",
      machine_scope: "THIS_MACHINE",
      capabilities: ["local.inventory.refresh", "local.inventory.get", "local.capability.route", "local.resource.list", "local.resource.capabilities", "local.resource.status"],
      availability: "AVAILABLE",
      authority_required: "OWNER_GRANT",
      data_classification: "INTERNAL",
      locality: "THIS_MACHINE",
      network_egress_policy: "LOCAL_ONLY",
      read_scope: [],
      write_scope: [],
      execute_scope: [],
      workspace_required: false,
      cost_class: "TRIVIAL",
      evidence_policy: "LOCAL_EXECUTION_ENVELOPE",
      logical_root: "inventory://machine",
    },
    {
      schema: "OS_RESOURCE_V1",
      resource_id: "resource://local/remote/github",
      resource_type: "REMOTE_SERVICE",
      provider: "github",
      machine_scope: "THIS_MACHINE",
      capabilities: ["local.remote.github.read_identity", "local.resource.status"],
      availability: "AVAILABLE",
      authority_required: "OWNER_GRANT",
      data_classification: "INTERNAL",
      locality: "THIS_MACHINE",
      network_egress_policy: "MINIMIZED_EXTERNAL",
      read_scope: [],
      write_scope: [],
      execute_scope: ["local.remote.github.read_identity"],
      workspace_required: false,
      cost_class: "OWNER_REVIEW",
      evidence_policy: "LOCAL_EXECUTION_ENVELOPE",
      logical_root: "remote://github",
    },
    {
      schema: "OS_RESOURCE_V1",
      resource_id: "resource://local/app/registry",
      resource_type: "APPLICATION",
      provider: "macos-application",
      machine_scope: "THIS_MACHINE",
      capabilities: ["local.app.list_registered", "local.app.discover_installed", "local.resource.list", "local.resource.status"],
      availability: "AVAILABLE",
      authority_required: "OWNER_GRANT",
      data_classification: "INTERNAL",
      locality: "THIS_MACHINE",
      network_egress_policy: "LOCAL_ONLY",
      read_scope: [],
      write_scope: [],
      execute_scope: [],
      workspace_required: false,
      cost_class: "TRIVIAL",
      evidence_policy: "LOCAL_EXECUTION_ENVELOPE",
      logical_root: "application://registry",
    },
    {
      schema: "OS_RESOURCE_V1",
      resource_id: "resource://local/app/textedit",
      resource_type: "APPLICATION",
      provider: "macos-application",
      machine_scope: "THIS_MACHINE",
      capabilities: ["local.app.list_registered", "local.app.invoke_registered_action", "local.resource.status"],
      availability: "AVAILABLE",
      authority_required: "OWNER_GRANT",
      data_classification: "INTERNAL",
      locality: "THIS_MACHINE",
      network_egress_policy: "LOCAL_ONLY",
      read_scope: [],
      write_scope: [],
      execute_scope: ["textedit.read_state"],
      workspace_required: false,
      cost_class: "TRIVIAL",
      evidence_policy: "LOCAL_EXECUTION_ENVELOPE",
      logical_root: "application://textedit",
    },
  ];
}

export function registerLocalResource(resource: LocalResourceV1): LocalResourceV1 {
  const p = registryFile();
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, `${JSON.stringify({ ...resource, registered_at: nowIso() })}\n`, "utf8");
  return resource;
}

export function listRegisteredLocalResources(): readonly LocalResourceV1[] {
  const latest = new Map<string, LocalResourceV1>();
  for (const row of builtinResources()) latest.set(row.resource_id, row);
  const p = registryFile();
  if (existsSync(p)) {
    for (const line of readFileSync(p, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line) as LocalResourceV1;
        latest.set(row.resource_id, row);
      } catch {
        /* skip */
      }
    }
  }
  return [...latest.values()];
}

export function getRegisteredLocalResource(resourceId: string): LocalResourceV1 | null {
  return listRegisteredLocalResources().find((row) => row.resource_id === resourceId) ?? null;
}

export function resourceAbsoluteRoot(resource: LocalResourceV1): string | null {
  if (resource.resource_type !== "FILE_SYSTEM" && resource.resource_type !== "GIT_REPOSITORY") return null;
  if (resource.logical_root.includes("://")) return null;
  if (resource.logical_root.startsWith("/")) return resource.logical_root;
  return `${repoRoot()}/${resource.logical_root}`.replaceAll("//", "/");
}

export function publicResourceView(resource: LocalResourceV1): Record<string, unknown> {
  return {
    schema: resource.schema,
    resource_id: resource.resource_id,
    resource_type: resource.resource_type,
    provider: resource.provider,
    machine_scope: resource.machine_scope,
    capabilities: resource.capabilities,
    availability: resource.availability,
    authority_required: resource.authority_required,
    data_classification: resource.data_classification,
    locality: resource.locality,
    network_egress_policy: resource.network_egress_policy,
    read_scope: resource.read_scope,
    write_scope: resource.write_scope,
    execute_scope: resource.execute_scope,
    workspace_required: resource.workspace_required,
    cost_class: resource.cost_class,
    evidence_policy: resource.evidence_policy,
    logical_root: resource.logical_root,
  };
}
