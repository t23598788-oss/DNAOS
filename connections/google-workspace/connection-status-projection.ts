/**
 * Google Workspace connection status projection.
 *
 * STATE AUTHORITY = oauth/store.ts → authorizations.jsonl.
 * connection-document.json is DOCUMENTATION_PROJECTION only — never invent CONNECTED.
 *
 * Intentionally avoids credentials/* and remote-service-binding so conversation-runtime
 * dependency gates stay closed.
 */

import { findRecord } from "./oauth/store";
import {
  CALENDAR_SCOPES,
  DRIVE_SCOPE,
  GMAIL_SCOPE,
  GOOGLE_CONNECTION_ID,
  GOOGLE_CREDENTIAL_REF,
  SHEETS_SCOPE,
  WRITE_ENABLED,
} from "./contract";
import type { GoogleParentState, GoogleServiceState } from "./contract";

export const CONNECTION_DOCUMENT_ROLE = "DOCUMENTATION_PROJECTION" as const;

export interface GoogleWorkspaceStatusProjection {
  readonly connection_id: typeof GOOGLE_CONNECTION_ID;
  readonly state_source: "connections/google-workspace/oauth/data/authorizations.jsonl";
  readonly connection_document_role: typeof CONNECTION_DOCUMENT_ROLE;
  readonly state: GoogleParentState | "DATA_MISSING" | "OUT_OF_SYNC";
  readonly account_email: string | null;
  readonly google_account_id: string | null;
  readonly credential_ref: string | null;
  readonly write_enabled: false;
  readonly environment: "TESTING" | "PRODUCTION" | "UNKNOWN";
  readonly production_ready: false;
  readonly capabilities: {
    readonly gmail: GoogleServiceState | "DATA_MISSING";
    readonly calendar: GoogleServiceState | "DATA_MISSING";
    readonly drive: GoogleServiceState | "DATA_MISSING";
    readonly sheets: GoogleServiceState | "DATA_MISSING";
  };
  readonly evidence_ref: string;
}

function hasAll(granted: readonly string[], required: readonly string[]): boolean {
  const set = new Set(granted);
  return required.every((s) => set.has(s));
}

function capabilityFromScopes(
  parentState: string,
  granted: readonly string[] | null,
  required: readonly string[],
): GoogleServiceState | "DATA_MISSING" {
  if (parentState !== "CONNECTED" && parentState !== "PARTIALLY_AUTHORIZED") {
    return parentState === "REVOKED" ? "REVOKED" : parentState === "AUTH_EXPIRED" ? "AUTH_EXPIRED" : "AUTH_REQUIRED";
  }
  if (!granted) return "DATA_MISSING";
  return hasAll(granted, required) ? "CONNECTED" : "AUTH_REQUIRED";
}

function parentFromAuth(state: string): GoogleParentState {
  if (state === "CONNECTED") return "CONNECTED";
  if (state === "PARTIALLY_AUTHORIZED") return "PARTIALLY_AUTHORIZED";
  if (state === "AUTHORIZATION_PENDING" || state === "AUTHORIZING") return "AUTHORIZING";
  if (state === "AUTH_EXPIRED") return "AUTH_EXPIRED";
  if (state === "REVOKED") return "REVOKED";
  return "NOT_CONNECTED";
}

/**
 * Project Owner/UI status from runtime authorization store.
 * Never fabricates CONNECTED when the authorization store has no record.
 */
export function projectGoogleWorkspaceConnectionStatus(): GoogleWorkspaceStatusProjection {
  const evidence_ref = "connections/google-workspace/oauth/data/authorizations.jsonl";
  const record = findRecord(GOOGLE_CONNECTION_ID);

  if (!record) {
    return {
      connection_id: GOOGLE_CONNECTION_ID,
      state_source: evidence_ref,
      connection_document_role: CONNECTION_DOCUMENT_ROLE,
      state: "DATA_MISSING",
      account_email: null,
      google_account_id: null,
      credential_ref: null,
      write_enabled: WRITE_ENABLED,
      environment: "UNKNOWN",
      production_ready: false,
      capabilities: {
        gmail: "DATA_MISSING",
        calendar: "DATA_MISSING",
        drive: "DATA_MISSING",
        sheets: "DATA_MISSING",
      },
      evidence_ref,
    };
  }

  const parent = parentFromAuth(record.state);
  const granted = record.granted_scope;
  const capabilities = {
    gmail: capabilityFromScopes(record.state, granted, [GMAIL_SCOPE]),
    calendar: capabilityFromScopes(record.state, granted, [...CALENDAR_SCOPES]),
    drive: capabilityFromScopes(record.state, granted, [DRIVE_SCOPE]),
    sheets: capabilityFromScopes(record.state, granted, [SHEETS_SCOPE]),
  };

  const childrenConnected =
    capabilities.gmail === "CONNECTED"
    && capabilities.calendar === "CONNECTED"
    && capabilities.drive === "CONNECTED"
    && capabilities.sheets === "CONNECTED";

  let state: GoogleWorkspaceStatusProjection["state"] = parent;
  if (parent === "CONNECTED" && !childrenConnected) {
    const anyBound = Object.values(capabilities).some((s) => s === "CONNECTED");
    state = anyBound ? "PARTIALLY_AUTHORIZED" : "OUT_OF_SYNC";
  }

  return {
    connection_id: GOOGLE_CONNECTION_ID,
    state_source: evidence_ref,
    connection_document_role: CONNECTION_DOCUMENT_ROLE,
    state,
    account_email: record.account_email,
    google_account_id: record.google_account_id,
    credential_ref: record.credential_ref ?? GOOGLE_CREDENTIAL_REF,
    write_enabled: WRITE_ENABLED,
    environment: "TESTING",
    production_ready: false,
    capabilities,
    evidence_ref,
  };
}

/** Fail closed: CONNECTED runtime must never be projected as NOT_CONNECTED. */
export function assertRuntimeCannotRenderNotConnected(
  runtimeState: string,
  projectedUiState: string,
): { ok: true } | { ok: false; reason: "OUT_OF_SYNC" } {
  if (runtimeState === "CONNECTED" && projectedUiState === "NOT_CONNECTED") {
    return { ok: false, reason: "OUT_OF_SYNC" };
  }
  return { ok: true };
}
