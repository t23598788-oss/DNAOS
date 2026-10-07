/**
 * RESOURCE_HANDLE_V1 — logical references. No raw source copy required to request work.
 */

import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { emitLocalResourceEvent, filesMetadata, getRegisteredLocalResource } from "../local-resource-access/contract";
import { environmentForResource } from "./environments";
import { nowIso, utf8Bytes } from "./host-runtime";
import { listPersistedHandles, persistHandle } from "./persist";
import type { ResourceHandleV1 } from "./types";

export function listResourceHandles(): readonly ResourceHandleV1[] {
  return listPersistedHandles<ResourceHandleV1>();
}

export function getResourceHandle(resource_handle: string): ResourceHandleV1 | null {
  const rows = listResourceHandles().filter((row) => row.resource_handle === resource_handle);
  return rows[rows.length - 1] ?? null;
}

export function createResourceHandle(input: {
  readonly resource_id: string;
  readonly logical_path?: string;
  readonly data_class?: string;
  readonly content_type?: string;
  readonly allowed_operations?: readonly string[];
  readonly owner_authority?: "ALLOW" | "DENY";
  readonly work_id?: string;
}): ResourceHandleV1 {
  const resource = getRegisteredLocalResource(input.resource_id);
  const meta = resource && input.logical_path ? filesMetadata(resource, input.logical_path) : null;
  const size = meta && meta.ok ? Number(meta.metadata.bytes ?? 0) : 0;
  const hash = meta && meta.ok && typeof meta.metadata.sha256 === "string"
    ? meta.metadata.sha256
    : createHash("sha256").update(`${input.resource_id}:${input.logical_path ?? ""}:${nowIso()}`).digest("hex");
  const env = environmentForResource(input.resource_id);
  const handle: ResourceHandleV1 = {
    schema: "RESOURCE_HANDLE_V1",
    resource_handle: `handle-${randomUUID()}`,
    resource_id: input.resource_id,
    environment_id: env.environment_id,
    data_class: input.data_class ?? (meta && meta.ok ? String(meta.metadata.data_class ?? "FILE") : "FILE"),
    content_type: input.content_type ?? "application/octet-stream",
    size,
    hash,
    scope: input.logical_path ? [input.logical_path] : [],
    expiry: null,
    allowed_operations: input.allowed_operations ?? ["READ", "SEARCH"],
    owner_authority: input.owner_authority ?? "DENY",
    evidence_ref: input.work_id ?? null,
    raw_content_included: false,
  };
  persistHandle(handle);
  emitLocalResourceEvent("RESOURCE_HANDLE_CREATED", input.work_id ?? null, handle.resource_handle, undefined, {
    resource_id: input.resource_id, locality: "LOCAL", bytes: utf8Bytes({ handle: handle.resource_handle, hash, size }),
  });
  emitLocalResourceEvent("OWNER_ENVIRONMENT_SELECTED", input.work_id ?? null, env.environment_id, undefined, {
    resource_id: input.resource_id, locality: "LOCAL",
  });
  return handle;
}
