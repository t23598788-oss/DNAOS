/**
 * Owner-verification bridge client — business repo side.
 *
 * The verification itself belongs to -DNA-OS-INFRASTRUCTURE-'s
 * `control/owner-authentication/*`: a challenge, macOS LocalAuthentication via
 * `native/owner-verify` (Touch ID / device passcode), a single-use challenge, and
 * — when the verification happens on a different node — an HMAC-signed artifact
 * validated by `control/owner-authentication/remote-verification-transport.ts`.
 *
 * This file adds NO auth, NO session type, NO biometric call and stores nothing.
 * It only carries the owner's already-signed artifact to the infrastructure's own
 * transport route and returns the verdict verbatim:
 *
 *   POST {origin}/owner/session/from-verification-artifact
 *   Authorization: Bearer ${OWNER_COMMAND_HTTP_SHARED_SECRET}   (infra's own name)
 *   -> { ok: true, owner_session_id, owner_identity, expires_at, ... }
 *   -> { ok: false, reason_code, detail }                        (infra's own wording)
 *
 * Fail-closed everywhere: no shared secret configured, unreachable transport,
 * non-JSON reply, missing identity/session — all become typed failures and the
 * caller must not proceed. The shared secret and the artifact are never logged.
 */

/** The infrastructure transport's own route (identity is the route, not a copy). */
export const OWNER_VERIFICATION_PATH = "/owner/session/from-verification-artifact";

/** The infrastructure transport's real default (CONTROL_PLANE_PRODUCT_CONTRACT.md:
 *  it binds 127.0.0.1:8791; `INFRA_OWNER_VERIFICATION_URL` overrides it, e.g. when
 *  reaching the transport over the infrastructure's private network). */
export const DEFAULT_INFRA_ORIGIN = "http://127.0.0.1:8791";
export const INFRA_ORIGIN_ENV = "INFRA_OWNER_VERIFICATION_URL";

/** Reused verbatim from the infrastructure — never a second secret name. */
export const OWNER_COMMAND_SECRET_ENV = "OWNER_COMMAND_HTTP_SHARED_SECRET";

const TIMEOUT_MS = 8000;

export type OwnerVerificationVerdict =
  | {
      ok: true;
      /** The identity the INFRASTRUCTURE verified — never the caller's claim. */
      owner_identity: string;
      owner_session_id: string;
      expires_at: string | null;
      authenticated_via: string | null;
      evidence_reference: string | null;
      verified_by: string;
    }
  | { ok: false; code: string; detail: string; http_status: number };

export interface OwnerVerificationClientOptions {
  /** Override the transport base URL (tests, or an explicitly configured origin). */
  origin?: string;
  /** Override the shared secret (tests). Defaults to the env var above. */
  secret?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function transportUrl(origin: string): string {
  return `${origin.replace(/\/+$/, "")}${OWNER_VERIFICATION_PATH}`;
}

function readEnv(name: string): string | undefined {
  if (typeof process === "undefined" || process.env === undefined) return undefined;
  return process.env[name];
}

/**
 * Ask the infrastructure to validate an owner-verification artifact and mint the
 * owner session. Returns the infrastructure's own verdict — this file never
 * decides whether an owner was verified.
 */
export async function verifyOwnerArtifact(
  artifact: unknown,
  options: OwnerVerificationClientOptions = {},
): Promise<OwnerVerificationVerdict> {
  const secret = (options.secret ?? readEnv(OWNER_COMMAND_SECRET_ENV) ?? "").trim();
  if (secret.length === 0) {
    return {
      ok: false,
      code: "OWNER_VERIFICATION_NOT_CONFIGURED",
      detail: `${OWNER_COMMAND_SECRET_ENV} is not set for this process — the infrastructure transport cannot be authenticated (fail-closed)`,
      http_status: 0,
    };
  }
  const origin = (options.origin ?? readEnv(INFRA_ORIGIN_ENV) ?? DEFAULT_INFRA_ORIGIN).trim();
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(transportUrl(origin), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ artifact }),
      signal: controller.signal,
    });
  } catch (error) {
    return {
      ok: false,
      code: "OWNER_VERIFICATION_UNREACHABLE",
      detail: `infrastructure owner-verification transport is not reachable (${error instanceof Error ? error.message : String(error)}) — no approval may proceed without it`,
      http_status: 0,
    };
  } finally {
    clearTimeout(timer);
  }

  let body: Record<string, unknown> | null = null;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }
  if (!body) {
    return {
      ok: false,
      code: "OWNER_VERIFICATION_BAD_RESPONSE",
      detail: `infrastructure transport replied with non-JSON (HTTP ${response.status})`,
      http_status: response.status,
    };
  }
  if (body.ok === true) {
    const ownerIdentity = typeof body.owner_identity === "string" ? body.owner_identity : "";
    const ownerSessionId = typeof body.owner_session_id === "string" ? body.owner_session_id : "";
    if (!ownerIdentity || !ownerSessionId) {
      return {
        ok: false,
        code: "OWNER_VERIFICATION_BAD_RESPONSE",
        detail: "infrastructure transport reported success without an owner identity/session",
        http_status: response.status,
      };
    }
    return {
      ok: true,
      owner_identity: ownerIdentity,
      owner_session_id: ownerSessionId,
      expires_at: typeof body.expires_at === "string" ? body.expires_at : null,
      authenticated_via: typeof body.authenticated_via === "string" ? body.authenticated_via : null,
      evidence_reference: typeof body.evidence_reference === "string" ? body.evidence_reference : null,
      verified_by: `infrastructure:${OWNER_VERIFICATION_PATH}`,
    };
  }
  return {
    ok: false,
    code:
      typeof body.reason_code === "string"
        ? body.reason_code
        : typeof body.error === "string"
          ? body.error
          : "OWNER_VERIFICATION_REJECTED",
    detail: typeof body.detail === "string" ? body.detail : "infrastructure owner-authentication did not verify this artifact",
    http_status: response.status,
  };
}
