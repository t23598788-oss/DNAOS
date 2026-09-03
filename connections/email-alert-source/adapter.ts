/**
 * หน้าที่: the EMAIL INPUT ADAPTER. One authenticated HTTP call to the
 * EXISTING Gmail reader, then a pure field translation into
 * `control/alert-correlation/`'s `RawAlertEmail` shape.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO — the whole point of it:
 *   - no OAuth token exchange (the Edge Function already owns that)
 *   - no `oauth2.googleapis.com` call, no `gmail.users.messages` call
 *   - no IMAP, no SMTP, no `googleapis` dependency
 *   - no Google credential of any kind in this repo
 * Enforced by a real source scan in ./tests/adapter.test.ts, not by
 * intention.
 *
 * The upstream reader is
 * `dna-os-deadboard/supabase/functions/_shared/gmail-client.ts` — 99
 * lines, `gmail.readonly` scope, already used in production by
 * bank-email-sync (pg_cron every 5 minutes), subscription-email-sync,
 * supabase-billing-sync and system-health-check. This adapter reuses it
 * across the runtime boundary rather than porting it.
 *
 * Input: `EmailSourceConfig` (+ an optional deterministic query).
 * Output: `fetchAlertEmails` -> `FetchAlertEmailsResult`.
 * Dependency ที่อนุญาต: ./types.ts, ./host-runtime.ts.
 * สิ่งที่ห้ามแตะ: never add a fallback that reads mail directly when the
 * upstream is unavailable. An unreachable reader must surface as
 * `UNREACHABLE`, because a second reader is exactly the duplication this
 * capability exists to prevent.
 */

import { EmailSourceError, type EmailSourceConfig, type FetchAlertEmailsResult, type UpstreamAlertMessage, type UpstreamResponse } from "./types";
import { httpPostJson, nowIso } from "./host-runtime";

/** Gmail's `internalDate` is epoch-millis as a string; `date` is already RFC3339. */
function normaliseReceivedAt(message: UpstreamAlertMessage): string {
  if (message.date && !Number.isNaN(Date.parse(message.date))) {
    return new Date(message.date).toISOString();
  }
  if (message.internalDate) {
    const millis = Number(message.internalDate);
    if (Number.isFinite(millis) && millis > 0) return new Date(millis).toISOString();
  }
  // No provable timestamp. Refuse rather than stamping "now", which would
  // silently make an old alert look like it just arrived and would break
  // alert-correlation's claim-vs-observation time comparison.
  throw new EmailSourceError("MALFORMED_RESPONSE", `message ${message.id} carries no parseable date or internalDate`);
}

function translate(message: UpstreamAlertMessage): FetchAlertEmailsResult["emails"][number] {
  if (!message.id || !message.threadId) {
    throw new EmailSourceError("MALFORMED_RESPONSE", "upstream message is missing id or threadId");
  }
  return {
    message_id: message.id,
    thread_id: message.threadId,
    sender: message.from ?? "",
    received_at: normaliseReceivedAt(message),
    subject: message.subject ?? "",
    body: message.bodyText ?? "",
  };
}

function failure(config: EmailSourceConfig, code: FetchAlertEmailsResult["error_code"], detail: string): FetchAlertEmailsResult {
  return { ok: false, emails: [], error_code: code, detail, source_endpoint: config.endpoint_url, fetched_at: nowIso() };
}

/**
 * Fetches provider alert emails from the existing reader.
 *
 * `query` is a deterministic Gmail query fragment (sender/domain/subject/
 * time), passed straight through to the upstream — the same closed,
 * sender-scoped style `subscription-email-sync` already uses for its own
 * provider table. This adapter never asks for "the inbox".
 */
export async function fetchAlertEmails(config: EmailSourceConfig, query: string): Promise<FetchAlertEmailsResult> {
  if (!config.endpoint_url || !config.secret_value) {
    return failure(config, "NOT_CONFIGURED", "no endpoint_url/secret_value supplied — the existing Edge Function reader is not wired to this machine yet");
  }
  if (!query || !/^(from:|subject:|newer_than:|\{)/i.test(query.trim())) {
    return failure(config, "NOT_CONFIGURED", `refusing an unscoped query ${JSON.stringify(query)} — a query must start with a deterministic filter (from:/subject:/newer_than:), never an open inbox read`);
  }

  const response = await httpPostJson(
    config.endpoint_url,
    { [config.secret_header_name]: config.secret_value },
    { query },
    config.timeout_ms ?? 20_000,
  );

  if (!response.reached) return failure(config, "UNREACHABLE", response.detail);
  if (response.status === 401 || response.status === 403) {
    return failure(config, "UNAUTHORIZED", `upstream refused the shared secret (HTTP ${response.status}) — the secret header name/value does not match what the function expects`);
  }
  if (response.status < 200 || response.status >= 300) {
    return failure(config, "UPSTREAM_ERROR", `upstream answered HTTP ${response.status}: ${response.bodyText.slice(0, 200)}`);
  }

  let parsed: UpstreamResponse;
  try {
    parsed = JSON.parse(response.bodyText) as UpstreamResponse;
  } catch {
    return failure(config, "MALFORMED_RESPONSE", `upstream body is not JSON: ${response.bodyText.slice(0, 200)}`);
  }
  if (parsed.error) return failure(config, "UPSTREAM_ERROR", `upstream reported: ${parsed.error}`);
  if (!Array.isArray(parsed.messages)) {
    return failure(config, "MALFORMED_RESPONSE", 'upstream response has no "messages" array');
  }

  try {
    const emails = parsed.messages.map(translate);
    return { ok: true, emails, error_code: null, detail: `translated ${emails.length} message(s) from the existing reader`, source_endpoint: config.endpoint_url, fetched_at: nowIso() };
  } catch (error) {
    const code = error instanceof EmailSourceError ? error.code : "MALFORMED_RESPONSE";
    return failure(config, code, error instanceof Error ? error.message : String(error));
  }
}
