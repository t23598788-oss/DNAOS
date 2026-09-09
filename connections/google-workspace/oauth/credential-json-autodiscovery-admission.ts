/**
 * Admit a discovered Google OAuth Web credential JSON after exact Owner approval.
 * Biometric required before secret read/admission. Never logs/returns client_secret.
 */

import { createChallenge, runVerification, ownerPresence } from "../../../control/owner-authentication/human-verification";
import { authenticateOwner, validateOwnerSession } from "../../../control/owner-authentication/contract";
import {
  GOOGLE_CONNECTION_ID,
  GOOGLE_OAUTH_CALLBACK_URI_TESTING,
  GOOGLE_OAUTH_CLIENT_SECRET_REF,
} from "../contract";
import {
  admitGoogleOauthClient,
  getGoogleOauthClientConfigurationView,
  type GoogleOauthClientAdmissionDeps,
} from "./client-admission";
import {
  GOOGLE_OAUTH_APPLICATION_TYPE,
  REGISTER_GOOGLE_WORKSPACE_OAUTH_CLIENT_ACTION,
  type GoogleOauthClientAdmissionApproval,
} from "./client-config-types";
import {
  discoverGoogleOauthCredentialFiles,
  extractWebClientSecret,
  revalidateDiscoveredCredentialFile,
  type GoogleOauthCredentialFileCandidate,
  type GoogleOauthCredentialDiscoveryResult,
} from "./credential-json-discovery";
import { readGoogleOauthConfig } from "./google-oauth";

export const CONCEPTUAL_OWNER_ACTION = "FIND_GOOGLE_WORKSPACE_OAUTH_CLIENT" as const;

export function buildDiscoveryApprovalPurpose(candidate: GoogleOauthCredentialFileCandidate): string {
  // Non-secret only — never include client_secret
  return [
    `ACTION=${REGISTER_GOOGLE_WORKSPACE_OAUTH_CLIENT_ACTION}`,
    `CONNECTION_ID=${GOOGLE_CONNECTION_ID}`,
    `ENVIRONMENT=TESTING`,
    `GOOGLE_CLOUD_PROJECT_ID=${candidate.project_id}`,
    `GOOGLE_OAUTH_CLIENT_ID=${candidate.client_id}`,
    `CLIENT_SECRET_REF=${GOOGLE_OAUTH_CLIENT_SECRET_REF}`,
    `REDIRECT_URI=${candidate.redirect_uri}`,
    `SOURCE_FILE_HASH=${candidate.content_sha256}`,
    `SOURCE_FILE_NAME=${candidate.filename}`,
    `APPLICATION_TYPE=WEB_APPLICATION`,
  ].join(" ");
}

export function buildApprovalFromCandidate(candidate: GoogleOauthCredentialFileCandidate): GoogleOauthClientAdmissionApproval {
  return {
    action: REGISTER_GOOGLE_WORKSPACE_OAUTH_CLIENT_ACTION,
    connection_id: GOOGLE_CONNECTION_ID,
    environment: "TESTING",
    google_cloud_project_id: candidate.project_id,
    google_oauth_client_id: candidate.client_id,
    client_secret_ref: GOOGLE_OAUTH_CLIENT_SECRET_REF,
    redirect_uri: candidate.redirect_uri,
    application_type: GOOGLE_OAUTH_APPLICATION_TYPE,
  };
}

export interface AdmitDiscoveredGoogleOauthClientInput {
  /** Absolute path of selected candidate (required when AMBIGUOUS). */
  selected_absolute_path?: string;
  /** Expected content hash approved by Owner. */
  approved_content_sha256?: string;
  /** Optional project filter for discovery. */
  expected_project_id?: string;
  /** When set, skip biometric and use this ACTIVE session (tests / post-verify). */
  owner_session_id?: string;
  /** When true, run createChallenge + runVerification + authenticateOwner. */
  require_biometric?: boolean;
  expected_owner?: string;
  search_roots?: readonly string[];
}

export type AdmitDiscoveredGoogleOauthClientResult =
  | {
      ok: true;
      discovery: GoogleOauthCredentialDiscoveryResult;
      selected: GoogleOauthCredentialFileCandidate;
      challenge_id: string | null;
      client_configuration_state: "CONFIGURED";
      oauth_client_secret_ref: typeof GOOGLE_OAUTH_CLIENT_SECRET_REF;
      source_file_cleanup_required: true;
      authorization_transaction_created: false;
      login_started: false;
    }
  | {
      ok: false;
      reason_code: string;
      detail: string;
      discovery?: GoogleOauthCredentialDiscoveryResult;
      challenge_id?: string | null;
      client_configuration_state: "CONFIGURATION_REQUIRED";
    };

export interface AdmitDiscoveredDeps {
  discover: typeof discoverGoogleOauthCredentialFiles;
  revalidate: typeof revalidateDiscoveredCredentialFile;
  extractSecret: typeof extractWebClientSecret;
  admit: typeof admitGoogleOauthClient;
  createChallenge: typeof createChallenge;
  runVerification: typeof runVerification;
  authenticateOwner: typeof authenticateOwner;
  ownerPresence: typeof ownerPresence;
  admissionDeps?: GoogleOauthClientAdmissionDeps;
}

const defaultDeps: AdmitDiscoveredDeps = {
  discover: discoverGoogleOauthCredentialFiles,
  revalidate: revalidateDiscoveredCredentialFile,
  extractSecret: extractWebClientSecret,
  admit: admitGoogleOauthClient,
  createChallenge,
  runVerification,
  authenticateOwner,
  ownerPresence,
};

function fail(
  reason_code: string,
  detail: string,
  extra: Partial<AdmitDiscoveredGoogleOauthClientResult> = {},
): AdmitDiscoveredGoogleOauthClientResult {
  return {
    ok: false,
    reason_code,
    detail,
    client_configuration_state: "CONFIGURATION_REQUIRED",
    ...extra,
  };
}

/**
 * Discover → (optional biometric) → revalidate → admit.
 * Biometric is required by default before reading/admitting secrets.
 */
export async function admitDiscoveredGoogleOauthClient(
  input: AdmitDiscoveredGoogleOauthClientInput = {},
  deps: AdmitDiscoveredDeps = defaultDeps,
): Promise<AdmitDiscoveredGoogleOauthClientResult> {
  const requireBiometric = input.require_biometric !== false && !input.owner_session_id;

  const discovery = deps.discover({
    expected_project_id: input.expected_project_id,
    expected_redirect_uri: GOOGLE_OAUTH_CALLBACK_URI_TESTING,
    search_roots: input.search_roots,
  });

  if (discovery.auto_discovery_state === "NO_MATCH") {
    return fail("NO_MATCH", "no eligible Google OAuth Web credential JSON found", { discovery });
  }

  let selected: GoogleOauthCredentialFileCandidate | null = discovery.selected;
  if (discovery.auto_discovery_state === "AMBIGUOUS") {
    if (!input.selected_absolute_path) {
      return fail("AMBIGUOUS", "multiple candidates — Owner must select one", { discovery });
    }
    selected =
      discovery.candidates.find((c) => c.absolute_path === input.selected_absolute_path) ?? null;
    if (!selected) {
      return fail("CANDIDATE_NOT_FOUND", "selected path is not among discovered candidates", { discovery });
    }
  }
  if (!selected) {
    return fail("NO_MATCH", "no selected candidate", { discovery });
  }

  if (input.approved_content_sha256 && input.approved_content_sha256 !== selected.content_sha256) {
    return fail("APPROVAL_HASH_MISMATCH", "approved hash does not match discovered candidate", { discovery });
  }

  let challengeId: string | null = null;
  let sessionId = input.owner_session_id?.trim() ?? "";

  if (requireBiometric) {
    const expectedOwner = input.expected_owner ?? deps.ownerPresence();
    if (!expectedOwner) {
      return fail("NO_CONSOLE_SESSION", "Owner console session required for biometric approval", { discovery });
    }
    const purpose = buildDiscoveryApprovalPurpose(selected);
    const created = deps.createChallenge({
      expected_owner: expectedOwner,
      purpose,
      requested_authority_class: "CLASS_3_SECURITY_OR_EXTERNAL_CONFIG",
      ttl_seconds: 180,
    });
    if (!created.ok) {
      return fail(created.reason_code, created.detail, { discovery });
    }
    challengeId = created.challenge.challenge_id;
    const verified = deps.runVerification(challengeId);
    if (verified.outcome !== "VERIFIED") {
      return fail(
        verified.error_code ?? verified.outcome,
        verified.detail ?? "Owner biometric verification failed",
        { discovery, challenge_id: challengeId },
      );
    }
    const minted = deps.authenticateOwner({
      method: "human-verification",
      expected_owner: expectedOwner,
      ttl_seconds: 3600,
      verified_challenge_id: challengeId,
    });
    if (!minted.ok || !("session" in minted) || !minted.session) {
      return fail(
        "SESSION_MINT_FAILED",
        "detail" in minted ? String(minted.detail ?? minted.reason_code) : "failed to mint Owner session",
        { discovery, challenge_id: challengeId },
      );
    }
    sessionId = minted.session.session_id;
  }

  if (!sessionId) {
    return fail("OWNER_SESSION_REQUIRED", "active Owner session required before secret admission", {
      discovery,
      challenge_id: challengeId,
    });
  }

  // Biometric/session gate passed — now revalidate and read secret.
  const revalidated = deps.revalidate(selected);
  if (!revalidated.ok) {
    return fail(revalidated.reason_code, revalidated.detail, { discovery, challenge_id: challengeId });
  }

  let secret: string | null = deps.extractSecret(revalidated.bytes);
  // Drop file bytes reference ASAP
  (revalidated as { bytes?: Buffer }).bytes = undefined as never;
  if (!secret) {
    return fail("CLIENT_SECRET_REQUIRED", "client_secret missing after revalidation", {
      discovery,
      challenge_id: challengeId,
    });
  }

  const approval = buildApprovalFromCandidate(selected);
  const admitted = await deps.admit(
    {
      owner_session_id: sessionId,
      approval,
      google_app_environment: "TESTING",
      google_cloud_project_id: selected.project_id,
      google_oauth_client_id: selected.client_id,
      google_oauth_client_secret: secret,
      google_redirect_uri: selected.redirect_uri,
    },
    deps.admissionDeps,
  );

  // Zero secret reference
  secret = null;

  if (!admitted.ok) {
    return fail(admitted.reason_code, admitted.detail, { discovery, challenge_id: challengeId });
  }

  return {
    ok: true,
    discovery,
    selected,
    challenge_id: challengeId,
    client_configuration_state: "CONFIGURED",
    oauth_client_secret_ref: GOOGLE_OAUTH_CLIENT_SECRET_REF,
    source_file_cleanup_required: true,
    authorization_transaction_created: false,
    login_started: false,
  };
}

export function publicDiscoveryView(result: GoogleOauthCredentialDiscoveryResult): Record<string, unknown> {
  return {
    action: result.action,
    auto_discovery_state: result.auto_discovery_state,
    search_locations: result.search_locations,
    rejected_count: result.rejected_count,
    candidates: result.candidates.map((c) => ({
      filename: c.filename,
      project_id: c.project_id,
      client_id: c.client_id,
      redirect_uri: c.redirect_uri,
      modified_at: c.modified_at,
      content_sha256: c.content_sha256,
      // never absolute_path in public MCP/chat if sensitive home path — still needed for Owner selection on device
      absolute_path: c.absolute_path,
    })),
    selected: result.selected
      ? {
          filename: result.selected.filename,
          project_id: result.selected.project_id,
          client_id: result.selected.client_id,
          redirect_uri: result.selected.redirect_uri,
          modified_at: result.selected.modified_at,
          content_sha256: result.selected.content_sha256,
          absolute_path: result.selected.absolute_path,
        }
      : null,
  };
}

export { getGoogleOauthClientConfigurationView, readGoogleOauthConfig, validateOwnerSession };
