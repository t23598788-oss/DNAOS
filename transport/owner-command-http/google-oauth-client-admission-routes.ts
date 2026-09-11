/**
 * Thin Owner HTTP route: admit Google Workspace OAuth client configuration.
 * POST /owner/google-workspace/oauth-client
 * Never returns client_secret; never begins Google login.
 */

import { admitGoogleOauthClient, getGoogleOauthClientConfigurationView } from "../../connections/google-workspace/oauth/client-admission";
import { coreNodeUnavailableForCapability } from "./mac-local-agent-gate";
import {
  GOOGLE_OAUTH_APPLICATION_TYPE,
  REGISTER_GOOGLE_WORKSPACE_OAUTH_CLIENT_ACTION,
  type GoogleOauthAppEnvironment,
  type GoogleOauthClientAdmissionApproval,
} from "../../connections/google-workspace/oauth/client-config-types";
import { GOOGLE_CONNECTION_ID, GOOGLE_OAUTH_CLIENT_SECRET_REF } from "../../connections/google-workspace/contract";

export interface GoogleOauthClientAdmissionHttpReply {
  status: number;
  body: Record<string, unknown>;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function handleGoogleOauthClientAdmissionRoute(
  method: string,
  path: string,
  _query: URLSearchParams,
  body: unknown,
): Promise<GoogleOauthClientAdmissionHttpReply | null> {
  if (method === "GET" && path === "/owner/google-workspace/oauth-client") {
    const view = getGoogleOauthClientConfigurationView();
    return {
      status: 200,
      body: {
        ok: true,
        ...view,
        // Explicit non-secret markers
        authorization_transaction_created: false,
        login_started: false,
      },
    };
  }

  if (method === "POST" && path === "/owner/google-workspace/oauth-client") {
    const denied = coreNodeUnavailableForCapability("credentials/macos-keychain");
    if (denied) return { status: 503, body: denied };
    const b = (body ?? {}) as Record<string, unknown>;
    const approvalRaw = (b.approval ?? {}) as Record<string, unknown>;
    const environment = str(b.google_app_environment) as GoogleOauthAppEnvironment;
    const approval: GoogleOauthClientAdmissionApproval = {
      action: str(approvalRaw.action) as typeof REGISTER_GOOGLE_WORKSPACE_OAUTH_CLIENT_ACTION,
      connection_id: str(approvalRaw.connection_id) || GOOGLE_CONNECTION_ID,
      environment: (str(approvalRaw.environment) || environment) as GoogleOauthAppEnvironment,
      google_cloud_project_id: str(approvalRaw.google_cloud_project_id) || str(b.google_cloud_project_id),
      google_oauth_client_id: str(approvalRaw.google_oauth_client_id) || str(b.google_oauth_client_id),
      client_secret_ref:
        (str(approvalRaw.client_secret_ref) as typeof GOOGLE_OAUTH_CLIENT_SECRET_REF) || GOOGLE_OAUTH_CLIENT_SECRET_REF,
      redirect_uri: str(approvalRaw.redirect_uri) || str(b.google_redirect_uri),
      application_type: GOOGLE_OAUTH_APPLICATION_TYPE,
    };

    const result = await admitGoogleOauthClient({
      owner_session_id: str(b.owner_session_id),
      approval,
      google_app_environment: environment,
      google_cloud_project_id: str(b.google_cloud_project_id),
      google_oauth_client_id: str(b.google_oauth_client_id),
      google_oauth_client_secret: typeof b.google_oauth_client_secret === "string" ? b.google_oauth_client_secret : "",
      google_redirect_uri: str(b.google_redirect_uri),
    });

    if (!result.ok) {
      const status =
        result.reason_code === "OWNER_SESSION_REQUIRED" || result.reason_code.includes("SESSION")
          ? 401
          : result.reason_code === "GENERIC_APPROVAL_REJECTED"
            ? 403
            : 400;
      return {
        status,
        body: {
          ok: false,
          reason_code: result.reason_code,
          detail: result.detail,
          client_configuration_state: result.client_configuration_state,
          authorization_transaction_created: false,
          login_started: false,
        },
      };
    }

    // Strip any accidental secret fields — response is non-secret by construction.
    return {
      status: 200,
      body: {
        ok: true,
        client_configuration_state: result.client_configuration_state,
        connection_id: result.connection_id,
        environment: result.environment,
        google_cloud_project_id: result.google_cloud_project_id,
        oauth_client_id: result.oauth_client_id,
        oauth_client_id_ref: result.oauth_client_id_ref,
        oauth_client_secret_ref: result.oauth_client_secret_ref,
        redirect_uri: result.redirect_uri,
        application_type: result.application_type,
        authorization_transaction_created: false,
        login_started: false,
      },
    };
  }

  return null;
}
