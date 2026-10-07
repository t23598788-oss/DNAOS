/**
 * Launcher items from discovered applications/resources/services.
 * Display state is not authority. grants_authority is always false.
 */

import {
  discoverInstalledApplications,
  listRegisteredLocalResources,
  listRemoteServiceBindings,
  publicResourceView,
} from "../local-resource-access/contract";
import { actionsAvailableForView } from "./view-actions";
import type { CanonicalViewType, LauncherDisplayState, LauncherItemV1 } from "./types";

function lifecycleFrom(opts: {
  readonly discovered: boolean;
  readonly adapter: boolean;
  readonly owner_enabled: boolean;
  readonly unavailable: boolean;
}): LauncherItemV1["lifecycle"] {
  if (opts.unavailable) return "UNAVAILABLE";
  if (opts.owner_enabled) return "OWNER_ENABLED";
  if (opts.adapter) return "AVAILABLE";
  if (opts.discovered) return "DISCOVERED";
  return "UNAVAILABLE";
}

function displayState(lifecycle: LauncherItemV1["lifecycle"], actions: readonly string[]): LauncherDisplayState {
  if (lifecycle === "UNAVAILABLE") return "UNAVAILABLE";
  if (lifecycle === "OWNER_ENABLED" && actions.some((action) => action === "WRITE" || action === "CREATE")) return "WRITE_ENABLED";
  if (lifecycle === "OWNER_ENABLED") return "OWNER_ENABLED";
  if (actions.includes("DELETE") || actions.includes("SEND") || actions.includes("SHARE") || actions.includes("PUSH")) return "APPROVAL_REQUIRED";
  if (actions.length > 0 && actions.every((action) => action === "READ" || action === "SEARCH")) return "READ_ONLY";
  if (lifecycle === "AVAILABLE") return "AVAILABLE";
  return "UNAVAILABLE";
}

function item(
  item_id: string,
  label: string,
  kind: LauncherItemV1["kind"],
  lifecycle: LauncherItemV1["lifecycle"],
  actions_available: readonly string[],
): LauncherItemV1 {
  return {
    item_id, label, kind, lifecycle, display_state: displayState(lifecycle, actions_available),
    grants_authority: false, actions_available,
  };
}

export function listLauncherItems(ai_client_id: string, session_id: string, work_id: string): readonly LauncherItemV1[] {
  const items: LauncherItemV1[] = [];
  const filesActions = actionsAvailableForView("FILE_LIST_V1", { ai_client_id, session_id, work_id });
  const resources = listRegisteredLocalResources().map(publicResourceView);
  const hasFiles = resources.some((row) => String(row.resource_type ?? "").includes("FILE") || String(row.resource_id).includes("files"));
  const fileLife = lifecycleFrom({ discovered: hasFiles, adapter: hasFiles, owner_enabled: false, unavailable: !hasFiles });
  items.push(item("launcher://files", "Files", "FILES", fileLife, filesActions));
  items.push(item("launcher://folders", "Folders", "FOLDERS", fileLife, filesActions));
  items.push(item("launcher://documents", "Documents", "DOCUMENTS", "AVAILABLE", actionsAvailableForView("DOCUMENT_VIEW_V1", { ai_client_id, session_id, work_id })));
  items.push(item("launcher://pdf", "PDF", "PDF", "AVAILABLE", actionsAvailableForView("PDF_VIEW_V1", { ai_client_id, session_id, work_id })));
  items.push(item("launcher://images", "Images", "IMAGES", "AVAILABLE", actionsAvailableForView("IMAGE_VIEW_V1", { ai_client_id, session_id, work_id })));
  items.push(item("launcher://git", "Git", "GIT", "AVAILABLE", actionsAvailableForView("FILE_LIST_V1", { ai_client_id, session_id, work_id, source_resource_ids: ["resource://local/git/fixture-corpus"] })));
  items.push(item("launcher://activity", "Activity", "ACTIVITY", "AVAILABLE", ["READ"]));

  for (const app of discoverInstalledApplications(work_id, session_id)) {
    const actions = actionsAvailableForView("APP_RESOURCE_VIEW_V1", {
      ai_client_id, session_id, work_id, source_resource_ids: [String(app.application_id)],
    });
    const lifecycle = lifecycleFrom({
      discovered: true,
      adapter: Boolean(app.known_adapter),
      owner_enabled: app.authority_status === "OWNER_ENABLED",
      unavailable: false,
    });
    items.push(item(String(app.application_id), String(app.name ?? app.bundle_id ?? app.application_id), "APPLICATION", lifecycle, actions));
  }

  for (const service of listRemoteServiceBindings(ai_client_id, session_id)) {
    const adapter = service.canonical_action_mapping.some((row) => row.states.ADAPTER_PRESENT);
    const kind: LauncherItemV1["kind"] =
      service.provider === "github" ? "GITHUB"
      : service.provider === "gmail" || service.provider === "google_gmail" ? "EMAIL"
      : service.provider === "google_calendar" ? "CALENDAR"
      : service.provider === "google_contacts" ? "CONTACTS"
      : service.provider === "database-schema" ? "DATABASE"
      : "REMOTE_SERVICE";
    const viewType: CanonicalViewType =
      kind === "EMAIL" ? "EMAIL_VIEW_V1"
      : kind === "CALENDAR" ? "CALENDAR_VIEW_V1"
      : kind === "CONTACTS" ? "CONTACT_VIEW_V1"
      : kind === "DATABASE" ? "GENERIC_TABLE_V1"
      : "APP_RESOURCE_VIEW_V1";
    const lifecycle = lifecycleFrom({
      discovered: true,
      adapter,
      owner_enabled: service.owner_authority_state === "ALLOW",
      unavailable: service.availability === "NOT_AVAILABLE",
    });
    items.push(item(service.service_id, service.provider, kind, lifecycle, actionsAvailableForView(viewType, {
      ai_client_id, session_id, work_id, source_resource_ids: [service.service_id],
    })));
  }
  return items;
}
