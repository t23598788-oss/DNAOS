/**
 * Safe local capabilities — never execute_any_command / read_any_path / write_any_path / arbitrary shell.
 */

import type { LocalCapabilityDescriptor, LocalCapabilityName } from "./types";

const searchIn = {
  type: "object",
  properties: { query: { type: "string" }, max_matches: { type: "number" } },
  required: ["query"],
};
const logicalPathIn = {
  type: "object",
  properties: { logical_path: { type: "string" } },
  required: ["logical_path"],
};
const rangeIn = {
  type: "object",
  properties: { logical_path: { type: "string" }, start: { type: "number" }, length: { type: "number" } },
  required: ["logical_path"],
};
const jobIn = {
  type: "object",
  properties: { job_id: { type: "string" } },
  required: ["job_id"],
};
const emptyIn = { type: "object", properties: {} };
const refsOut = { type: "object", properties: { items: { type: "array" }, logical_refs: { type: "array" } } };

export const LOCAL_CAPABILITY_CATALOG: Readonly<Record<LocalCapabilityName, LocalCapabilityDescriptor>> = {
  "local.files.search": {
    capability: "local.files.search", input_schema: searchIn, output_schema: refsOut,
    required_authority: "OWNER_GRANT", allowed_resource_types: ["FILE_SYSTEM"],
    execution_classification: "LOCAL", possible_network_egress: "LOCAL_ONLY",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "READ",
  },
  "local.files.metadata": {
    capability: "local.files.metadata", input_schema: logicalPathIn, output_schema: { type: "object" },
    required_authority: "OWNER_GRANT", allowed_resource_types: ["FILE_SYSTEM"],
    execution_classification: "LOCAL", possible_network_egress: "LOCAL_ONLY",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "READ",
  },
  "local.files.read_range": {
    capability: "local.files.read_range", input_schema: rangeIn, output_schema: { type: "object" },
    required_authority: "OWNER_GRANT", allowed_resource_types: ["FILE_SYSTEM"],
    execution_classification: "LOCAL", possible_network_egress: "MINIMIZED_EXTERNAL",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "READ",
  },
  "local.workspace.create": {
    capability: "local.workspace.create", input_schema: { type: "object", properties: { resource_ids: { type: "array" } } }, output_schema: { type: "object" },
    required_authority: "OWNER_GRANT", allowed_resource_types: ["FILE_SYSTEM", "GIT_REPOSITORY", "LOCAL_COMPUTE"],
    execution_classification: "LOCAL", possible_network_egress: "LOCAL_ONLY",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "WRITE",
  },
  "local.workspace.inspect": {
    capability: "local.workspace.inspect", input_schema: emptyIn, output_schema: { type: "object" },
    required_authority: "OWNER_GRANT", allowed_resource_types: ["FILE_SYSTEM", "GIT_REPOSITORY"],
    execution_classification: "LOCAL", possible_network_egress: "LOCAL_ONLY",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "READ",
  },
  "local.workspace.list_results": {
    capability: "local.workspace.list_results", input_schema: emptyIn, output_schema: refsOut,
    required_authority: "OWNER_GRANT", allowed_resource_types: ["FILE_SYSTEM", "GIT_REPOSITORY"],
    execution_classification: "LOCAL", possible_network_egress: "LOCAL_ONLY",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "READ",
  },
  "local.git.status": {
    capability: "local.git.status", input_schema: emptyIn, output_schema: refsOut,
    required_authority: "OWNER_GRANT", allowed_resource_types: ["GIT_REPOSITORY"],
    execution_classification: "LOCAL", possible_network_egress: "LOCAL_ONLY",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "READ",
  },
  "local.git.diff": {
    capability: "local.git.diff", input_schema: emptyIn, output_schema: refsOut,
    required_authority: "OWNER_GRANT", allowed_resource_types: ["GIT_REPOSITORY"],
    execution_classification: "LOCAL", possible_network_egress: "LOCAL_ONLY",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "READ",
  },
  "local.git.search": {
    capability: "local.git.search", input_schema: searchIn, output_schema: refsOut,
    required_authority: "OWNER_GRANT", allowed_resource_types: ["GIT_REPOSITORY"],
    execution_classification: "LOCAL", possible_network_egress: "LOCAL_ONLY",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "READ",
  },
  "local.compute.run_registered_job": {
    capability: "local.compute.run_registered_job", input_schema: jobIn, output_schema: { type: "object" },
    required_authority: "OWNER_GRANT", allowed_resource_types: ["LOCAL_COMPUTE"],
    execution_classification: "LOCAL", possible_network_egress: "LOCAL_ONLY",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "EXECUTE",
  },
  "local.app.list_registered": {
    capability: "local.app.list_registered", input_schema: emptyIn, output_schema: refsOut,
    required_authority: "OWNER_GRANT", allowed_resource_types: ["APPLICATION"],
    execution_classification: "LOCAL", possible_network_egress: "LOCAL_ONLY",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "READ",
  },
  "local.app.discover_installed": {
    capability: "local.app.discover_installed", input_schema: emptyIn, output_schema: refsOut,
    required_authority: "OWNER_GRANT", allowed_resource_types: ["APPLICATION"],
    execution_classification: "LOCAL", possible_network_egress: "LOCAL_ONLY",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "READ",
  },
  "local.app.invoke_registered_action": {
    capability: "local.app.invoke_registered_action", input_schema: { type: "object", properties: { action_id: { type: "string" }, application_id: { type: "string" } }, required: ["action_id"] }, output_schema: { type: "object" },
    required_authority: "OWNER_GRANT", allowed_resource_types: ["APPLICATION"],
    execution_classification: "LOCAL", possible_network_egress: "LOCAL_ONLY",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "EXECUTE",
  },
  "local.resource.list": {
    capability: "local.resource.list", input_schema: emptyIn, output_schema: refsOut,
    required_authority: "OWNER_GRANT", allowed_resource_types: ["FILE_SYSTEM", "APPLICATION", "DATABASE", "LOCAL_COMPUTE", "GIT_REPOSITORY", "DEVICE", "LOCAL_SERVICE", "PROCESS", "PORT", "NETWORK_INTERFACE", "DISK", "MOUNT", "SYSTEM_METRIC", "INVENTORY", "REMOTE_SERVICE"],
    execution_classification: "LOCAL", possible_network_egress: "LOCAL_ONLY",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "READ",
  },
  "local.resource.capabilities": {
    capability: "local.resource.capabilities", input_schema: emptyIn, output_schema: refsOut,
    required_authority: "OWNER_GRANT", allowed_resource_types: ["FILE_SYSTEM", "APPLICATION", "DATABASE", "LOCAL_COMPUTE", "GIT_REPOSITORY", "DEVICE", "LOCAL_SERVICE", "PROCESS", "PORT", "NETWORK_INTERFACE", "DISK", "MOUNT", "SYSTEM_METRIC", "INVENTORY", "REMOTE_SERVICE"],
    execution_classification: "LOCAL", possible_network_egress: "LOCAL_ONLY",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "READ",
  },
  "local.resource.status": {
    capability: "local.resource.status", input_schema: emptyIn, output_schema: { type: "object" },
    required_authority: "OWNER_GRANT", allowed_resource_types: ["FILE_SYSTEM", "APPLICATION", "DATABASE", "LOCAL_COMPUTE", "GIT_REPOSITORY", "DEVICE", "LOCAL_SERVICE", "PROCESS", "PORT", "NETWORK_INTERFACE", "DISK", "MOUNT", "SYSTEM_METRIC", "INVENTORY", "REMOTE_SERVICE"],
    execution_classification: "LOCAL", possible_network_egress: "LOCAL_ONLY",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "READ",
  },
  "local.system.process.list": {
    capability: "local.system.process.list", input_schema: emptyIn, output_schema: refsOut,
    required_authority: "OWNER_GRANT", allowed_resource_types: ["PROCESS"],
    execution_classification: "LOCAL", possible_network_egress: "LOCAL_ONLY",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "READ",
  },
  "local.system.process.inspect": {
    capability: "local.system.process.inspect", input_schema: { type: "object", properties: { pid: { type: "string" } }, required: ["pid"] }, output_schema: { type: "object" },
    required_authority: "OWNER_GRANT", allowed_resource_types: ["PROCESS"],
    execution_classification: "LOCAL", possible_network_egress: "LOCAL_ONLY",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "READ",
  },
  "local.system.port.list": {
    capability: "local.system.port.list", input_schema: emptyIn, output_schema: refsOut,
    required_authority: "OWNER_GRANT", allowed_resource_types: ["PORT"],
    execution_classification: "LOCAL", possible_network_egress: "LOCAL_ONLY",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "READ",
  },
  "local.system.network.summary": {
    capability: "local.system.network.summary", input_schema: emptyIn, output_schema: { type: "object" },
    required_authority: "OWNER_GRANT", allowed_resource_types: ["NETWORK_INTERFACE"],
    execution_classification: "LOCAL", possible_network_egress: "LOCAL_ONLY",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "READ",
  },
  "local.system.disk.summary": {
    capability: "local.system.disk.summary", input_schema: emptyIn, output_schema: { type: "object" },
    required_authority: "OWNER_GRANT", allowed_resource_types: ["DISK"],
    execution_classification: "LOCAL", possible_network_egress: "LOCAL_ONLY",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "READ",
  },
  "local.system.mount.list": {
    capability: "local.system.mount.list", input_schema: emptyIn, output_schema: refsOut,
    required_authority: "OWNER_GRANT", allowed_resource_types: ["MOUNT"],
    execution_classification: "LOCAL", possible_network_egress: "LOCAL_ONLY",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "READ",
  },
  "local.system.service.status": {
    capability: "local.system.service.status", input_schema: emptyIn, output_schema: { type: "object" },
    required_authority: "OWNER_GRANT", allowed_resource_types: ["LOCAL_SERVICE"],
    execution_classification: "LOCAL", possible_network_egress: "LOCAL_ONLY",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "READ",
  },
  "local.system.resource_usage": {
    capability: "local.system.resource_usage", input_schema: emptyIn, output_schema: { type: "object" },
    required_authority: "OWNER_GRANT", allowed_resource_types: ["SYSTEM_METRIC"],
    execution_classification: "LOCAL", possible_network_egress: "LOCAL_ONLY",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "READ",
  },
  "local.file.read": {
    capability: "local.file.read", input_schema: rangeIn, output_schema: { type: "object" },
    required_authority: "OWNER_GRANT", allowed_resource_types: ["FILE_SYSTEM"],
    execution_classification: "LOCAL", possible_network_egress: "MINIMIZED_EXTERNAL",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "READ",
  },
  "local.file.create": {
    capability: "local.file.create", input_schema: { type: "object", properties: { logical_path: { type: "string" }, content: { type: "string" } }, required: ["logical_path"] }, output_schema: { type: "object" },
    required_authority: "OWNER_GRANT", allowed_resource_types: ["FILE_SYSTEM"],
    execution_classification: "LOCAL", possible_network_egress: "LOCAL_ONLY",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "CREATE",
  },
  "local.file.copy": {
    capability: "local.file.copy", input_schema: { type: "object", properties: { source_logical: { type: "string" }, destination_logical: { type: "string" }, destination_resource_id: { type: "string" } }, required: ["source_logical", "destination_logical"] }, output_schema: { type: "object" },
    required_authority: "OWNER_GRANT", allowed_resource_types: ["FILE_SYSTEM"],
    execution_classification: "LOCAL", possible_network_egress: "LOCAL_ONLY",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "CREATE",
  },
  "local.file.move": {
    capability: "local.file.move", input_schema: { type: "object", properties: { source_logical: { type: "string" }, destination_logical: { type: "string" }, destination_resource_id: { type: "string" } }, required: ["source_logical", "destination_logical"] }, output_schema: { type: "object" },
    required_authority: "OWNER_GRANT", allowed_resource_types: ["FILE_SYSTEM"],
    execution_classification: "LOCAL", possible_network_egress: "LOCAL_ONLY",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "MOVE",
  },
  "local.file.rename": {
    capability: "local.file.rename", input_schema: { type: "object", properties: { source_logical: { type: "string" }, destination_logical: { type: "string" } }, required: ["source_logical", "destination_logical"] }, output_schema: { type: "object" },
    required_authority: "OWNER_GRANT", allowed_resource_types: ["FILE_SYSTEM"],
    execution_classification: "LOCAL", possible_network_egress: "LOCAL_ONLY",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "MOVE",
  },
  "local.file.delete": {
    capability: "local.file.delete", input_schema: logicalPathIn, output_schema: { type: "object" },
    required_authority: "OWNER_APPROVAL_REQUIRED", allowed_resource_types: ["FILE_SYSTEM"],
    execution_classification: "LOCAL", possible_network_egress: "LOCAL_ONLY",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "DELETE",
  },
  "local.folder.create": {
    capability: "local.folder.create", input_schema: logicalPathIn, output_schema: { type: "object" },
    required_authority: "OWNER_GRANT", allowed_resource_types: ["FILE_SYSTEM"],
    execution_classification: "LOCAL", possible_network_egress: "LOCAL_ONLY",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "CREATE",
  },
  "local.folder.list": {
    capability: "local.folder.list", input_schema: { type: "object", properties: { logical_path: { type: "string" } } }, output_schema: refsOut,
    required_authority: "OWNER_GRANT", allowed_resource_types: ["FILE_SYSTEM"],
    execution_classification: "LOCAL", possible_network_egress: "LOCAL_ONLY",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "READ",
  },
  "local.folder.search": {
    capability: "local.folder.search", input_schema: searchIn, output_schema: refsOut,
    required_authority: "OWNER_GRANT", allowed_resource_types: ["FILE_SYSTEM"],
    execution_classification: "LOCAL", possible_network_egress: "LOCAL_ONLY",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "READ",
  },
  "local.document.extract_text": {
    capability: "local.document.extract_text", input_schema: logicalPathIn, output_schema: { type: "object" },
    required_authority: "OWNER_GRANT", allowed_resource_types: ["FILE_SYSTEM"],
    execution_classification: "LOCAL", possible_network_egress: "LOCAL_ONLY",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "READ",
  },
  "local.document.metadata": {
    capability: "local.document.metadata", input_schema: logicalPathIn, output_schema: { type: "object" },
    required_authority: "OWNER_GRANT", allowed_resource_types: ["FILE_SYSTEM"],
    execution_classification: "LOCAL", possible_network_egress: "LOCAL_ONLY",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "READ",
  },
  "local.pdf.extract_text": {
    capability: "local.pdf.extract_text", input_schema: logicalPathIn, output_schema: { type: "object" },
    required_authority: "OWNER_GRANT", allowed_resource_types: ["FILE_SYSTEM"],
    execution_classification: "LOCAL", possible_network_egress: "LOCAL_ONLY",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "READ",
  },
  "local.pdf.metadata": {
    capability: "local.pdf.metadata", input_schema: logicalPathIn, output_schema: { type: "object" },
    required_authority: "OWNER_GRANT", allowed_resource_types: ["FILE_SYSTEM"],
    execution_classification: "LOCAL", possible_network_egress: "LOCAL_ONLY",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "READ",
  },
  "local.image.metadata": {
    capability: "local.image.metadata", input_schema: logicalPathIn, output_schema: { type: "object" },
    required_authority: "OWNER_GRANT", allowed_resource_types: ["FILE_SYSTEM"],
    execution_classification: "LOCAL", possible_network_egress: "LOCAL_ONLY",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "READ",
  },
  "local.image.convert_registered": {
    capability: "local.image.convert_registered", input_schema: logicalPathIn, output_schema: { type: "object" },
    required_authority: "OWNER_GRANT", allowed_resource_types: ["FILE_SYSTEM"],
    execution_classification: "LOCAL", possible_network_egress: "LOCAL_ONLY",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "CREATE",
  },
  "local.document.convert_registered": {
    capability: "local.document.convert_registered", input_schema: logicalPathIn, output_schema: { type: "object" },
    required_authority: "OWNER_GRANT", allowed_resource_types: ["FILE_SYSTEM"],
    execution_classification: "LOCAL", possible_network_egress: "LOCAL_ONLY",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "CREATE",
  },
  "local.document.summarize": {
    capability: "local.document.summarize", input_schema: logicalPathIn, output_schema: { type: "object" },
    required_authority: "OWNER_GRANT", allowed_resource_types: ["FILE_SYSTEM"],
    execution_classification: "LOCAL", possible_network_egress: "MINIMIZED_EXTERNAL",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "READ",
  },
  "local.file.share_external": {
    capability: "local.file.share_external", input_schema: logicalPathIn, output_schema: { type: "object" },
    required_authority: "OWNER_APPROVAL_REQUIRED", allowed_resource_types: ["FILE_SYSTEM"],
    execution_classification: "LOCAL", possible_network_egress: "DENIED",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "SHARE_EXTERNAL",
  },
  "local.file.publish_external": {
    capability: "local.file.publish_external", input_schema: logicalPathIn, output_schema: { type: "object" },
    required_authority: "OWNER_APPROVAL_REQUIRED", allowed_resource_types: ["FILE_SYSTEM"],
    execution_classification: "LOCAL", possible_network_egress: "DENIED",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "PUBLISH_EXTERNAL",
  },
  "local.inventory.refresh": {
    capability: "local.inventory.refresh", input_schema: emptyIn, output_schema: { type: "object" },
    required_authority: "OWNER_GRANT", allowed_resource_types: ["INVENTORY"],
    execution_classification: "LOCAL", possible_network_egress: "LOCAL_ONLY",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "READ",
  },
  "local.inventory.get": {
    capability: "local.inventory.get", input_schema: emptyIn, output_schema: { type: "object" },
    required_authority: "OWNER_GRANT", allowed_resource_types: ["INVENTORY"],
    execution_classification: "LOCAL", possible_network_egress: "LOCAL_ONLY",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "READ",
  },
  "local.capability.route": {
    capability: "local.capability.route", input_schema: { type: "object", properties: { action: { type: "string" }, required_locality: { type: "string" } }, required: ["action"] }, output_schema: { type: "object" },
    required_authority: "OWNER_GRANT", allowed_resource_types: ["INVENTORY"],
    execution_classification: "LOCAL", possible_network_egress: "LOCAL_ONLY",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "READ",
  },
  "local.remote.github.read_identity": {
    capability: "local.remote.github.read_identity", input_schema: emptyIn, output_schema: { type: "object" },
    required_authority: "OWNER_GRANT", allowed_resource_types: ["REMOTE_SERVICE"],
    execution_classification: "LOCAL", possible_network_egress: "MINIMIZED_EXTERNAL",
    evidence_produced: "DNA_OS_LOCAL_EXECUTION", access_class: "READ",
  },
};

export const FORBIDDEN_CAPABILITY_NAMES = [
  "execute_any_command",
  "read_any_path",
  "write_any_path",
  "arbitrary_shell",
  "arbitrary_applescript",
  "unrestricted_process_execution",
  "sudo",
  "kill_any_process",
  "chmod_any_path",
  "arbitrary_ui_scripting",
] as const;

export function getLocalCapability(name: string): LocalCapabilityDescriptor | null {
  if (!(name in LOCAL_CAPABILITY_CATALOG)) return null;
  return LOCAL_CAPABILITY_CATALOG[name as LocalCapabilityName];
}

export function listLocalCapabilities(): readonly LocalCapabilityDescriptor[] {
  return Object.values(LOCAL_CAPABILITY_CATALOG);
}
