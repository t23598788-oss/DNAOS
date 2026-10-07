/**
 * Canonical Google Workspace OAuth *client* configuration (non-secret).
 * Owner admits values later; source alone never implies CONFIGURED.
 * Raw client_secret must never appear here.
 */

import {
  GOOGLE_CONNECTION_ID,
  GOOGLE_OAUTH_CALLBACK_PATH,
  GOOGLE_OAUTH_CLIENT_ID_REF,
  GOOGLE_OAUTH_CLIENT_SECRET_REF,
} from "../contract";

export const GOOGLE_OAUTH_APPLICATION_TYPE = "WEB_APPLICATION" as const;
export type GoogleOauthApplicationType = typeof GOOGLE_OAUTH_APPLICATION_TYPE;

export const GOOGLE_OAUTH_ENVIRONMENTS = ["TESTING", "PRODUCTION"] as const;
export type GoogleOauthAppEnvironment = (typeof GOOGLE_OAUTH_ENVIRONMENTS)[number];

export type GoogleOauthClientConfigStatus = "CONFIGURATION_REQUIRED" | "CONFIGURED";

export interface GoogleOauthClientConfigRecord {
  connection_id: typeof GOOGLE_CONNECTION_ID;
  environment: GoogleOauthAppEnvironment;
  google_cloud_project_id: string;
  oauth_client_id: string;
  oauth_client_id_ref: typeof GOOGLE_OAUTH_CLIENT_ID_REF;
  oauth_client_secret_ref: typeof GOOGLE_OAUTH_CLIENT_SECRET_REF;
  redirect_uri: string;
  application_type: GoogleOauthApplicationType;
  status: GoogleOauthClientConfigStatus;
  admitted_at: string;
  updated_at: string;
}

export const REGISTER_GOOGLE_WORKSPACE_OAUTH_CLIENT_ACTION =
  "REGISTER_GOOGLE_WORKSPACE_OAUTH_CLIENT" as const;

export interface GoogleOauthClientAdmissionApproval {
  action: typeof REGISTER_GOOGLE_WORKSPACE_OAUTH_CLIENT_ACTION;
  connection_id: string;
  environment: GoogleOauthAppEnvironment;
  google_cloud_project_id: string;
  google_oauth_client_id: string;
  client_secret_ref: typeof GOOGLE_OAUTH_CLIENT_SECRET_REF;
  redirect_uri: string;
  application_type: GoogleOauthApplicationType;
}

export interface GoogleOauthClientAdmissionInput {
  owner_session_id: string;
  approval: GoogleOauthClientAdmissionApproval;
  google_app_environment: GoogleOauthAppEnvironment;
  google_cloud_project_id: string;
  google_oauth_client_id: string;
  google_oauth_client_secret: string;
  google_redirect_uri: string;
}

export type GoogleOauthClientAdmissionResult =
  | {
      ok: true;
      client_configuration_state: "CONFIGURED";
      connection_id: typeof GOOGLE_CONNECTION_ID;
      environment: GoogleOauthAppEnvironment;
      google_cloud_project_id: string;
      oauth_client_id: string;
      oauth_client_id_ref: typeof GOOGLE_OAUTH_CLIENT_ID_REF;
      oauth_client_secret_ref: typeof GOOGLE_OAUTH_CLIENT_SECRET_REF;
      redirect_uri: string;
      application_type: GoogleOauthApplicationType;
      authorization_transaction_created: false;
      login_started: false;
    }
  | {
      ok: false;
      reason_code: string;
      detail: string;
      client_configuration_state: "CONFIGURATION_REQUIRED";
    };

export interface GoogleOauthClientConfigurationView {
  client_configuration_state: GoogleOauthClientConfigStatus;
  connection_id: typeof GOOGLE_CONNECTION_ID;
  environment: GoogleOauthAppEnvironment | null;
  google_cloud_project_id: string | null;
  oauth_client_id: string | null;
  oauth_client_id_ref: typeof GOOGLE_OAUTH_CLIENT_ID_REF;
  oauth_client_secret_ref: typeof GOOGLE_OAUTH_CLIENT_SECRET_REF;
  redirect_uri: string | null;
  application_type: GoogleOauthApplicationType;
  configured: boolean;
  missing: readonly string[];
  /** Never includes client_secret. */
}

export const CANONICAL_CALLBACK_PATH = GOOGLE_OAUTH_CALLBACK_PATH;
