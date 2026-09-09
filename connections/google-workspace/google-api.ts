/**
 * Google Workspace READ API helpers (Gmail / Calendar / Drive / Sheets).
 * GET-only via FetchImpl — no write verbs.
 */

import type { FetchImpl, HostFetchOutcome } from "./host-runtime";

const TIMEOUT_MS = 15_000;

export type GoogleApiResult =
  | { ok: true; http_status: number; data: unknown; endpoint: string }
  | { ok: false; outcome: "PROVIDER_ERROR" | "TRANSPORT_ERROR"; reason: string; http_status: number | null; endpoint: string };

async function getJson(
  fetchImpl: FetchImpl,
  endpoint: string,
  accessToken: string,
): Promise<GoogleApiResult> {
  const outcome: HostFetchOutcome = await fetchImpl(
    endpoint,
    { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    TIMEOUT_MS,
  );
  if (outcome.kind === "transport_error") {
    return { ok: false, outcome: "TRANSPORT_ERROR", reason: outcome.reason, http_status: null, endpoint };
  }
  const status = outcome.response.status;
  if (status < 200 || status >= 300) {
    return {
      ok: false,
      outcome: "PROVIDER_ERROR",
      reason: `Google API HTTP ${status}`,
      http_status: status,
      endpoint,
    };
  }
  const data = await outcome.response.json().catch(() => null);
  if (data === null) {
    return { ok: false, outcome: "PROVIDER_ERROR", reason: "malformed JSON response", http_status: status, endpoint };
  }
  return { ok: true, http_status: status, data, endpoint };
}

async function getText(
  fetchImpl: FetchImpl,
  endpoint: string,
  accessToken: string,
): Promise<GoogleApiResult> {
  const outcome: HostFetchOutcome = await fetchImpl(
    endpoint,
    { authorization: `Bearer ${accessToken}`, accept: "*/*" },
    TIMEOUT_MS,
  );
  if (outcome.kind === "transport_error") {
    return { ok: false, outcome: "TRANSPORT_ERROR", reason: outcome.reason, http_status: null, endpoint };
  }
  const status = outcome.response.status;
  if (status < 200 || status >= 300) {
    return {
      ok: false,
      outcome: "PROVIDER_ERROR",
      reason: `Google API HTTP ${status}`,
      http_status: status,
      endpoint,
    };
  }
  const text = await outcome.response.text().catch(() => null);
  if (text === null) {
    return { ok: false, outcome: "PROVIDER_ERROR", reason: "empty content response", http_status: status, endpoint };
  }
  return { ok: true, http_status: status, data: { content_text: text, encoding: "utf8" }, endpoint };
}

function q(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s.length > 0 ? `?${s}` : "";
}

export function gmailSearchMessages(fetchImpl: FetchImpl, accessToken: string, query: string, maxResults = 25): Promise<GoogleApiResult> {
  const endpoint = `https://gmail.googleapis.com/gmail/v1/users/me/messages${q({ q: query, maxResults })}`;
  return getJson(fetchImpl, endpoint, accessToken);
}

export function gmailListMessages(fetchImpl: FetchImpl, accessToken: string, maxResults = 25, pageToken?: string): Promise<GoogleApiResult> {
  const endpoint = `https://gmail.googleapis.com/gmail/v1/users/me/messages${q({ maxResults, pageToken })}`;
  return getJson(fetchImpl, endpoint, accessToken);
}

export function gmailGetMessage(fetchImpl: FetchImpl, accessToken: string, messageId: string): Promise<GoogleApiResult> {
  const endpoint = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}${q({ format: "full" })}`;
  return getJson(fetchImpl, endpoint, accessToken);
}

export function calendarListCalendars(fetchImpl: FetchImpl, accessToken: string): Promise<GoogleApiResult> {
  return getJson(fetchImpl, "https://www.googleapis.com/calendar/v3/users/me/calendarList", accessToken);
}

export function calendarListEvents(
  fetchImpl: FetchImpl,
  accessToken: string,
  calendarId: string,
  maxResults = 25,
): Promise<GoogleApiResult> {
  const endpoint = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events${q({ maxResults, singleEvents: "true", orderBy: "startTime" })}`;
  return getJson(fetchImpl, endpoint, accessToken);
}

export function driveListFiles(fetchImpl: FetchImpl, accessToken: string, query?: string, maxResults = 25): Promise<GoogleApiResult> {
  const endpoint = `https://www.googleapis.com/drive/v3/files${q({
    q: query,
    pageSize: maxResults,
    fields: "files(id,name,mimeType,modifiedTime,size,owners),nextPageToken",
  })}`;
  return getJson(fetchImpl, endpoint, accessToken);
}

export function driveGetFileMetadata(fetchImpl: FetchImpl, accessToken: string, fileId: string): Promise<GoogleApiResult> {
  const endpoint = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}${q({
    fields: "id,name,mimeType,modifiedTime,size,owners,webViewLink",
  })}`;
  return getJson(fetchImpl, endpoint, accessToken);
}

export function driveGetFileContent(fetchImpl: FetchImpl, accessToken: string, fileId: string): Promise<GoogleApiResult> {
  const endpoint = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  return getText(fetchImpl, endpoint, accessToken);
}

export function sheetsGetSpreadsheet(fetchImpl: FetchImpl, accessToken: string, spreadsheetId: string): Promise<GoogleApiResult> {
  const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}${q({
    fields: "spreadsheetId,properties,sheets.properties",
  })}`;
  return getJson(fetchImpl, endpoint, accessToken);
}

export function sheetsGetValues(
  fetchImpl: FetchImpl,
  accessToken: string,
  spreadsheetId: string,
  range: string,
): Promise<GoogleApiResult> {
  const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`;
  return getJson(fetchImpl, endpoint, accessToken);
}
