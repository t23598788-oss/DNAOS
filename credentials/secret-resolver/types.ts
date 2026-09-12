export type SecretFailureCode = "NOT_FOUND" | "NOT_CONFIGURED" | "DENIED" | "FAILED";

export type SecretResolution =
  | { readonly ok: true; readonly secret: string; readonly credential_source: string }
  | {
      readonly ok: false;
      readonly code: SecretFailureCode;
      readonly reason: string;
      readonly credential_source: string;
    };

/** Safe to log, evidence, or status APIs — never includes secret material. */
export type PublicSecretOutcome =
  | { readonly ok: true; readonly credential_source: string }
  | { readonly ok: false; readonly code: SecretFailureCode; readonly reason: string; readonly credential_source: string };

export function publicSecretOutcome(resolution: SecretResolution): PublicSecretOutcome {
  if (resolution.ok) return { ok: true, credential_source: resolution.credential_source };
  return {
    ok: false,
    code: resolution.code,
    reason: resolution.reason,
    credential_source: resolution.credential_source,
  };
}
