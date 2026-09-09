/**
 * Google Workspace runtime adapter contract — READ-ONLY V1.
 * One connection family (connection.google.workspace.v1) / one user credential
 * (credential://google/workspace/oauth). Write intents are rejected as
 * UNSUPPORTED_ACTION before credential resolution or network calls.
 */

import type { CapabilityResultEvidence } from "../../contracts/command/capability-result";
import type { EventEnvelope } from "../../contracts/event/event-envelope";
import {
  CALENDAR_SERVICE_ID,
  DRIVE_SERVICE_ID,
  GMAIL_SERVICE_ID,
  SHEETS_SERVICE_ID,
} from "./contract";

export const GOOGLE_WORKSPACE_ADAPTER_NAME = "google-workspace" as const;
export const GOOGLE_WORKSPACE_CAPABILITY_ID = "google-workspace" as const;

export const GOOGLE_WORKSPACE_OUTCOMES = {
  SUCCESS: "SUCCESS",
  AUTH_REQUIRED: "AUTH_REQUIRED",
  SCOPE_REQUIRED: "SCOPE_REQUIRED",
  OWNER_DENIED: "OWNER_DENIED",
  UNSUPPORTED_ACTION: "UNSUPPORTED_ACTION",
  PROVIDER_ERROR: "PROVIDER_ERROR",
  TRANSPORT_ERROR: "TRANSPORT_ERROR",
} as const;

export type GoogleWorkspaceOutcomeCode =
  (typeof GOOGLE_WORKSPACE_OUTCOMES)[keyof typeof GOOGLE_WORKSPACE_OUTCOMES];

export const GOOGLE_WORKSPACE_INTENTS = {
  gmailSearch: "google.gmail.messages.search",
  gmailList: "google.gmail.messages.list",
  gmailRead: "google.gmail.messages.read",
  calendarList: "google.calendar.calendars.list",
  calendarEventsList: "google.calendar.events.list",
  driveSearch: "google.drive.files.search",
  driveList: "google.drive.files.list",
  driveMetadata: "google.drive.files.metadata",
  driveContent: "google.drive.files.content",
  sheetsMetadata: "google.sheets.spreadsheets.metadata",
  sheetsValues: "google.sheets.values.read",
} as const;

export type GoogleWorkspaceReadIntent =
  (typeof GOOGLE_WORKSPACE_INTENTS)[keyof typeof GOOGLE_WORKSPACE_INTENTS];

/** Explicit write-class intents that must fail closed as UNSUPPORTED_ACTION. */
export const GOOGLE_WORKSPACE_WRITE_INTENTS = [
  "google.gmail.messages.send",
  "google.gmail.drafts.create",
  "google.calendar.events.create",
  "google.calendar.events.update",
  "google.calendar.events.delete",
  "google.drive.files.upload",
  "google.drive.files.move",
  "google.drive.files.share",
  "google.sheets.spreadsheets.create",
  "google.sheets.values.update",
] as const;

export type GoogleWorkspaceWriteIntent = (typeof GOOGLE_WORKSPACE_WRITE_INTENTS)[number];

export const GOOGLE_WORKSPACE_EVENT_TYPES = {
  gmailSearch: "google.gmail.messages.search.completed",
  gmailList: "google.gmail.messages.list.completed",
  gmailRead: "google.gmail.messages.read.completed",
  calendarList: "google.calendar.calendars.list.completed",
  calendarEventsList: "google.calendar.events.list.completed",
  driveSearch: "google.drive.files.search.completed",
  driveList: "google.drive.files.list.completed",
  driveMetadata: "google.drive.files.metadata.completed",
  driveContent: "google.drive.files.content.completed",
  sheetsMetadata: "google.sheets.spreadsheets.metadata.completed",
  sheetsValues: "google.sheets.values.read.completed",
} as const;

export type GoogleWorkspaceService =
  | typeof GMAIL_SERVICE_ID
  | typeof CALENDAR_SERVICE_ID
  | typeof DRIVE_SERVICE_ID
  | typeof SHEETS_SERVICE_ID;

export interface GoogleWorkspaceReadPayload {
  readonly ai_identity?: string;
  readonly session_id?: string;
  readonly q?: string;
  readonly max_results?: number;
  readonly message_id?: string;
  readonly calendar_id?: string;
  readonly file_id?: string;
  readonly spreadsheet_id?: string;
  readonly range?: string;
  readonly page_token?: string;
}

export interface GoogleWorkspaceNormalizedResult {
  readonly provider: "google_workspace";
  readonly service: GoogleWorkspaceService;
  readonly action: GoogleWorkspaceReadIntent;
  readonly account_identity_non_secret: string | null;
  readonly command_id: string;
  readonly correlation_id: string;
  readonly data: unknown;
  readonly credential_source: string;
  readonly http_status: number | null;
  readonly fetched_at: string;
}

export type GoogleWorkspaceDeniedStage =
  | "classify"
  | "owner_policy"
  | "scope"
  | "authenticate"
  | "route";

export interface GoogleWorkspaceRejection {
  readonly ok: false;
  readonly outcome: Exclude<GoogleWorkspaceOutcomeCode, "SUCCESS">;
  readonly reason: string;
  readonly denied_at_stage: GoogleWorkspaceDeniedStage;
}

export type GoogleWorkspaceAdapterOutcome =
  | {
      readonly ok: true;
      readonly outcome: "SUCCESS";
      readonly event: EventEnvelope<GoogleWorkspaceNormalizedResult>;
      readonly evidence: readonly CapabilityResultEvidence[];
    }
  | {
      readonly ok: false;
      readonly rejection: GoogleWorkspaceRejection;
      readonly evidence: readonly CapabilityResultEvidence[];
    };
