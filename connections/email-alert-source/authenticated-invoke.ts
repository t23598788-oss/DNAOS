/**
 * หน้าที่: call the deployed `provider-alert-email-read` Edge Function
 * through the EXISTING adapter (`./adapter.ts#fetchAlertEmails`), resolving
 * the shared secret from DNA OS's own Keychain boundary at call time.
 *
 * WHY THIS FILE EXISTS RATHER THAN A CONFIG FIELD: `EmailSourceConfig`
 * carries `secret_value`, so a caller has to hold the plaintext to build
 * one. Exposing a "give me the config" helper would return the secret to
 * whoever asked — including an Agent. Here the secret is resolved, used
 * for exactly one HTTP call, and never returned, logged, or stored. The
 * only things that leave this module are the adapter's own results.
 *
 * NOT A SECOND ADAPTER: this performs no HTTP itself and does no Gmail
 * work. It resolves one credential and delegates to `fetchAlertEmails`.
 *
 * Input: a deterministic Gmail query.
 * Output: `invokeProviderAlertEmailRead` -> the adapter's `FetchAlertEmailsResult`.
 * Dependency ที่อนุญาต: ./contract.ts,
 * ../../credentials/macos-keychain/index.ts,
 * ../../credentials/supabase-edge-secret/installer.ts (for the service name only).
 * สิ่งที่ห้ามแตะ: never return, log, or persist the resolved secret, and
 * never add a parameter that lets a caller supply one instead — the whole
 * point is that the plaintext has exactly one path into this process.
 */

import { fetchAlertEmails, type FetchAlertEmailsResult } from "./contract";
import { MacOsKeychainProvider } from "../../credentials/macos-keychain/index";
import { CALLER_KEYCHAIN_SERVICE } from "../../credentials/supabase-edge-secret/installer";
import { SUPABASE_PRODUCTION_PROJECT_REF } from "../../execution/run/process-registry";

const SECRET_NAME = "PROVIDER_ALERT_EMAIL_READ_SECRET";
const HEADER_NAME = "x-provider-alert-email-secret";

/** The deployed function's real URL, derived from the verified project ref. */
export function providerAlertEmailReadUrl(): string {
  return `https://${SUPABASE_PRODUCTION_PROJECT_REF}.supabase.co/functions/v1/provider-alert-email-read`;
}

export interface AuthenticatedInvokeResult {
  /** True only when the credential was resolved AND the call was authenticated. */
  readonly caller_authenticated: boolean;
  readonly result: FetchAlertEmailsResult | null;
  readonly detail: string;
}

/**
 * Resolves the caller half of the secret from the Keychain and invokes the
 * deployed function through the adapter. A resolution failure is reported
 * honestly and no call is attempted — never a fallback to an unauthenticated
 * request.
 */
export async function invokeProviderAlertEmailRead(query: string, timeoutMs = 30_000): Promise<AuthenticatedInvokeResult> {
  const provider = new MacOsKeychainProvider();
  const resolution = (await provider.resolve(
    { service: CALLER_KEYCHAIN_SERVICE, account: SECRET_NAME, kind: "api_key" },
    { timeoutMs: 15_000 },
  )) as unknown as { ok?: boolean; status?: string; secret?: string; value?: string; detail?: string };

  // Different provider versions name the field differently; take whichever
  // is present and never inspect it further.
  const secret = resolution.secret ?? resolution.value;
  if (!secret) {
    return {
      caller_authenticated: false,
      result: null,
      detail: `credential not resolvable from the Keychain (${resolution.status ?? resolution.detail ?? "no value returned"}) — refusing to call unauthenticated`,
    };
  }

  const result = await fetchAlertEmails(
    { endpoint_url: providerAlertEmailReadUrl(), secret_header_name: HEADER_NAME, secret_value: secret, timeout_ms: timeoutMs },
    query,
  );

  // UNAUTHORIZED is the one outcome that specifically means the two halves
  // of the secret disagree; every other failure is a transport/content issue.
  const authenticated = result.error_code !== "UNAUTHORIZED";
  return {
    caller_authenticated: authenticated,
    result,
    detail: authenticated ? `authenticated; adapter returned ${result.ok ? "ok" : result.error_code}` : "upstream refused the shared secret",
  };
}
