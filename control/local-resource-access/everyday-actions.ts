/**
 * EVERYDAY_DATA_ACTIONS_V1 — canonical human computer actions. Adapters may not invent hidden side effects.
 */

import type { EverydayActionDescriptor, EverydayActionId } from "./types";

const io = { type: "object", properties: { logical_path: { type: "string" } } };
const transfer = { type: "object", properties: { source_logical: { type: "string" }, destination_logical: { type: "string" } }, required: ["source_logical", "destination_logical"] };

function action(
  action_id: EverydayActionId,
  extra: Omit<EverydayActionDescriptor, "schema" | "action_id" | "input_schema" | "output_schema" | "evidence_policy"> & { input_schema?: Record<string, unknown> },
): EverydayActionDescriptor {
  return {
    schema: "EVERYDAY_DATA_ACTIONS_V1",
    action_id,
    input_schema: extra.input_schema ?? io,
    output_schema: { type: "object" },
    evidence_policy: "LOCAL_EXECUTION_ENVELOPE",
    allowed_resource_types: extra.allowed_resource_types,
    allowed_data_classes: extra.allowed_data_classes,
    side_effect_class: extra.side_effect_class,
    authority_required: extra.authority_required,
    owner_approval_requirement: extra.owner_approval_requirement,
    network_egress_class: extra.network_egress_class,
    reversibility: extra.reversibility,
    human_permission: extra.human_permission,
  };
}

export const EVERYDAY_DATA_ACTIONS: Readonly<Record<EverydayActionId, EverydayActionDescriptor>> = {
  SEARCH: action("SEARCH", { allowed_resource_types: ["FILE_SYSTEM"], allowed_data_classes: ["FILE", "FOLDER", "TEXT", "DOCUMENT"], side_effect_class: "NONE", authority_required: "OWNER_GRANT", owner_approval_requirement: "NONE", network_egress_class: "LOCAL_ONLY", reversibility: "REVERSIBLE", human_permission: "READ_ONLY" }),
  READ: action("READ", { allowed_resource_types: ["FILE_SYSTEM", "APPLICATION"], allowed_data_classes: ["FILE", "DOCUMENT", "PDF", "TEXT", "APPLICATION_STATE"], side_effect_class: "NONE", authority_required: "OWNER_GRANT", owner_approval_requirement: "NONE", network_egress_class: "MINIMIZED_EXTERNAL", reversibility: "REVERSIBLE", human_permission: "READ_ONLY" }),
  CREATE: action("CREATE", { allowed_resource_types: ["FILE_SYSTEM"], allowed_data_classes: ["FILE", "FOLDER", "TEXT"], side_effect_class: "CREATE", authority_required: "OWNER_GRANT", owner_approval_requirement: "NONE", network_egress_class: "LOCAL_ONLY", reversibility: "REVERSIBLE", human_permission: "CREATE" }),
  WRITE: action("WRITE", { allowed_resource_types: ["FILE_SYSTEM"], allowed_data_classes: ["FILE", "TEXT", "DOCUMENT"], side_effect_class: "MODIFY", authority_required: "OWNER_GRANT", owner_approval_requirement: "NONE", network_egress_class: "LOCAL_ONLY", reversibility: "REVERSIBLE", human_permission: "MODIFY" }),
  COPY: action("COPY", { input_schema: transfer, allowed_resource_types: ["FILE_SYSTEM"], allowed_data_classes: ["FILE", "FOLDER"], side_effect_class: "CREATE", authority_required: "OWNER_GRANT", owner_approval_requirement: "NONE", network_egress_class: "LOCAL_ONLY", reversibility: "REVERSIBLE", human_permission: "CREATE" }),
  MOVE: action("MOVE", { input_schema: transfer, allowed_resource_types: ["FILE_SYSTEM"], allowed_data_classes: ["FILE", "FOLDER"], side_effect_class: "MOVE", authority_required: "OWNER_GRANT", owner_approval_requirement: "NONE", network_egress_class: "LOCAL_ONLY", reversibility: "REVERSIBLE", human_permission: "MOVE" }),
  RENAME: action("RENAME", { input_schema: transfer, allowed_resource_types: ["FILE_SYSTEM"], allowed_data_classes: ["FILE", "FOLDER"], side_effect_class: "MOVE", authority_required: "OWNER_GRANT", owner_approval_requirement: "NONE", network_egress_class: "LOCAL_ONLY", reversibility: "REVERSIBLE", human_permission: "MOVE" }),
  DELETE: action("DELETE", { allowed_resource_types: ["FILE_SYSTEM"], allowed_data_classes: ["FILE", "FOLDER"], side_effect_class: "DELETE", authority_required: "OWNER_APPROVAL_REQUIRED", owner_approval_requirement: "OWNER_APPROVAL_REQUIRED", network_egress_class: "LOCAL_ONLY", reversibility: "DESTRUCTIVE", human_permission: "DELETE" }),
  IMPORT: action("IMPORT", { allowed_resource_types: ["FILE_SYSTEM"], allowed_data_classes: ["FILE", "REMOTE_OBJECT"], side_effect_class: "CREATE", authority_required: "OWNER_GRANT", owner_approval_requirement: "NONE", network_egress_class: "OWNER_APPROVAL_REQUIRED", reversibility: "REVERSIBLE", human_permission: "CREATE" }),
  EXPORT: action("EXPORT", { allowed_resource_types: ["FILE_SYSTEM"], allowed_data_classes: ["FILE", "DOCUMENT"], side_effect_class: "NONE", authority_required: "OWNER_GRANT", owner_approval_requirement: "NONE", network_egress_class: "MINIMIZED_EXTERNAL", reversibility: "REVERSIBLE", human_permission: "READ_ONLY" }),
  UPLOAD: action("UPLOAD", { allowed_resource_types: ["FILE_SYSTEM"], allowed_data_classes: ["FILE", "REMOTE_OBJECT"], side_effect_class: "NETWORK", authority_required: "OWNER_APPROVAL_REQUIRED", owner_approval_requirement: "OWNER_APPROVAL_REQUIRED", network_egress_class: "OWNER_APPROVAL_REQUIRED", reversibility: "EXTERNAL", human_permission: "SHARE_EXTERNAL" }),
  DOWNLOAD: action("DOWNLOAD", { allowed_resource_types: ["FILE_SYSTEM"], allowed_data_classes: ["FILE", "REMOTE_OBJECT"], side_effect_class: "CREATE", authority_required: "OWNER_GRANT", owner_approval_requirement: "NONE", network_egress_class: "OWNER_APPROVAL_REQUIRED", reversibility: "REVERSIBLE", human_permission: "CREATE" }),
  SHARE: action("SHARE", { allowed_resource_types: ["FILE_SYSTEM", "APPLICATION"], allowed_data_classes: ["FILE", "REMOTE_OBJECT"], side_effect_class: "NETWORK", authority_required: "OWNER_APPROVAL_REQUIRED", owner_approval_requirement: "OWNER_APPROVAL_REQUIRED", network_egress_class: "DENIED", reversibility: "EXTERNAL", human_permission: "SHARE_EXTERNAL" }),
  ARCHIVE: action("ARCHIVE", { allowed_resource_types: ["FILE_SYSTEM"], allowed_data_classes: ["FILE", "FOLDER"], side_effect_class: "CREATE", authority_required: "OWNER_GRANT", owner_approval_requirement: "NONE", network_egress_class: "LOCAL_ONLY", reversibility: "REVERSIBLE", human_permission: "CREATE" }),
  UNARCHIVE: action("UNARCHIVE", { allowed_resource_types: ["FILE_SYSTEM"], allowed_data_classes: ["FILE", "FOLDER"], side_effect_class: "CREATE", authority_required: "OWNER_GRANT", owner_approval_requirement: "NONE", network_egress_class: "LOCAL_ONLY", reversibility: "REVERSIBLE", human_permission: "CREATE" }),
  CONVERT: action("CONVERT", { allowed_resource_types: ["FILE_SYSTEM"], allowed_data_classes: ["DOCUMENT", "PDF", "IMAGE"], side_effect_class: "CREATE", authority_required: "OWNER_GRANT", owner_approval_requirement: "NONE", network_egress_class: "LOCAL_ONLY", reversibility: "REVERSIBLE", human_permission: "CREATE" }),
  COMPARE: action("COMPARE", { allowed_resource_types: ["FILE_SYSTEM"], allowed_data_classes: ["FILE", "TEXT"], side_effect_class: "NONE", authority_required: "OWNER_GRANT", owner_approval_requirement: "NONE", network_egress_class: "LOCAL_ONLY", reversibility: "REVERSIBLE", human_permission: "READ_ONLY" }),
  SUMMARIZE: action("SUMMARIZE", { allowed_resource_types: ["FILE_SYSTEM"], allowed_data_classes: ["TEXT", "DOCUMENT", "PDF"], side_effect_class: "NONE", authority_required: "OWNER_GRANT", owner_approval_requirement: "NONE", network_egress_class: "MINIMIZED_EXTERNAL", reversibility: "REVERSIBLE", human_permission: "READ_ONLY" }),
  EXTRACT: action("EXTRACT", { allowed_resource_types: ["FILE_SYSTEM"], allowed_data_classes: ["DOCUMENT", "PDF", "IMAGE", "TEXT"], side_effect_class: "NONE", authority_required: "OWNER_GRANT", owner_approval_requirement: "NONE", network_egress_class: "LOCAL_ONLY", reversibility: "REVERSIBLE", human_permission: "READ_ONLY" }),
  SYNC: action("SYNC", { allowed_resource_types: ["FILE_SYSTEM"], allowed_data_classes: ["FILE", "REMOTE_OBJECT"], side_effect_class: "NETWORK", authority_required: "OWNER_APPROVAL_REQUIRED", owner_approval_requirement: "OWNER_APPROVAL_REQUIRED", network_egress_class: "OWNER_APPROVAL_REQUIRED", reversibility: "EXTERNAL", human_permission: "MODIFY" }),
};

export function getEverydayAction(action_id: string): EverydayActionDescriptor | null {
  if (!(action_id in EVERYDAY_DATA_ACTIONS)) return null;
  return EVERYDAY_DATA_ACTIONS[action_id as EverydayActionId];
}

export function listEverydayActions(): readonly EverydayActionDescriptor[] {
  return Object.values(EVERYDAY_DATA_ACTIONS);
}
