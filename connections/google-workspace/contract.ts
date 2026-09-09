/**
 * Canonical Google Workspace connection-family contract (reuse wiring only).
 * One identity / one credential_ref / multiple service capabilities.
 * No OAuth secrets here — pointer shapes and required scopes only.
 */

export const GOOGLE_CONNECTION_ID = "connection.google.workspace.v1" as const;

/** Pointer only — never a token value. Convention: credential://google/<family>/<purpose> */
export const GOOGLE_CREDENTIAL_REF = "credential://google/workspace/oauth" as const;

export const GMAIL_SERVICE_ID = "service://google/gmail" as const;
export const CALENDAR_SERVICE_ID = "service://google/calendar" as const;
export const DRIVE_SERVICE_ID = "service://google/drive" as const;
export const SHEETS_SERVICE_ID = "service://google/sheets" as const;
/** Existing sibling in the same family (already declared); not a V1 live target. */
export const CONTACTS_SERVICE_ID = "service://google/contacts" as const;

export const GMAIL_CAPABILITY_ID = "google.gmail.readonly" as const;
export const CALENDAR_CAPABILITY_ID = "google.calendar.readonly" as const;
export const DRIVE_CAPABILITY_ID = "google.drive.readonly" as const;
export const SHEETS_CAPABILITY_ID = "google.sheets.readonly" as const;

/** Least-privilege V1 scopes (URLs). Track granted scopes individually at runtime. */
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly" as const;
export const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
] as const;
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly" as const;
export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly" as const;

export const WRITE_ENABLED = false as const;

export const DENIED_WRITE_OPERATIONS = [
  "SEND",
  "CREATE_DRAFT",
  "CREATE",
  "WRITE",
  "DELETE",
  "UPLOAD",
  "MOVE",
  "SHARE",
] as const;

export const OFFICIAL_WORKSPACE_MCP_POSTURE = {
  client_direct_access: false,
  read_only: true,
  dna_os_is_authority: true,
  note: "Any official Google Workspace MCP must be reached only via DNA OS grant + this connection family",
} as const;

export type GoogleServiceState = "CONNECTED" | "AUTH_REQUIRED" | "REVOKED" | "AUTH_EXPIRED";

export type GoogleParentState =
  | "NOT_CONNECTED"
  | "AUTHORIZING"
  | "CONNECTED"
  | "PARTIALLY_AUTHORIZED"
  | "AUTH_EXPIRED"
  | "REVOKED"
  | "OUT_OF_SYNC";
