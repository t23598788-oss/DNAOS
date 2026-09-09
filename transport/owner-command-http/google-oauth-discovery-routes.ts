/**
 * Owner HTTP routes for FIND_GOOGLE_WORKSPACE_OAUTH_CLIENT + admit-discovered.
 * Never return client_secret. Biometric/session required before admission.
 */

import {
  discoverGoogleOauthCredentialFiles,
} from "../../connections/google-workspace/oauth/credential-json-discovery";
import {
  admitDiscoveredGoogleOauthClient,
  publicDiscoveryView,
} from "../../connections/google-workspace/oauth/credential-json-autodiscovery-admission";
import { getGoogleOauthClientConfigurationView } from "../../connections/google-workspace/oauth/client-admission";
import { GOOGLE_OAUTH_CALLBACK_URI_TESTING } from "../../connections/google-workspace/contract";

export interface GoogleOauthDiscoveryHttpReply {
  status: number;
  body: Record<string, unknown>;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * POST /owner/google-workspace/oauth-client/discover
 * POST /owner/google-workspace/oauth-client/admit-discovered
 * (also keeps existing /owner/google-workspace/oauth-client from sibling module)
 */
export async function handleGoogleOauthDiscoveryRoute(
  method: string,
  path: string,
  _query: URLSearchParams,
  body: unknown,
): Promise<GoogleOauthDiscoveryHttpReply | null> {
  if (method === "POST" && path === "/owner/google-workspace/oauth-client/discover") {
    const b = (body ?? {}) as Record<string, unknown>;
    const result = discoverGoogleOauthCredentialFiles({
      expected_project_id: str(b.expected_project_id) || undefined,
      expected_redirect_uri: str(b.expected_redirect_uri) || GOOGLE_OAUTH_CALLBACK_URI_TESTING,
    });
    return {
      status: 200,
      body: {
        ok: true,
        ...publicDiscoveryView(result),
        login_started: false,
        authorization_transaction_created: false,
      },
    };
  }

  if (method === "POST" && path === "/owner/google-workspace/oauth-client/admit-discovered") {
    const b = (body ?? {}) as Record<string, unknown>;
    const result = await admitDiscoveredGoogleOauthClient({
      selected_absolute_path: str(b.selected_absolute_path) || undefined,
      approved_content_sha256: str(b.approved_content_sha256) || undefined,
      expected_project_id: str(b.expected_project_id) || undefined,
      owner_session_id: str(b.owner_session_id) || undefined,
      require_biometric: b.require_biometric === false ? false : !str(b.owner_session_id),
      expected_owner: str(b.expected_owner) || undefined,
    });

    if (!result.ok) {
      const status =
        result.reason_code === "AMBIGUOUS"
          ? 409
          : result.reason_code === "NO_MATCH"
            ? 404
            : result.reason_code.includes("SESSION") || result.reason_code === "NO_CONSOLE_SESSION"
              ? 401
              : result.reason_code.includes("BIOMETRIC") || result.reason_code === "DENIED" || result.reason_code === "CANCELLED"
                ? 403
                : 400;
      return {
        status,
        body: {
          ok: false,
          reason_code: result.reason_code,
          detail: result.detail,
          challenge_id: result.challenge_id ?? null,
          client_configuration_state: result.client_configuration_state,
          discovery: result.discovery ? publicDiscoveryView(result.discovery) : undefined,
          login_started: false,
          authorization_transaction_created: false,
        },
      };
    }

    const view = getGoogleOauthClientConfigurationView();
    return {
      status: 200,
      body: {
        ok: true,
        client_configuration_state: result.client_configuration_state,
        challenge_id: result.challenge_id,
        oauth_client_secret_ref: result.oauth_client_secret_ref,
        selected: {
          filename: result.selected.filename,
          project_id: result.selected.project_id,
          client_id: result.selected.client_id,
          redirect_uri: result.selected.redirect_uri,
          content_sha256: result.selected.content_sha256,
          modified_at: result.selected.modified_at,
        },
        source_file_cleanup_required: result.source_file_cleanup_required,
        configuration: view,
        login_started: false,
        authorization_transaction_created: false,
      },
    };
  }

  return null;
}
