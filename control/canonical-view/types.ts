/**
 * CANONICAL_VIEW_V1 / ACTION_PREVIEW_V1 / OWNER_REVIEW_SURFACE_V1 types.
 * Presentation structure is registered here. AI may fill values, never layout.
 */

export const CANONICAL_VIEW_SCHEMA = "CANONICAL_VIEW_V1" as const;
export const ACTION_PREVIEW_SCHEMA = "ACTION_PREVIEW_V1" as const;
export const OWNER_REVIEW_SURFACE_SCHEMA = "OWNER_REVIEW_SURFACE_V1" as const;
export const CANONICAL_DOCUMENT_TEMPLATE_SCHEMA = "CANONICAL_DOCUMENT_TEMPLATE_V1" as const;
export const GENERIC_TABLE_SCHEMA = "GENERIC_TABLE_V1" as const;

export type CanonicalViewType =
  | "GENERIC_TABLE_V1"
  | "DOCUMENT_VIEW_V1"
  | "PDF_VIEW_V1"
  | "IMAGE_VIEW_V1"
  | "FILE_LIST_V1"
  | "EMAIL_VIEW_V1"
  | "MESSAGE_VIEW_V1"
  | "CALENDAR_VIEW_V1"
  | "CONTACT_VIEW_V1"
  | "ACTIVITY_VIEW_V1"
  | "TRANSFER_VIEW_V1"
  | "APP_RESOURCE_VIEW_V1"
  | "SAFE_GENERIC_VIEW";

export type RenderStatus = "RENDERABLE" | "INVALID" | "REJECTED_ARBITRARY_UI" | "SAFE_FALLBACK";
export type ReviewSurfaceState = "VIEW" | "PREVIEW" | "RESULT";
export type OwnerReviewDecision = "APPROVE" | "REJECT" | "EDIT_REQUEST" | "EXECUTE";
export type TableFieldType = "text" | "number" | "datetime" | "boolean" | "id" | "bytes" | "state";

export interface TableColumnDefinition {
  readonly key: string;
  readonly label: string;
  readonly type: TableFieldType;
  readonly order: number;
  readonly aggregatable?: boolean;
}

export interface GenericTableSchema {
  readonly schema_id: string;
  readonly schema: typeof GENERIC_TABLE_SCHEMA;
  readonly columns: readonly TableColumnDefinition[];
  readonly allow_dynamic_fields: false;
  readonly row_id_field: string;
  readonly sortable_fields: readonly string[];
  readonly filterable_fields: readonly string[];
  readonly groupable_fields: readonly string[];
  readonly total_fields: readonly string[];
  readonly export_mapping: Readonly<Record<string, string>>;
}

export interface CanonicalViewV1 {
  readonly schema: typeof CANONICAL_VIEW_SCHEMA;
  readonly view_id: string;
  readonly view_type: CanonicalViewType;
  readonly view_schema_version: "1";
  readonly source_resource_ids: readonly string[];
  readonly data_schema: string;
  readonly display_schema: string;
  readonly validation_rules: readonly string[];
  readonly actions_available: readonly string[];
  readonly authority_state: "ALLOW" | "DENY" | "OWNER_APPROVAL_REQUIRED";
  readonly evidence_refs: readonly string[];
  readonly render_status: RenderStatus;
  readonly payload: Record<string, unknown>;
}

export interface CanonicalDocumentTemplateV1 {
  readonly schema: typeof CANONICAL_DOCUMENT_TEMPLATE_SCHEMA;
  readonly template_id: string;
  readonly jurisdiction: string | null;
  readonly domain: string;
  readonly document_type: string;
  readonly required_fields: readonly string[];
  readonly optional_fields: readonly string[];
  readonly field_validation: Readonly<Record<string, string>>;
  readonly layout_regions: readonly string[];
  readonly format_rules: readonly string[];
  readonly number_date_currency_rules: Readonly<Record<string, string>>;
  readonly signature_approval_requirements: readonly string[];
  readonly export_formats: readonly string[];
  readonly template_version: string;
  readonly legal_correctness_claimed: false;
}

export interface ActionPreviewV1 {
  readonly schema: typeof ACTION_PREVIEW_SCHEMA;
  readonly preview_id: string;
  readonly action: string;
  readonly source: Record<string, unknown>;
  readonly destination: Record<string, unknown> | null;
  readonly affected_resources: readonly string[];
  readonly data_classes: readonly string[];
  readonly files_records_affected: readonly string[];
  readonly bytes_transferred: number | null;
  readonly source_hash: string | null;
  readonly destination_hash: string | null;
  readonly network_egress: string;
  readonly external_destination: string | null;
  readonly permission_required: string;
  readonly reversibility: string;
  readonly expected_side_effects: readonly string[];
  readonly validation_status: "VALID" | "INVALID" | "OWNER_APPROVAL_REQUIRED";
  readonly evidence_references: readonly string[];
  readonly owner_approval_requirement: "NONE" | "OWNER_APPROVAL_REQUIRED";
  readonly execution_blocked: true;
  readonly created_at: string;
  readonly work_id: string;
}

export interface OwnerReviewSurfaceV1 {
  readonly schema: typeof OWNER_REVIEW_SURFACE_SCHEMA;
  readonly review_id: string;
  readonly state: ReviewSurfaceState;
  readonly view: CanonicalViewV1 | null;
  readonly preview: ActionPreviewV1 | null;
  readonly result: Record<string, unknown> | null;
  readonly controls: readonly ("APPROVE" | "REJECT" | "EDIT_REQUEST" | "EXECUTE" | "VIEW_EVIDENCE")[];
  readonly decision: OwnerReviewDecision | "PENDING";
  readonly work_id: string;
  readonly execution_id: string | null;
  readonly executed: boolean;
  readonly owner_facing?: OwnerFacingReviewV1;
}

export interface OwnerFacingReviewV1 {
  readonly what: string;
  readonly source: string;
  readonly destination: string;
  readonly who: string;
  readonly how: string;
  readonly data: { readonly bytes_processed_locally: number | null; readonly bytes_proposed_externally: number | null };
  readonly impact: string;
  readonly network: string;
  readonly reversibility: string;
  readonly authority: "ALLOW" | "DENY" | "OWNER_APPROVAL_REQUIRED";
  readonly evidence: string;
  readonly result: string;
  readonly provider_metadata_expandable: Record<string, unknown>;
}

export type LauncherKind =
  | "FILES" | "FOLDERS" | "DOCUMENTS" | "PDF" | "IMAGES"
  | "EMAIL" | "CALENDAR" | "CONTACTS" | "GIT" | "GITHUB"
  | "DATABASE" | "APPLICATION" | "REMOTE_SERVICE" | "ACTIVITY";

export type LauncherDisplayState = "AVAILABLE" | "OWNER_ENABLED" | "READ_ONLY" | "WRITE_ENABLED" | "APPROVAL_REQUIRED" | "UNAVAILABLE";

export interface LauncherItemV1 {
  readonly item_id: string;
  readonly label: string;
  readonly kind: LauncherKind;
  readonly lifecycle: "DISCOVERED" | "AVAILABLE" | "OWNER_ENABLED" | "UNAVAILABLE";
  readonly display_state: LauncherDisplayState;
  readonly grants_authority: false;
  readonly actions_available: readonly string[];
}

export interface ActivityViewRow {
  readonly time: string;
  readonly work_id: string | null;
  readonly ai_client: string | null;
  readonly canonical_action: string | null;
  readonly resource: string | null;
  readonly local_execution: boolean;
  readonly network_egress: string | null;
  readonly approval_state: string | null;
  readonly result: string | null;
  readonly event: string;
}
