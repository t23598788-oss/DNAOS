/**
 * ACTION_PREVIEW_V1 — deterministic preview. Never executes.
 */

import { randomUUID } from "node:crypto";
import {
  filesMetadata,
  getEverydayAction,
  getRegisteredLocalResource,
} from "../local-resource-access/contract";
import { nowIso } from "./host-runtime";
import { persistPreview } from "./persist";
import type { ActionPreviewV1 } from "./types";

export const EVERYDAY_TO_CAPABILITY: Readonly<Record<string, string>> = {
  SEARCH: "local.folder.search",
  READ: "local.file.read",
  CREATE: "local.file.create",
  WRITE: "local.file.create",
  COPY: "local.file.copy",
  MOVE: "local.file.move",
  RENAME: "local.file.rename",
  DELETE: "local.file.delete",
  SHARE: "local.file.share_external",
  EXTRACT: "local.document.extract_text",
  SUMMARIZE: "local.document.summarize",
};

export interface PreviewRequest {
  readonly work_id: string;
  readonly action: string;
  readonly resource_id: string;
  readonly destination_resource_id?: string;
  readonly input: Record<string, unknown>;
}

export function isSideEffectingAction(action: string): boolean {
  const desc = getEverydayAction(action);
  if (!desc) return true;
  return desc.side_effect_class !== "NONE" || desc.owner_approval_requirement === "OWNER_APPROVAL_REQUIRED";
}

export function createActionPreview(request: PreviewRequest): ActionPreviewV1 {
  const desc = getEverydayAction(request.action);
  const sourceResource = getRegisteredLocalResource(request.resource_id);
  const destId = String(request.input.destination_resource_id ?? request.destination_resource_id ?? request.resource_id);
  const destResource = getRegisteredLocalResource(destId);
  const sourceLogical = String(request.input.source_logical ?? request.input.logical_path ?? "");
  const destLogical = String(request.input.destination_logical ?? "");
  const sourceMeta = sourceResource && sourceLogical
    ? filesMetadata(sourceResource, sourceLogical)
    : null;
  const bytes = sourceMeta && sourceMeta.ok ? Number(sourceMeta.metadata.bytes ?? 0) : null;
  const hash = sourceMeta && sourceMeta.ok ? (typeof sourceMeta.metadata.sha256 === "string" ? sourceMeta.metadata.sha256 : null) : null;
  const dataClass = sourceMeta && sourceMeta.ok ? String(sourceMeta.metadata.data_class ?? "FILE") : "FILE";
  const approval = desc?.owner_approval_requirement === "OWNER_APPROVAL_REQUIRED" ? "OWNER_APPROVAL_REQUIRED" : "NONE";
  const network = desc?.network_egress_class ?? "LOCAL_ONLY";
  const preview: ActionPreviewV1 = {
    schema: "ACTION_PREVIEW_V1",
    preview_id: `preview-${randomUUID()}`,
    action: request.action,
    source: {
      resource_id: request.resource_id,
      logical: sourceLogical || null,
      hash,
      bytes,
    },
    destination: destLogical || destId !== request.resource_id
      ? { resource_id: destId, logical: destLogical || null, hash: null, bytes: null }
      : null,
    affected_resources: destId !== request.resource_id ? [request.resource_id, destId] : [request.resource_id],
    data_classes: [dataClass],
    files_records_affected: [sourceLogical, destLogical].filter(Boolean),
    bytes_transferred: bytes,
    source_hash: hash,
    destination_hash: null,
    network_egress: network,
    external_destination: network === "LOCAL_ONLY" ? null : String(request.input.external_destination ?? network),
    permission_required: desc?.human_permission ?? "READ_ONLY",
    reversibility: desc?.reversibility ?? "UNKNOWN",
    expected_side_effects: desc ? [desc.side_effect_class] : ["UNKNOWN"],
    validation_status: !desc ? "INVALID" : approval === "OWNER_APPROVAL_REQUIRED" ? "OWNER_APPROVAL_REQUIRED" : (sourceMeta && !sourceMeta.ok ? "INVALID" : "VALID"),
    evidence_references: [],
    owner_approval_requirement: approval,
    execution_blocked: true,
    created_at: nowIso(),
    work_id: request.work_id,
  };
  persistPreview(preview);
  return preview;
}

export function capabilityForEverydayAction(action: string): string {
  return EVERYDAY_TO_CAPABILITY[action] ?? action;
}
