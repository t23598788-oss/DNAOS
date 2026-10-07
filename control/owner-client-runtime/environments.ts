/**
 * OWNER_RESOURCE_ENVIRONMENT_V1 — where Owner data/compute lives.
 * AI provider infrastructure is never an Owner environment.
 */

import { listRegisteredLocalResources, publicResourceView } from "../local-resource-access/contract";
import type { OwnerResourceEnvironmentV1 } from "./types";

const LOCAL_MACHINE: OwnerResourceEnvironmentV1 = {
  schema: "OWNER_RESOURCE_ENVIRONMENT_V1",
  environment_id: "env://local-machine",
  owner_id: "DNA_OS_OWNER",
  environment_type: "LOCAL_MACHINE",
  machine_server_identity: "this-machine",
  resource_bindings: [],
  compute_capabilities: ["SEARCH", "READ", "DIFF", "HASH", "TEST", "CONVERT"],
  storage_capabilities: ["FILE_SYSTEM"],
  application_capabilities: ["READ"],
  network_policy: "LOCAL_ONLY",
  locality: "THIS_MACHINE",
  availability: "AVAILABLE",
  authority_boundary: "OWNER",
  ai_provider_infrastructure: false,
};

const OWNER_SERVER: OwnerResourceEnvironmentV1 = {
  schema: "OWNER_RESOURCE_ENVIRONMENT_V1",
  environment_id: "env://owner-server",
  owner_id: "DNA_OS_OWNER",
  environment_type: "OWNER_SERVER",
  machine_server_identity: null,
  resource_bindings: [],
  compute_capabilities: [],
  storage_capabilities: [],
  application_capabilities: [],
  network_policy: "DENIED",
  locality: "NONE",
  availability: "NOT_AVAILABLE",
  authority_boundary: "OWNER",
  ai_provider_infrastructure: false,
};

const REMOTE_OWNER: OwnerResourceEnvironmentV1 = {
  ...OWNER_SERVER,
  environment_id: "env://remote-owner-machine",
  environment_type: "REMOTE_OWNER_MACHINE",
};

export function listOwnerEnvironments(): readonly OwnerResourceEnvironmentV1[] {
  const bindings = listRegisteredLocalResources().map((row) => publicResourceView(row).resource_id).map(String);
  return [
    { ...LOCAL_MACHINE, resource_bindings: bindings },
    OWNER_SERVER,
    REMOTE_OWNER,
  ].sort((a, b) => a.environment_id.localeCompare(b.environment_id));
}

export function getOwnerEnvironment(environment_id: string): OwnerResourceEnvironmentV1 | null {
  return listOwnerEnvironments().find((row) => row.environment_id === environment_id) ?? null;
}

export function environmentForResource(resource_id: string): OwnerResourceEnvironmentV1 {
  const local = listOwnerEnvironments().find((row) => row.environment_id === "env://local-machine")!;
  if (local.resource_bindings.includes(resource_id) || resource_id.startsWith("resource://local/")) return local;
  return OWNER_SERVER;
}
