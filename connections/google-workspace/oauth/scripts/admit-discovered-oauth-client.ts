/**
 * One-shot Owner biometric admission of discovered Google Workspace OAuth client JSON.
 * Never prints client_secret. Does not begin login.
 *
 * Run: npx tsx connections/google-workspace/oauth/scripts/admit-discovered-oauth-client.ts
 */

import { admitDiscoveredGoogleOauthClient } from "../credential-json-autodiscovery-admission";
import { getGoogleOauthClientConfigurationView } from "../client-admission";
import { findLatestClientConfig } from "../client-config-store";
import { findApiCredential } from "../../../../credentials/registry/api-credential-registry";
import { GOOGLE_OAUTH_CLIENT_SECRET_REF } from "../../contract";

async function main(): Promise<void> {
  const result = await admitDiscoveredGoogleOauthClient({
    expected_project_id: "dna-os-my-first-project",
    require_biometric: true,
    expected_owner: "tam",
  });

  if (!result.ok) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          reason_code: result.reason_code,
          detail: result.detail,
          challenge_id: result.challenge_id ?? null,
          client_configuration_state: result.client_configuration_state,
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
    return;
  }

  const view = getGoogleOauthClientConfigurationView();
  const publicConfig = findLatestClientConfig();
  const secretEntry = findApiCredential(GOOGLE_OAUTH_CLIENT_SECRET_REF);
  const blob = JSON.stringify({ result, view, publicConfig });

  console.log(
    JSON.stringify(
      {
        ok: true,
        challenge_id: result.challenge_id,
        selected_filename: result.selected.filename,
        selected_hash: result.selected.content_sha256,
        project_id: result.selected.project_id,
        client_id: result.selected.client_id,
        redirect_uri: result.selected.redirect_uri,
        client_configuration_state: result.client_configuration_state,
        source_file_cleanup_required: result.source_file_cleanup_required,
        login_started: result.login_started,
        authorization_transaction_created: result.authorization_transaction_created,
        view_configured: view.configured,
        view_state: view.client_configuration_state,
        secret_ref_active: secretEntry?.status === "ACTIVE",
        public_config_has_secret_field: blob.includes("GOCSPX") || /"client_secret"\s*:/.test(blob),
        public_config_project: publicConfig?.google_cloud_project_id ?? null,
        public_config_client_id: publicConfig?.oauth_client_id ?? null,
        public_config_redirect: publicConfig?.redirect_uri ?? null,
      },
      null,
      2,
    ),
  );
}

void main();
