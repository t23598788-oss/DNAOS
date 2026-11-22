// Shared Gmail Connector (owner, 2026-08-03) — extracted out of
// bank-email-sync/index.ts and supabase-billing-sync/index.ts, which had
// grown two identical copies of getAccessToken()/base64UrlDecode()/
// findPart()/htmlToPlainText()/extractBodyText() (real KM-002-shaped
// duplication, caught while building a THIRD copy for
// subscription-email-sync — Rule 101/103: extend, don't triplicate).
// Read-only Gmail OAuth (gmail.readonly scope, never send/modify/delete).

// Credential acquisition (owner-approved Phase 2): the OAuth material no longer
// lives in Deno env (GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET/GMAIL_REFRESH_TOKEN).
// This function now asks the Node-side internal bridge
// (app/api/internal/gmail/token) which resolves the real Gmail connector
// through the canonical loader and enforces the connector lifecycle Run gate
// (Connect → Register → Test → Enable → Run — registry/connector-lifecycle.json).
// Fail-closed by design: bridge unreachable / connector not runnable → null —
// NO env fallback (never silently bypass the lifecycle).
export type GmailAccessContext = {
  accessToken: string
  connectorId: string | null
  mailboxEmail: string | null
}

async function fetchAccessContextViaBridge(includeMailboxIdentity = false): Promise<GmailAccessContext | null> {
  const appUrl = Deno.env.get("DNA_OS_APP_URL")
  const internalSecret = Deno.env.get("GMAIL_INTERNAL_SECRET")
  if (!appUrl || !internalSecret) return null

  try {
    const res = await fetch(`${appUrl.replace(/\/+$/, "")}/api/internal/gmail/token`, {
      method: "POST",
      headers: {
        "x-gmail-internal-secret": internalSecret,
        ...(includeMailboxIdentity ? { "x-gmail-include-mailbox-identity": "true" } : {}),
      },
    })
    if (!res.ok) return null
    const data = await res.json()
    if (typeof data?.access_token !== "string") return null
    return {
      accessToken: data.access_token,
      connectorId: typeof data.connector_id === "string" ? data.connector_id : null,
      mailboxEmail: typeof data.mailbox_email === "string" ? data.mailbox_email : null,
    }
  } catch {
    return null
  }
}

export async function getGmailAccessToken(): Promise<string | null> {
  return (await fetchAccessContextViaBridge())?.accessToken ?? null
}

export async function getGmailAccessContext(): Promise<GmailAccessContext | null> {
  return fetchAccessContextViaBridge(true)
}

function base64UrlDecode(data: string): string {
  const padded = data.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (data.length % 4)) % 4)
  // Gmail bodies are UTF-8 — atob() alone mangles Thai text, decode bytes properly.
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder("utf-8").decode(bytes)
}

function findPart(payload: any, mimeType: string): string | null {
  if (payload?.mimeType === mimeType && payload?.body?.data) return base64UrlDecode(payload.body.data)
  for (const part of payload?.parts ?? []) {
    const found = findPart(part, mimeType)
    if (found) return found
  }
  return null
}

// Real bug found live 2026-07-26 (bank-email-sync's first sync run): HTML
// emails with no real newlines (only <br>) let a greedy regex swallow the
// rest of the message. Converts to real plain text before any extraction.
function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&emsp;/gi, "  ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
}

export function extractBodyText(payload: any): string {
  const plain = findPart(payload, "text/plain")
  if (plain) return plain
  const html = findPart(payload, "text/html") ?? (payload?.body?.data ? base64UrlDecode(payload.body.data) : "")
  return html ? htmlToPlainText(html) : ""
}

// Paginated Gmail search — same real safety cap (20 pages * 100 = 2000
// messages) already proven live in bank-email-sync's backfill runs.
export async function searchGmailMessageIds(accessToken: string, query: string): Promise<string[] | { error: string }> {
  const messageIds: string[] = []
  let pageToken: string | undefined
  let pages = 0
  do {
    const url = "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=" +
      encodeURIComponent(query) + "&maxResults=100" + (pageToken ? `&pageToken=${pageToken}` : "")
    const listRes = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!listRes.ok) return { error: `Gmail list API HTTP ${listRes.status}` }
    const listData = await listRes.json()
    messageIds.push(...(listData.messages ?? []).map((m: any) => m.id))
    pageToken = listData.nextPageToken
    pages++
  } while (pageToken && pages < 20)
  return messageIds
}

export async function fetchGmailMessage(accessToken: string, id: string): Promise<any | null> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!res.ok) return null
  return res.json()
}

export function getSubjectHeader(msg: any): string | null {
  return msg.payload?.headers?.find((h: any) => h.name === "Subject")?.value ?? null
}
