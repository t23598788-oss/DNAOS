/**
 * OWNER_REVIEW_SURFACE_V1 — VIEW / PREVIEW / RESULT.
 * APPROVE and EXECUTE call invokeLocalCapability. UI never fabricates results.
 */

import { randomUUID } from "node:crypto";
import {
  emitLocalResourceEvent,
  getLocalExecutionEvidence,
  invokeLocalCapability,
} from "../local-resource-access/contract";
import { persistReview, listPersistedReviews } from "./persist";
import { capabilityForEverydayAction, createActionPreview, isSideEffectingAction, type PreviewRequest } from "./preview";
import { renderCanonicalView } from "./normalize";
import { actionsAvailableForView } from "./view-actions";
import type { CanonicalViewType, CanonicalViewV1, OwnerFacingReviewV1, OwnerReviewDecision, OwnerReviewSurfaceV1 } from "./types";

function ownerFacingFrom(review: OwnerReviewSurfaceV1, extras: Partial<OwnerFacingReviewV1> & { readonly who?: string } = {}): OwnerFacingReviewV1 {
  const preview = review.preview;
  const dest = preview?.destination as { resource_id?: string } | null;
  return {
    what: extras.what ?? preview?.action ?? review.view?.view_type ?? "VIEW",
    source: extras.source ?? String((preview?.source as { resource_id?: string } | undefined)?.resource_id ?? review.view?.source_resource_ids[0] ?? ""),
    destination: extras.destination ?? String(dest?.resource_id ?? "none"),
    who: extras.who ?? "requesting client",
    how: extras.how ?? "local / Owner server / external service / AI reasoning",
    data: extras.data ?? {
      bytes_processed_locally: preview?.bytes_transferred ?? null,
      bytes_proposed_externally: 0,
    },
    impact: extras.impact ?? String(preview?.expected_side_effects[0] ?? "READ"),
    network: extras.network ?? String(preview?.network_egress ?? "LOCAL_ONLY"),
    reversibility: extras.reversibility ?? String(preview?.reversibility ?? "UNKNOWN"),
    authority: extras.authority ?? (preview?.owner_approval_requirement === "OWNER_APPROVAL_REQUIRED" ? "OWNER_APPROVAL_REQUIRED" : "ALLOW"),
    evidence: extras.evidence ?? (preview?.source_hash ? `hash:${preview.source_hash}` : review.execution_id ?? "none"),
    result: extras.result ?? review.state,
    provider_metadata_expandable: extras.provider_metadata_expandable ?? { note: "provider is metadata only" },
  };
}

export interface OpenReviewInput {
  readonly work_id: string;
  readonly ai_client_id: string;
  readonly session_id: string;
  readonly view_type: CanonicalViewType;
  readonly data_schema?: string;
  readonly rows?: readonly Record<string, unknown>[];
  readonly fields?: Record<string, unknown>;
  readonly source_resource_ids?: readonly string[];
  readonly filter_field?: string;
  readonly filter_contains?: string;
}

export function getOwnerReview(review_id: string): OwnerReviewSurfaceV1 | null {
  const rows = listPersistedReviews<OwnerReviewSurfaceV1>().filter((row) => row.review_id === review_id);
  return rows[rows.length - 1] ?? null;
}

export function listOwnerReviews(): readonly OwnerReviewSurfaceV1[] {
  return listPersistedReviews<OwnerReviewSurfaceV1>();
}

export function openOwnerReviewView(input: OpenReviewInput): OwnerReviewSurfaceV1 {
  const actions = actionsAvailableForView(input.view_type, {
    ai_client_id: input.ai_client_id,
    session_id: input.session_id,
    work_id: input.work_id,
    source_resource_ids: input.source_resource_ids,
  });
  const view = renderCanonicalView({
    view_type: input.view_type,
    data_schema: input.data_schema,
    rows: input.rows,
    fields: input.fields,
    source_resource_ids: input.source_resource_ids,
    actions_available: actions,
    filter_field: input.filter_field,
    filter_contains: input.filter_contains,
    authority_state: "DENY",
  });
  const review: OwnerReviewSurfaceV1 = {
    schema: "OWNER_REVIEW_SURFACE_V1",
    review_id: `review-${randomUUID()}`,
    state: "VIEW",
    view,
    preview: null,
    result: null,
    controls: ["EDIT_REQUEST", "VIEW_EVIDENCE"],
    decision: "PENDING",
    work_id: input.work_id,
    execution_id: null,
    executed: false,
  };
  persistReview(review);
  return review;
}

export function attachActionPreview(review_id: string, request: PreviewRequest): OwnerReviewSurfaceV1 | { ok: false; reason_code: string } {
  const current = getOwnerReview(review_id);
  if (!current) return { ok: false, reason_code: "UNKNOWN_REVIEW" };
  const preview = createActionPreview(request);
  const executeAllowed = preview.owner_approval_requirement === "NONE";
  const next: OwnerReviewSurfaceV1 = {
    ...current,
    state: "PREVIEW",
    preview,
    result: null,
    controls: executeAllowed
      ? ["APPROVE", "REJECT", "EDIT_REQUEST", "EXECUTE", "VIEW_EVIDENCE"]
      : ["APPROVE", "REJECT", "EDIT_REQUEST", "VIEW_EVIDENCE"],
    decision: "PENDING",
    executed: false,
    execution_id: null,
  };
  const withFacing: OwnerReviewSurfaceV1 = { ...next, owner_facing: ownerFacingFrom(next) };
  persistReview(withFacing);
  emitLocalResourceEvent("OWNER_REVIEW_REQUESTED", request.work_id, request.action, preview.preview_id, {
    resource_id: request.resource_id, action: request.action, locality: "LOCAL",
  });
  return withFacing;
}

export async function applyOwnerReviewDecision(input: {
  readonly review_id: string;
  readonly decision: OwnerReviewDecision | "VIEW_EVIDENCE";
  readonly ai_client_id: string;
  readonly session_id: string;
}): Promise<OwnerReviewSurfaceV1 | { ok: false; reason_code: string }> {
  const current = getOwnerReview(input.review_id);
  if (!current) return { ok: false, reason_code: "UNKNOWN_REVIEW" };
  if (input.decision === "VIEW_EVIDENCE") {
    const evidence = getLocalExecutionEvidence(current.work_id, current.execution_id ?? undefined);
    const next: OwnerReviewSurfaceV1 = {
      ...current,
      result: { ...(current.result ?? {}), evidence, why_shown: current.view, what_produced_it: evidence },
    };
    persistReview(next);
    return next;
  }
  if (input.decision === "EDIT_REQUEST") {
    const next: OwnerReviewSurfaceV1 = { ...current, decision: "EDIT_REQUEST", executed: false };
    persistReview(next);
    return next;
  }
  if (input.decision === "REJECT") {
    const next: OwnerReviewSurfaceV1 = {
      ...current,
      state: "RESULT",
      decision: "REJECT",
      executed: false,
      result: { rejected: true, execution: "BLOCKED", mutation: false },
    };
    persistReview(next);
    emitLocalResourceEvent("OWNER_DECISION_APPLIED", current.work_id, "REJECT", undefined, {
      session_id: input.session_id, action: current.preview?.action, locality: "LOCAL", result_status: "DENIED",
    });
    return next;
  }
  if (!current.preview) return { ok: false, reason_code: "PREVIEW_REQUIRED" };
  if (input.decision === "EXECUTE" && current.preview.owner_approval_requirement !== "NONE") {
    return { ok: false, reason_code: "OWNER_APPROVAL_REQUIRED" };
  }
  if (isSideEffectingAction(current.preview.action) && current.preview.execution_blocked !== true) {
    return { ok: false, reason_code: "PREVIEW_REQUIRED" };
  }
  const capability = capabilityForEverydayAction(current.preview.action);
  const dest = current.preview.destination as { resource_id?: string; logical?: string | null } | null;
  const source = current.preview.source as { logical?: string | null };
  const invoked = await invokeLocalCapability({
    ai_client_id: input.ai_client_id,
    session_id: input.session_id,
    work_id: current.work_id,
    capability: capability as never,
    resource_id: String((current.preview.source as { resource_id: string }).resource_id),
    input: {
      logical_path: source.logical,
      source_logical: source.logical,
      destination_logical: dest?.logical,
      destination_resource_id: dest?.resource_id,
    },
  });
  const evidence = getLocalExecutionEvidence(current.work_id, invoked.envelope.execution_id);
  const next: OwnerReviewSurfaceV1 = {
    ...current,
    state: "RESULT",
    decision: input.decision,
    executed: invoked.ok,
    execution_id: invoked.envelope.execution_id,
    result: {
      predicted: false,
      ok: invoked.ok,
      authority: invoked.authority,
      envelope: invoked.envelope,
      invoke_result: invoked.result,
      evidence,
      source_resource_ids: current.view?.source_resource_ids ?? current.preview.affected_resources,
      canonical_action: current.preview.action,
      adapter_capability: capability,
      local_execution: invoked.envelope.execution_locality === "LOCAL",
      bytes_processed: invoked.envelope.files_read_count,
      bytes_sent_externally: invoked.envelope.external_ai_bytes_sent,
      timestamp: invoked.envelope.completed_at,
      result_status: invoked.envelope.result_status,
    },
  };
  const facing: OwnerReviewSurfaceV1 = {
    ...next,
    owner_facing: ownerFacingFrom(next, {
      who: input.ai_client_id,
      how: invoked.envelope.execution_locality === "LOCAL" ? "local" : "external",
      data: {
        bytes_processed_locally: invoked.envelope.files_read_count,
        bytes_proposed_externally: invoked.envelope.external_ai_bytes_sent,
      },
      authority: invoked.authority.decision === "OWNER_APPROVAL_REQUIRED" ? "OWNER_APPROVAL_REQUIRED" : invoked.ok ? "ALLOW" : "DENY",
      result: invoked.envelope.result_status,
      provider_metadata_expandable: { client_id: input.ai_client_id },
    }),
  };
  persistReview(facing);
  emitLocalResourceEvent("OWNER_DECISION_APPLIED", current.work_id, input.decision, invoked.envelope.execution_id, {
    session_id: input.session_id,
    resource_id: String((current.preview.source as { resource_id: string }).resource_id),
    action: current.preview.action,
    locality: "LOCAL",
    result_status: invoked.envelope.result_status,
  });
  return facing;
}

export function viewEvidenceTrace(view: CanonicalViewV1, work_id: string, execution_id?: string): Record<string, unknown> {
  const evidence = getLocalExecutionEvidence(work_id, execution_id);
  return {
    source_resource_ids: view.source_resource_ids,
    work_id,
    execution_id: execution_id ?? null,
    evidence_refs: view.evidence_refs,
    evidence,
  };
}
