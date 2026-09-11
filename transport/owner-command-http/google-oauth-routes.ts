/**
 * Thin Core HTTP routes for Google Workspace OAuth.
 * Parse code/state; reject provider errors safely; call lifecycle only.
 * Never exchange tokens, store secrets, or return code_verifier / client_secret / tokens.
 */

import { coreNodeUnavailableForCapability } from "./mac-local-agent-gate";
import { findRecord as findGoogleAuthorizationRecord } from "../../connections/google-workspace/oauth/store";
import {
  GOOGLE_CONNECTION_ID,
  GOOGLE_OAUTH_BEGIN_PATH,
  GOOGLE_OAUTH_CALLBACK_PATH,
} from "../../connections/google-workspace/contract";
import {
  beginAuthorization,
  completeAuthorization,
  getAuthorizationStatus,
  type GoogleLifecycleDeps,
} from "../../connections/google-workspace/oauth/lifecycle";

export interface GoogleOauthHttpReply {
  status: number;
  body: Record<string, unknown>;
  contentType?: "application/json" | "text/html; charset=utf-8";
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function boundedFailure(reason_code: string, detail: string): Record<string, unknown> {
  return {
    ok: false,
    reason_code,
    detail: detail.slice(0, 240),
    connection_id: GOOGLE_CONNECTION_ID,
  };
}

/**
 * GET /oauth/google/workspace/callback
 * POST /oauth/google/workspace/begin
 *
 * Optional `deps` injects lifecycle collaborators (store/config/credential).
 * Production server omits deps → default production lifecycle.
 * Hermetic tests MUST pass deps so begin/complete never touch live authorizations.jsonl.
 */
export async function handleGoogleOauthRoute(
  method: string,
  path: string,
  query: URLSearchParams,
  body: unknown,
  deps?: GoogleLifecycleDeps,
): Promise<GoogleOauthHttpReply | null> {
  if (method === "POST" && path === GOOGLE_OAUTH_BEGIN_PATH) {
    if (!deps) {
      const denied = coreNodeUnavailableForCapability("credentials/macos-keychain");
      if (denied) return { status: 503, body: denied as unknown as Record<string, unknown> };
    }
    const b = (body ?? {}) as Record<string, unknown>;
    const connectionId = str(b.connection_id) || GOOGLE_CONNECTION_ID;
    if (connectionId !== GOOGLE_CONNECTION_ID) {
      return { status: 400, body: boundedFailure("CONNECTION_ID_MISMATCH", "only connection.google.workspace.v1 is admitted") };
    }
    const redirectUri = str(b.redirect_uri);
    const loginHint = str(b.login_hint);
    const expectedAccountEmail = str(b.expected_account_email);
    const beginInput = {
      redirect_uri: redirectUri,
      ...(loginHint ? { login_hint: loginHint } : {}),
      ...(expectedAccountEmail ? { expected_account_email: expectedAccountEmail } : {}),
    };
    const result = deps ? beginAuthorization(beginInput, deps) : beginAuthorization(beginInput);
    if (!result.ok) {
      const status = result.reason_code === "CONFIGURATION_REQUIRED" ? 503 : 400;
      return {
        status,
        body: {
          ok: false,
          reason_code: result.reason_code,
          detail: result.detail,
          owner_action: result.owner_action,
          connection_id: GOOGLE_CONNECTION_ID,
          client_configuration_state: result.reason_code === "CONFIGURATION_REQUIRED" ? "CONFIGURATION_REQUIRED" : undefined,
        },
      };
    }
    return {
      status: 200,
      body: {
        ok: true,
        connection_id: result.connection_id,
        authorization_url: result.authorize_url,
        state_nonce: result.state_nonce,
        expires_in_seconds: result.expires_in_seconds,
        // Explicit non-secret transaction status only
        transaction_status: "AUTHORIZATION_PENDING",
      },
    };
  }

  if (method === "GET" && path === GOOGLE_OAUTH_CALLBACK_PATH) {
    const oauthError = str(query.get("error"));
    if (oauthError) {
      const description = str(query.get("error_description"));
      return {
        status: 400,
        contentType: "text/html; charset=utf-8",
        body: boundedFailure(
          "OAUTH_PROVIDER_ERROR",
          description ? `${oauthError}: ${description}` : oauthError,
        ),
      };
    }

    const code = str(query.get("code"));
    const state = str(query.get("state"));
    if (!code) {
      return { status: 400, body: boundedFailure("CODE_REQUIRED", "authorization code missing") };
    }
    if (!state) {
      return { status: 400, body: boundedFailure("STATE_REQUIRED", "state missing") };
    }
    if (!deps) {
      const denied = coreNodeUnavailableForCapability("credentials/macos-keychain");
      if (denied) return { status: 503, body: denied as unknown as Record<string, unknown> };
    }

    const result = deps
      ? await completeAuthorization({ connection_id: GOOGLE_CONNECTION_ID, code, state }, deps)
      : await completeAuthorization({ connection_id: GOOGLE_CONNECTION_ID, code, state });

    if (!result.ok) {
      return {
        status: 400,
        body: {
          ok: false,
          reason_code: result.reason_code,
          detail: result.detail.slice(0, 240),
          connection_id: GOOGLE_CONNECTION_ID,
          authorization_state: result.record?.state ?? null,
          replacement_committed: false,
          original_binding_preserved:
            result.reason_code === "ACCOUNT_MISMATCH"
              ? result.record?.state === "CONNECTED"
              : undefined,
          account_email: result.record?.account_email ?? null,
          // Never include tokens / verifier / client_secret
        },
      };
    }

    return {
      status: 200,
      body: {
        ok: true,
        connection_id: GOOGLE_CONNECTION_ID,
        authorization_state: result.record.state,
        google_account_bound: result.record.google_account_id !== null,
        credential_ref: result.record.credential_ref,
        // Never include tokens / verifier / client_secret
      },
    };
  }

  if (method === "GET" && path === "/oauth/google/workspace/status") {
    // Portable JSONL record only. Production must not go through default
    // lifecycle deps (those close Keychain writers). Injected test deps
    // may supply findRecord; they still must not be required to supply a resolver.
    const status = deps
      ? getAuthorizationStatus(GOOGLE_CONNECTION_ID, deps)
      : (() => {
          const record = findGoogleAuthorizationRecord(GOOGLE_CONNECTION_ID);
          if (!record) return { ok: false as const, reason_code: "AUTHORIZATION_NOT_FOUND" as const };
          return { ok: true as const, record };
        })();
    if (!status.ok) {
      return {
        status: 200,
        body: {
          ok: true,
          connection_id: GOOGLE_CONNECTION_ID,
          authorization_state: "NOT_CONNECTED",
          client_configuration_state: "CONFIGURATION_REQUIRED",
        },
      };
    }
    const r = status.record;
    return {
      status: 200,
      body: {
        ok: true,
        connection_id: r.connection_id,
        authorization_state: r.state,
        google_account_id: r.google_account_id,
        account_email: r.account_email,
        credential_ref: r.credential_ref,
        granted_scope: r.granted_scope,
        failure_reason: r.failure_reason,
        // Never expose code_verifier
      },
    };
  }

  return null;
}

/** HTML-safe bounded page for browser callbacks when contentType is HTML. */
export function renderGoogleOauthHtml(body: Record<string, unknown>): string {
  const ok = body.ok === true;
  const reason = typeof body.reason_code === "string" ? body.reason_code : ok ? "OK" : "FAILED";
  const detail = typeof body.detail === "string" ? body.detail : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>Google Workspace OAuth</title></head><body><p>${ok ? "Authorization complete" : "Authorization failed"}</p><p>${reason}</p>${detail ? `<p>${detail.replace(/[<>&]/g, "")}</p>` : ""}</body></html>`;
}
