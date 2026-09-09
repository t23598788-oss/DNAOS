/**
 * Public boundary of control/canonical-view/.
 * Other folders may import only from this file.
 */

import { listActivityViewRows } from "./activity-view";
import { listLauncherItems } from "./launcher";
import { listOwnerReviews } from "./review";

export {
  CANONICAL_VIEW_SCHEMA,
  ACTION_PREVIEW_SCHEMA,
  OWNER_REVIEW_SURFACE_SCHEMA,
  CANONICAL_DOCUMENT_TEMPLATE_SCHEMA,
  GENERIC_TABLE_SCHEMA,
} from "./types";
export type {
  CanonicalViewType,
  CanonicalViewV1,
  CanonicalDocumentTemplateV1,
  ActionPreviewV1,
  OwnerReviewSurfaceV1,
  OwnerFacingReviewV1,
  LauncherItemV1,
  LauncherKind,
  LauncherDisplayState,
  ActivityViewRow,
  GenericTableSchema,
  OwnerReviewDecision,
  ReviewSurfaceState,
} from "./types";

export { REGISTERED_VIEW_TYPES, INVENTORY_TABLE_SCHEMA, TABLE_SCHEMAS, VIEW_ACTIONS, getTableSchema } from "./schemas";
export { renderGenericTable } from "./table";
export { normalizeAiOutputToCanonicalView, renderCanonicalView } from "./normalize";
export { FIXTURE_INVOICE_TEMPLATE, FIXTURE_RECEIPT_TEMPLATE, DOCUMENT_TEMPLATES, getDocumentTemplate, listDocumentTemplates } from "./templates";
export { createActionPreview, isSideEffectingAction, capabilityForEverydayAction } from "./preview";
export { openOwnerReviewView, attachActionPreview, applyOwnerReviewDecision, getOwnerReview, listOwnerReviews, viewEvidenceTrace } from "./review";
export { listLauncherItems } from "./launcher";
export { listActivityViewRows, renderActivityView } from "./activity-view";
export { actionsAvailableForView } from "./view-actions";
export { loadInventoryFixtureRows, renderInventoryTable } from "./views";

export function ownerReviewSurfaceSnapshot(ai_client_id = "ai://circuit-ui", session_id = "session-circuit-ui"): Record<string, unknown> {
  const reviews = listOwnerReviews();
  const latest = reviews[reviews.length - 1] ?? null;
  return {
    schema: "OWNER_REVIEW_SURFACE_V1",
    latest,
    launcher: listLauncherItems(ai_client_id, session_id, "work-circuit-ui"),
    activity: listActivityViewRows().slice(-20),
    grants_authority: false,
  };
}
