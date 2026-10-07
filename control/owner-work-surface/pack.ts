/**
 * REAL_APP_CAPABILITY_PACK_V1 — actual registered capabilities, never invented UI workflows.
 */

import {
  getApplicationCapabilities,
  getRemoteServiceBinding,
  listApplicationInventory,
  listRemoteServiceBindings,
} from "../local-resource-access/contract";
import { actionsAvailableForView, listLauncherItems } from "../canonical-view/contract";
import { listDevices } from "../local-tool-fabric/contract";
import type { AppLauncherCategory, AppLauncherItemV1, EmailWorkSurfaceV1, RealAppCapabilityPackV1 } from "./types";

const PRIMARY_KINDS = new Set(["FILES", "FOLDERS", "DOCUMENTS", "PDF", "IMAGES", "GIT", "GITHUB", "ACTIVITY", "APPLICATION"]);

function categoryFor(kind: string, item_id: string): AppLauncherCategory {
  if (kind === "FILES") return "FILES";
  if (kind === "FOLDERS") return "FOLDERS";
  if (kind === "DOCUMENTS") return "DOCUMENTS";
  if (kind === "PDF") return "PDF";
  if (kind === "IMAGES") return "IMAGES";
  if (kind === "EMAIL") return "EMAIL";
  if (kind === "CALENDAR") return "CALENDAR";
  if (kind === "CONTACTS") return "CONTACTS";
  if (kind === "GIT" || kind === "GITHUB") return "GIT";
  if (kind === "DATABASE") return "DATABASE";
  if (kind === "APPLICATION") return "LOCAL_APPS";
  if (kind === "ACTIVITY") return "ACTIVITY";
  if (item_id.includes("google") || item_id.includes("gmail")) return "REMOTE_SERVICES";
  return "REMOTE_SERVICES";
}

function primaryView(kind: string): string {
  if (kind === "FILES" || kind === "FOLDERS" || kind === "GIT") return "FILE_LIST_V1";
  if (kind === "DOCUMENTS") return "DOCUMENT_VIEW_V1";
  if (kind === "PDF") return "PDF_VIEW_V1";
  if (kind === "IMAGES") return "IMAGE_VIEW_V1";
  if (kind === "EMAIL") return "EMAIL_VIEW_V1";
  if (kind === "CALENDAR") return "CALENDAR_VIEW_V1";
  if (kind === "CONTACTS") return "CONTACT_VIEW_V1";
  if (kind === "DATABASE") return "GENERIC_TABLE_V1";
  if (kind === "ACTIVITY") return "ACTIVITY_VIEW_V1";
  return "APP_RESOURCE_VIEW_V1";
}

export function listAppLauncherItems(ai_client_id: string, session_id: string, work_id: string): readonly AppLauncherItemV1[] {
  const items = listLauncherItems(ai_client_id, session_id, work_id).map((row) => ({
    schema: "APP_LAUNCHER_ITEM_V1" as const,
    app_id: row.item_id,
    display_name: row.label,
    icon_ref: `icon://${row.kind.toLowerCase()}`,
    category: categoryFor(row.kind, row.item_id),
    availability: row.display_state,
    owner_enabled: row.lifecycle === "OWNER_ENABLED",
    connection_state: row.lifecycle,
    capabilities: row.actions_available,
    primary_view: primaryView(row.kind),
    badge_status: row.display_state,
    grants_authority: false as const,
    secondary_catalog: !PRIMARY_KINDS.has(row.kind) || row.lifecycle === "UNAVAILABLE",
  }));
  const deviceItems: AppLauncherItemV1[] = listDevices().map((device) => ({
    schema: "APP_LAUNCHER_ITEM_V1",
    app_id: device.device_id,
    display_name: device.device_type,
    icon_ref: `icon://device/${device.device_type.toLowerCase()}`,
    category: "LOCAL_APPS",
    availability: device.resource_id ? "READ_ONLY" : "UNAVAILABLE",
    owner_enabled: false,
    connection_state: device.availability,
    capabilities: device.resource_id ? ["READ"] : [],
    primary_view: "APP_RESOURCE_VIEW_V1",
    badge_status: device.resource_id ? "READ_ONLY" : "UNAVAILABLE",
    grants_authority: false,
    secondary_catalog: !device.resource_id,
  }));
  return [...items, ...deviceItems];
}

export function emailWorkSurface(ai_client_id: string, session_id: string): EmailWorkSurfaceV1 {
  const binding = getRemoteServiceBinding("service://google/gmail", ai_client_id, session_id);
  const available = binding?.availability === "BOUND";
  return {
    schema: "EMAIL_WORK_SURFACE_V1",
    runtime_binding: available ? "BOUND" : "NOT_AVAILABLE",
    message_id: null,
    thread_id: null,
    sender: null,
    recipients: [],
    subject: null,
    timestamp: null,
    body_content: null,
    attachments: [],
    source_connection: binding?.connection_id ?? null,
    authority_state: "DENY",
    available_actions: actionsAvailableForView("EMAIL_VIEW_V1", { ai_client_id, session_id, work_id: "work-email-surface" }),
    evidence_refs: [],
    send_preview_contract: [
      "recipient", "cc", "bcc", "subject", "attachment_names", "attachment_bytes",
      "data_classification", "external_destination", "total_egress_bytes", "approval_state",
    ],
  };
}

export function realAppCapabilityPack(ai_client_id: string, session_id: string, work_id: string): RealAppCapabilityPackV1 {
  const services = listRemoteServiceBindings(ai_client_id, session_id);
  const by = (id: string) => services.find((row) => row.service_id === id) ?? null;
  const gmail = by("service://google/gmail");
  const drive = by("service://google/drive");
  const calendar = by("service://google/calendar");
  const contacts = by("service://google/contacts");
  const github = by("service://github/source-authority");
  const database = by("service://database/schema-read");
  const apps = listApplicationInventory(ai_client_id, session_id).map((row) => ({
    application_id: String(row.application_id ?? ""),
    capabilities: getApplicationCapabilities(String(row.application_id ?? ""), ai_client_id, session_id),
    usage_authorized: row.usage_authorized === true,
    everyday_actions: row.supported_canonical_actions,
  }));
  return {
    schema: "REAL_APP_CAPABILITY_PACK_V1",
    files: { view: "FILE_LIST_V1", actions: actionsAvailableForView("FILE_LIST_V1", { ai_client_id, session_id, work_id }) },
    documents: { view: "DOCUMENT_VIEW_V1", actions: actionsAvailableForView("DOCUMENT_VIEW_V1", { ai_client_id, session_id, work_id }) },
    pdf: { view: "PDF_VIEW_V1", actions: actionsAvailableForView("PDF_VIEW_V1", { ai_client_id, session_id, work_id }) },
    email: emailWorkSurface(ai_client_id, session_id),
    calendar: {
      runtime_binding: calendar?.availability ?? "NOT_AVAILABLE",
      actions: actionsAvailableForView("CALENDAR_VIEW_V1", { ai_client_id, session_id, work_id }),
      write_enabled: false,
    },
    contacts: {
      runtime_binding: contacts?.availability ?? "NOT_AVAILABLE",
      actions: actionsAvailableForView("CONTACT_VIEW_V1", { ai_client_id, session_id, work_id }),
    },
    github: {
      runtime_binding: github?.availability ?? "NOT_AVAILABLE",
      credential_ref: github?.credential_ref ?? null,
      secret_exposed: false,
      actions: actionsAvailableForView("APP_RESOURCE_VIEW_V1", {
        ai_client_id, session_id, work_id, source_resource_ids: ["service://github/source-authority"],
      }),
      mapped: ["SEARCH", "READ", "DIFF", "COMMIT", "PUSH", "ISSUE", "PULL_REQUEST"],
    },
    database: {
      runtime_binding: database?.canonical_action_mapping.find((row) => row.action === "SCHEMA_READ")?.states.RUNTIME_VERIFIED === true ? "BOUND" : "NOT_AVAILABLE",
      search_read: ["SCHEMA_READ", "SEARCH", "READ"],
      write_enabled: database?.canonical_action_mapping.find((row) => row.action === "WRITE")?.states.OWNER_ENABLED === true,
    },
    local_applications: apps,
    google: {
      gmail: gmail?.availability ?? "NOT_AVAILABLE",
      drive: drive?.availability ?? "NOT_AVAILABLE",
      calendar: calendar?.availability ?? "NOT_AVAILABLE",
      contacts: contacts?.availability ?? "NOT_AVAILABLE",
      account_session_grants_authority: false,
    },
  };
}
