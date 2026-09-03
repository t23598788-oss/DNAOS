/**
 * หน้าที่: the public boundary of `connections/email-alert-source/`.
 *
 * Input: re-exports only.
 * Output: `fetchAlertEmails`, `EmailSourceError`, and every type.
 * Dependency ที่อนุญาต: ./adapter.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never re-export ./host-runtime.ts — `httpPostJson` stays
 * private so no caller can point this adapter at an arbitrary host.
 */

export { fetchAlertEmails } from "./adapter";
export { EmailSourceError } from "./types";
export type {
  EmailSourceConfig,
  EmailSourceErrorCode,
  FetchAlertEmailsResult,
  UpstreamAlertMessage,
  UpstreamResponse,
} from "./types";
