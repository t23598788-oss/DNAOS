/**
 * View actions are the intersection of the registered view catalog and real bindings.
 * Discovery and UI labels never invent COMMIT/SEND/DELETE adapters that are not present.
 */

import { listRemoteServiceBindings, resolveCapabilityBindings } from "../local-resource-access/contract";
import { VIEW_ACTIONS } from "./schemas";
import type { CanonicalViewType } from "./types";

export interface ViewActionContext {
  readonly ai_client_id: string;
  readonly session_id: string;
  readonly work_id?: string;
  readonly source_resource_ids?: readonly string[];
}

const BINDABLE = new Set([
  "SEARCH", "READ", "CREATE", "WRITE", "COPY", "MOVE", "RENAME", "DELETE",
  "ARCHIVE", "SUMMARIZE", "EXTRACT", "CONVERT", "COMPARE", "SEND", "COMMIT", "PUSH",
  "DOWNLOAD_ATTACHMENT",
]);

function remoteAdapterPresent(action: string, ai: string, session: string, providers: readonly string[]): boolean {
  for (const service of listRemoteServiceBindings(ai, session)) {
    if (providers.length > 0 && !providers.includes(service.provider)) continue;
    const mapped = service.canonical_action_mapping.find((row) => row.action === action || row.canonical === action);
    if (mapped?.states.ADAPTER_PRESENT) return true;
  }
  return false;
}

function localFilesystemDeclares(action: string, ctx: ViewActionContext): boolean {
  if (!BINDABLE.has(action)) return false;
  const ranked = resolveCapabilityBindings({
    action: action as never,
    ai_identity: ctx.ai_client_id,
    session_id: ctx.session_id,
    work_id: ctx.work_id,
    required_locality: "LOCAL",
  });
  return ranked.some((row) => row.provider === "macos-filesystem");
}

export function actionsAvailableForView(view_type: CanonicalViewType, ctx: ViewActionContext): readonly string[] {
  const candidates = VIEW_ACTIONS[view_type] ?? ["READ"];
  return candidates.filter((action) => {
    if (view_type === "FILE_LIST_V1" || view_type === "PDF_VIEW_V1" || view_type === "IMAGE_VIEW_V1" || view_type === "DOCUMENT_VIEW_V1" || view_type === "TRANSFER_VIEW_V1") {
      return localFilesystemDeclares(action, ctx) || action === "READ";
    }
    if (view_type === "GENERIC_TABLE_V1" || view_type === "ACTIVITY_VIEW_V1" || view_type === "SAFE_GENERIC_VIEW") {
      return action === "READ" || action === "SEARCH" || action === "EXPORT";
    }
    if (view_type === "EMAIL_VIEW_V1" || view_type === "MESSAGE_VIEW_V1") {
      return remoteAdapterPresent(action, ctx.ai_client_id, ctx.session_id, ["gmail", "google_gmail"]);
    }
    if (view_type === "CALENDAR_VIEW_V1") {
      return remoteAdapterPresent(action, ctx.ai_client_id, ctx.session_id, ["google_calendar"]);
    }
    if (view_type === "CONTACT_VIEW_V1") {
      return remoteAdapterPresent(action, ctx.ai_client_id, ctx.session_id, ["google_contacts"]);
    }
    if (view_type === "APP_RESOURCE_VIEW_V1") {
      const ids = ctx.source_resource_ids ?? [];
      const github = ids.some((id) => id.includes("github"));
      if (github && (action === "COMMIT" || action === "PUSH" || action === "SEARCH" || action === "READ")) {
        return remoteAdapterPresent(action, ctx.ai_client_id, ctx.session_id, ["github"]);
      }
      return action === "READ";
    }
    return action === "READ";
  });
}
