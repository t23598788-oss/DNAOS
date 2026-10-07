export const OWNER_WORK_SURFACE_SCHEMA = "OWNER_WORK_SURFACE_V1" as const;
export const REAL_APP_CAPABILITY_PACK_SCHEMA = "REAL_APP_CAPABILITY_PACK_V1" as const;
export const OWNER_SEARCH_SCHEMA = "OWNER_SEARCH_V1" as const;
export const EMAIL_WORK_SURFACE_SCHEMA = "EMAIL_WORK_SURFACE_V1" as const;
export const APP_LAUNCHER_ITEM_SCHEMA = "APP_LAUNCHER_ITEM_V1" as const;

export type AppLauncherCategory =
  | "FILES" | "FOLDERS" | "DOCUMENTS" | "PDF" | "IMAGES"
  | "EMAIL" | "CALENDAR" | "CONTACTS" | "GIT" | "DATABASE"
  | "LOCAL_APPS" | "REMOTE_SERVICES" | "ACTIVITY";

export interface AppLauncherItemV1 {
  readonly schema: typeof APP_LAUNCHER_ITEM_SCHEMA;
  readonly app_id: string;
  readonly display_name: string;
  readonly icon_ref: string;
  readonly category: AppLauncherCategory;
  readonly availability: string;
  readonly owner_enabled: boolean;
  readonly connection_state: string;
  readonly capabilities: readonly string[];
  readonly primary_view: string;
  readonly badge_status: string;
  readonly grants_authority: false;
  readonly secondary_catalog: boolean;
}

export interface OwnerSearchHitV1 {
  readonly resource_id: string;
  readonly source: string;
  readonly type: string;
  readonly title: string;
  readonly metadata: Record<string, unknown>;
  readonly match: string;
  readonly authority_state: "ALLOW" | "DENY" | "OWNER_APPROVAL_REQUIRED";
  readonly available_actions: readonly string[];
  readonly evidence_ref: string | null;
}

export interface OwnerSearchV1 {
  readonly schema: typeof OWNER_SEARCH_SCHEMA;
  readonly query: string;
  readonly local_search_first: true;
  readonly local_source_uploaded: false;
  readonly hits: readonly OwnerSearchHitV1[];
  readonly SOURCE_BYTES: number;
  readonly LOCAL_BYTES_PROCESSED: number;
  readonly EXTERNAL_AI_BYTES_SENT: number;
  readonly RESULT_BYTES_RETURNED: number;
}

export interface EmailWorkSurfaceV1 {
  readonly schema: typeof EMAIL_WORK_SURFACE_SCHEMA;
  readonly runtime_binding: "NOT_AVAILABLE" | "BOUND";
  readonly message_id: string | null;
  readonly thread_id: string | null;
  readonly sender: string | null;
  readonly recipients: readonly string[];
  readonly subject: string | null;
  readonly timestamp: string | null;
  readonly body_content: string | null;
  readonly attachments: readonly string[];
  readonly source_connection: string | null;
  readonly authority_state: "DENY" | "ALLOW";
  readonly available_actions: readonly string[];
  readonly evidence_refs: readonly string[];
  readonly send_preview_contract: readonly string[];
}

export interface RealAppCapabilityPackV1 {
  readonly schema: typeof REAL_APP_CAPABILITY_PACK_SCHEMA;
  readonly files: Record<string, unknown>;
  readonly documents: Record<string, unknown>;
  readonly pdf: Record<string, unknown>;
  readonly email: EmailWorkSurfaceV1;
  readonly calendar: Record<string, unknown>;
  readonly contacts: Record<string, unknown>;
  readonly github: Record<string, unknown>;
  readonly database: Record<string, unknown>;
  readonly local_applications: readonly Record<string, unknown>[];
  readonly google: Record<string, unknown>;
}
