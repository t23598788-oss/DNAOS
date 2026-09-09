/**
 * Canonical Google Workspace connection-family contract.
 * One identity / one user credential_ref / four service capabilities.
 * OAuth secrets never appear here — pointer shapes and scopes only.
 */

export const GOOGLE_CONNECTION_ID = "connection.google.workspace.v1" as const;

/** Future user access/refresh token pointer (Owner login — separate admission). */
export const GOOGLE_CREDENTIAL_REF = "credential://google/workspace/oauth" as const;

/** DNA OS–owned OAuth client public id pointer. */
export const GOOGLE_OAUTH_CLIENT_ID_REF = "credential://google/workspace/oauth-client/client-id" as const;

/** DNA OS–owned OAuth client secret pointer (Keychain only). */
export const GOOGLE_OAUTH_CLIENT_SECRET_REF = "credential://google/workspace/oauth-client/client-secret" as const;

export const GOOGLE_OAUTH_CALLBACK_PATH = "/oauth/google/workspace/callback" as const;
export const GOOGLE_OAUTH_BEGIN_PATH = "/oauth/google/workspace/begin" as const;
export const GOOGLE_OAUTH_CALLBACK_URI_TESTING = `http://127.0.0.1:8791${GOOGLE_OAUTH_CALLBACK_PATH}` as const;

export const GOOGLE_OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth" as const;
export const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token" as const;
export const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo" as const;

export const GMAIL_SERVICE_ID = "service://google/gmail" as const;
export const CALENDAR_SERVICE_ID = "service://google/calendar" as const;
export const DRIVE_SERVICE_ID = "service://google/drive" as const;
export const SHEETS_SERVICE_ID = "service://google/sheets" as const;
export const CONTACTS_SERVICE_ID = "service://google/contacts" as const;

export const GMAIL_CAPABILITY_ID = "google.gmail.readonly" as const;
export const CALENDAR_CAPABILITY_ID = "google.calendar.readonly" as const;
export const DRIVE_CAPABILITY_ID = "google.drive.readonly" as const;
export const SHEETS_CAPABILITY_ID = "google.sheets.readonly" as const;

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly" as const;
export const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
] as const;
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly" as const;
export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly" as const;

/**
 * Standard OIDC scopes required to resolve GOOGLE_ACCOUNT_ID via userinfo.
 * Documented explicitly — not silent Workspace-scope broadening.
 */
export const GOOGLE_IDENTITY_SCOPES = ["openid", "email"] as const;

export const GOOGLE_WORKSPACE_READONLY_SCOPES = [
  GMAIL_SCOPE,
  ...CALENDAR_SCOPES,
  DRIVE_SCOPE,
  SHEETS_SCOPE,
] as const;

export const GOOGLE_AUTHORIZE_SCOPES = [
  ...GOOGLE_IDENTITY_SCOPES,
  ...GOOGLE_WORKSPACE_READONLY_SCOPES,
] as const;

export const WRITE_ENABLED = false as const;

export const FORBIDDEN_WRITE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
] as const;

export const DENIED_WRITE_OPERATIONS = [
  "SEND", "CREATE_DRAFT", "CREATE", "WRITE", "DELETE", "UPLOAD", "MOVE", "SHARE",
] as const;

export const OFFICIAL_WORKSPACE_MCP_POSTURE = {
  client_direct_access: false,
  read_only: true,
  dna_os_is_authority: true,
  note: "Any official Google Workspace MCP must be reached only via DNA OS grant + this connection family",
} as const;

/** Deadboard Edge env names — must never be the Workspace family client. */
export const DEADBOARD_GMAIL_CLIENT_ENV_NAMES = [
  "GMAIL_CLIENT_ID",
  "GMAIL_CLIENT_SECRET",
  "GMAIL_REFRESH_TOKEN",
] as const;

export type GoogleServiceState = "CONNECTED" | "AUTH_REQUIRED" | "REVOKED" | "AUTH_EXPIRED";

export type GoogleParentState =
  | "NOT_CONNECTED"
  | "AUTHORIZING"
  | "CONNECTED"
  | "PARTIALLY_AUTHORIZED"
  | "AUTH_EXPIRED"
  | "REVOKED"
  | "OUT_OF_SYNC";
