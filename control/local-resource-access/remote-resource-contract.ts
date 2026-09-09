/**
 * REMOTE_RESOURCE_ACTION_V1 — contract only.
 * Future Drive/Gmail/GitHub/Supabase/LINE/social adapters must map into EVERYDAY_DATA_ACTIONS_V1.
 * This phase implements no remote service.
 */

import type { EverydayActionId, NetworkEgressPolicy } from "./types";

export const REMOTE_RESOURCE_ACTION_SCHEMA = "REMOTE_RESOURCE_ACTION_V1" as const;

export type RemoteServiceFamily =
  | "google_drive"
  | "gmail"
  | "google_calendar"
  | "google_contacts"
  | "google_sheets"
  | "github"
  | "supabase"
  | "line"
  | "facebook"
  | "instagram"
  | "tiktok"
  | "other_api";

export interface RemoteResourceActionV1 {
  readonly schema: typeof REMOTE_RESOURCE_ACTION_SCHEMA;
  readonly service_family: RemoteServiceFamily;
  readonly remote_object_id: string;
  readonly everyday_actions: readonly EverydayActionId[];
  readonly network_egress_class: NetworkEgressPolicy;
  readonly implemented: false;
}

export const REMOTE_SERVICE_ACTION_MAP: Readonly<Record<RemoteServiceFamily, readonly EverydayActionId[]>> = {
  google_drive: ["SEARCH", "READ", "CREATE", "WRITE", "MOVE", "SHARE", "DOWNLOAD", "UPLOAD"],
  gmail: ["SEARCH", "READ", "CREATE", "DOWNLOAD", "SHARE"],
  google_calendar: ["SEARCH", "READ", "CREATE", "WRITE", "DELETE"],
  google_contacts: ["SEARCH", "READ"],
  google_sheets: ["SEARCH", "READ", "CREATE", "WRITE", "EXPORT"],
  github: ["SEARCH", "READ", "WRITE"],
  supabase: ["SEARCH", "READ", "CREATE", "WRITE", "DELETE", "EXPORT"],
  line: ["READ", "SHARE"],
  facebook: ["READ", "SHARE"],
  instagram: ["READ", "SHARE"],
  tiktok: ["READ", "SHARE"],
  other_api: ["SEARCH", "READ"],
};

export function describeRemoteResourceAction(service_family: RemoteServiceFamily, remote_object_id: string): RemoteResourceActionV1 {
  return {
    schema: "REMOTE_RESOURCE_ACTION_V1",
    service_family,
    remote_object_id,
    everyday_actions: REMOTE_SERVICE_ACTION_MAP[service_family],
    network_egress_class: "OWNER_APPROVAL_REQUIRED",
    implemented: false,
  };
}
