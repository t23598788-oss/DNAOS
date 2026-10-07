/**
 * OWNER_WORK_SURFACE_V1 — one screen: launcher, canonical object, preview, evidence.
 * Chat is not the primary UI. Execution stays on the existing gateway.
 */

import {
  applyOwnerReviewDecision,
  attachActionPreview,
  listActivityViewRows,
  listOwnerReviews,
  normalizeAiOutputToCanonicalView,
  openOwnerReviewView,
  renderCanonicalView,
  renderActivityView,
} from "../canonical-view/contract";
import { invokeLocalCapability } from "../local-resource-access/contract";
import { macosWorkSurfaceSlice } from "../macos-native-bridge/contract";
import { productionWorkSurfaceSlice } from "../work-production-pipeline/contract";
import { ownerWorkSurfaceResponseSlice } from "../conversation-runtime/owner-response-projection";
import { ownerSurfaceSeparationSlice } from "../owner-surface-separation/contract";
import { canonicalMetrics } from "../canonical-information/query";
import { ensureSafeCanonicalIngest } from "../canonical-information/ingest-safe";
import { ownerNotificationSurfaceSlice } from "../owner-notification/contract";
import { inboundWorkSurfaceSlice } from "../inbound-event-fabric/contract";
import { productionCheckpointSurfaceSlice } from "../production-checkpoint/contract";
import { listAppLauncherItems, realAppCapabilityPack } from "./pack";
import { ownerSearch } from "./search";
import type { AppLauncherItemV1 } from "./types";

function viewTypeFor(item: AppLauncherItemV1): "FILE_LIST_V1" | "DOCUMENT_VIEW_V1" | "PDF_VIEW_V1" | "IMAGE_VIEW_V1" | "EMAIL_VIEW_V1" | "CALENDAR_VIEW_V1" | "CONTACT_VIEW_V1" | "GENERIC_TABLE_V1" | "ACTIVITY_VIEW_V1" | "APP_RESOURCE_VIEW_V1" {
  const view = item.primary_view;
  if (view === "FILE_LIST_V1" || view === "DOCUMENT_VIEW_V1" || view === "PDF_VIEW_V1" || view === "IMAGE_VIEW_V1"
    || view === "EMAIL_VIEW_V1" || view === "CALENDAR_VIEW_V1" || view === "CONTACT_VIEW_V1"
    || view === "GENERIC_TABLE_V1" || view === "ACTIVITY_VIEW_V1" || view === "APP_RESOURCE_VIEW_V1") {
    return view;
  }
  return "SAFE_GENERIC_VIEW" as never;
}

function resourceIdsFor(item: AppLauncherItemV1): readonly string[] {
  if (item.app_id.startsWith("launcher://files") || item.app_id.startsWith("launcher://folders") || item.app_id.startsWith("launcher://documents") || item.app_id.startsWith("launcher://pdf") || item.app_id.startsWith("launcher://images")) {
    return ["resource://local/files/fixture-corpus"];
  }
  if (item.app_id === "launcher://git") return ["resource://local/git/fixture-corpus"];
  if (item.app_id === "launcher://activity") return [];
  return [item.app_id];
}

export function ownerWorkSurfaceSnapshot(ai_client_id = "ai://circuit-ui", session_id = "session-circuit-ui"): Record<string, unknown> {
  const reviews = listOwnerReviews();
  const latest = reviews[reviews.length - 1] ?? null;
  const launcher = listAppLauncherItems(ai_client_id, session_id, latest?.work_id ?? "work-circuit-ui");
  const pack = realAppCapabilityPack(ai_client_id, session_id, latest?.work_id ?? "work-circuit-ui");
  return {
    schema: "OWNER_WORK_SURFACE_V1",
    layout: { top: "search_command_work", left: "launcher", center: "VIEW_PREVIEW_RESULT", right: "context_actions_evidence", activity: "canonical_events" },
    chat_is_primary: false,
    grants_authority: false,
    ai_arbitrary_layout_authority: false,
    ai_provider_grants_authority: false,
    unused_services_secondary: true,
    launcher_primary: launcher.filter((row) => !row.secondary_catalog),
    launcher_secondary: launcher.filter((row) => row.secondary_catalog),
    pack,
    latest,
    center_state: latest?.state ?? "VIEW",
    activity: listActivityViewRows().slice(-20),
    owner_facing: latest?.owner_facing ?? null,
    macos_native: macosWorkSurfaceSlice(ai_client_id, session_id, latest?.work_id ?? "work-circuit-ui"),
    production_pipeline: productionWorkSurfaceSlice(),
    owner_response: ownerWorkSurfaceResponseSlice(),
    surface_separation: ownerSurfaceSeparationSlice(),
    canonical_information: (() => { ensureSafeCanonicalIngest(); return { ...canonicalMetrics(), INFORMATION_ACCESS_GRANTS_AUTHORITY: false }; })(),
    owner_notifications: ownerNotificationSurfaceSlice(),
    inbound_work: inboundWorkSurfaceSlice(),
    production_checkpoints: productionCheckpointSurfaceSlice(),
  };
}

export async function openOwnerWorkItem(input: {
  readonly app_id: string;
  readonly ai_client_id: string;
  readonly session_id: string;
  readonly work_id: string;
  readonly logical_path?: string;
}): Promise<Record<string, unknown>> {
  const launcher = listAppLauncherItems(input.ai_client_id, input.session_id, input.work_id);
  const item = launcher.find((row) => row.app_id === input.app_id);
  if (!item) return { ok: false, reason_code: "UNKNOWN_LAUNCHER_ITEM", grants_authority: false };
  if (item.app_id.includes("gmail") || item.category === "EMAIL") {
    return { ok: true, EMAIL_RUNTIME_BINDING: "NOT_AVAILABLE", view: renderCanonicalView({ view_type: "EMAIL_VIEW_V1", fields: { runtime_binding: "NOT_AVAILABLE" }, actions_available: [], authority_state: "DENY" }), grants_authority: false };
  }
  if (item.category === "CALENDAR" || item.category === "CONTACTS") {
    return { ok: true, runtime_binding: "NOT_AVAILABLE", view: renderCanonicalView({ view_type: item.category === "CALENDAR" ? "CALENDAR_VIEW_V1" : "CONTACT_VIEW_V1", fields: { runtime_binding: "NOT_AVAILABLE" }, actions_available: [], authority_state: "DENY" }), grants_authority: false };
  }
  if (item.category === "DATABASE") {
    return {
      ok: true,
      runtime_binding: "NOT_AVAILABLE",
      write_enabled: false,
      view: renderCanonicalView({
        view_type: "SAFE_GENERIC_VIEW",
        fields: { SCHEMA_READ: "CONTRACT", SEARCH: "CONTRACT", READ: "CONTRACT", CREATE: "DISABLED", WRITE: "DISABLED", DELETE: "DISABLED" },
        actions_available: ["READ"],
        authority_state: "DENY",
      }),
      grants_authority: false,
    };
  }
  if (item.category === "ACTIVITY") {
    return { ok: true, view: renderActivityView(input.work_id), grants_authority: false };
  }
  if (item.app_id.includes("github") || item.category === "GIT" && item.app_id.includes("github")) {
    const identity = await invokeLocalCapability({
      ai_client_id: input.ai_client_id,
      session_id: input.session_id,
      work_id: input.work_id,
      capability: "local.remote.github.read_identity",
      resource_id: "resource://local/remote/github",
      input: {},
    });
    const opened = openOwnerReviewView({
      work_id: input.work_id,
      ai_client_id: input.ai_client_id,
      session_id: input.session_id,
      view_type: "APP_RESOURCE_VIEW_V1",
      source_resource_ids: ["service://github/source-authority", "resource://local/remote/github"],
      fields: {
        repository: identity.ok ? identity.result.account_identity_non_secret : null,
        credential_ref: identity.ok ? identity.result.credential_ref : null,
        secret_exposed: false,
        branch: null,
        commit: null,
        diff: null,
        issue: null,
        pull_request: null,
        publication_auth_ok: identity.ok ? identity.result.publication_auth_ok : false,
      },
    });
    return { ok: identity.ok, review: opened, github: identity.ok ? identity.result : identity.result, secret_exposed: false };
  }
  const view_type = viewTypeFor(item);
  const path = input.logical_path;
  const macos = macosWorkSurfaceSlice(input.ai_client_id, input.session_id, input.work_id);
  const fields = path
    ? { logical_path: path, opened: true, macos }
    : { opened: true, macos };
  const opened = openOwnerReviewView({
    work_id: input.work_id,
    ai_client_id: input.ai_client_id,
    session_id: input.session_id,
    view_type: view_type === "SAFE_GENERIC_VIEW" as never ? "FILE_LIST_V1" : view_type,
    source_resource_ids: [...resourceIdsFor(item)],
    fields,
  });
  return { ok: true, review: opened, grants_authority: false, APP_ICON_GRANTS_AUTHORITY: false };
}

export async function requestOwnerWorkAction(input: {
  readonly review_id: string;
  readonly action: string;
  readonly resource_id: string;
  readonly work_id: string;
  readonly payload?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const previewed = attachActionPreview(input.review_id, {
    work_id: input.work_id,
    action: input.action,
    resource_id: input.resource_id,
    input: input.payload ?? {},
  });
  if ("ok" in previewed && previewed.ok === false) return previewed;
  return {
    ok: true,
    review: previewed,
    executed: false,
    SIDE_EFFECT_PREVIEW_REQUIRED: true,
    owner_facing: "owner_facing" in previewed ? previewed.owner_facing : null,
  };
}

export { applyOwnerReviewDecision, normalizeAiOutputToCanonicalView, ownerSearch };
