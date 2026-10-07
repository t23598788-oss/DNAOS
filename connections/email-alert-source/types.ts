/**
 * หน้าที่: type contracts for `connections/email-alert-source/` — the
 * EMAIL INPUT ADAPTER between the EXISTING Gmail reader and
 * `control/alert-correlation/`.
 *
 *   EXISTING GMAIL READER (dna-os-deadboard, Deno/Supabase Edge)
 *        -> EMAIL INPUT ADAPTER (this folder, Node)
 *        -> control/alert-correlation/
 *
 * THE HARD RULE (Owner, 2026-08-26): this folder MUST NOT read Gmail. It
 * holds no OAuth flow, no IMAP/SMTP client, no Google credential, and no
 * `googleapis` dependency. It performs ONE authenticated HTTP call to an
 * endpoint that already exists and already owns the credential, then
 * translates the field names. Anything more would be the duplicate
 * reader the Owner explicitly forbade.
 *
 * Input: none (pure type definitions).
 * Output: `EmailSourceConfig`, `UpstreamAlertMessage`, `UpstreamResponse`,
 * `FetchAlertEmailsResult`, `EmailSourceError`.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: never add a field carrying a Google client id, client
 * secret, or refresh token. Those live in the Edge Function's own
 * environment and must never be copied into DNA OS — see ./README.md's
 * CREDENTIAL BOUNDARY section.
 */

/** Where the existing reader lives, and the shared secret it already expects. */
export interface EmailSourceConfig {
  /** Full URL of the existing Edge Function that performs the Gmail read. */
  readonly endpoint_url: string;
  /** Header NAME the function checks (it uses a per-function secret header, not a bearer token). */
  readonly secret_header_name: string;
  /**
   * The shared secret value. Supplied by the CALLER from its own secure
   * source — this folder never reads a credential store itself, so the
   * credential boundary stays where it already is.
   */
  readonly secret_value: string;
  readonly timeout_ms?: number;
}

/**
 * One message as the upstream reader returns it. Field names mirror what
 * `_shared/gmail-client.ts` already produces (`fetchGmailMessage` +
 * `getSubjectHeader` + `extractBodyText`), so the upstream does not have
 * to invent a new shape for DNA OS.
 */
export interface UpstreamAlertMessage {
  readonly id: string;
  readonly threadId: string;
  /** RFC3339, or Gmail's `internalDate` epoch-millis as a string. Both are accepted. */
  readonly internalDate?: string;
  readonly date?: string;
  readonly from?: string;
  readonly subject?: string;
  readonly bodyText?: string;
}

export interface UpstreamResponse {
  readonly ok?: boolean;
  readonly messages?: readonly UpstreamAlertMessage[];
  readonly error?: string;
}

export type EmailSourceErrorCode =
  | "NOT_CONFIGURED"
  | "UNAUTHORIZED"
  | "UPSTREAM_ERROR"
  | "UNREACHABLE"
  | "MALFORMED_RESPONSE";

export class EmailSourceError extends Error {
  readonly code: EmailSourceErrorCode;
  constructor(code: EmailSourceErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "EmailSourceError";
  }
}

/**
 * Always returned, never thrown, so a caller can record an honest
 * "the reader was unavailable" observation instead of crashing a run.
 * `emails` is empty whenever `ok` is false — there is no partial-success
 * shape that could be mistaken for "no alerts today".
 */
export interface FetchAlertEmailsResult {
  readonly ok: boolean;
  /** Already in `control/alert-correlation/`'s own input shape. */
  readonly emails: readonly {
    readonly message_id: string;
    readonly thread_id: string;
    readonly sender: string;
    readonly received_at: string;
    readonly subject: string;
    readonly body: string;
  }[];
  readonly error_code: EmailSourceErrorCode | null;
  readonly detail: string;
  /** Provenance: exactly which upstream answered, for the evidence trail. */
  readonly source_endpoint: string;
  readonly fetched_at: string;
}
