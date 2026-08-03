// Shared Gmail Connector (owner, 2026-08-03) — extracted out of
// bank-email-sync/index.ts and supabase-billing-sync/index.ts, which had
// grown two identical copies of getAccessToken()/base64UrlDecode()/
// findPart()/htmlToPlainText()/extractBodyText() (real KM-002-shaped
// duplication, caught while building a THIRD copy for
// subscription-email-sync — Rule 101/103: extend, don't triplicate).
// Read-only Gmail OAuth (gmail.readonly scope, never send/modify/delete),
// same GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET/GMAIL_REFRESH_TOKEN secrets the
// other two functions already use.

export async function getGmailAccessToken(): Promise<string | null> {
  const clientId = Deno.env.get("GMAIL_CLIENT_ID")
  const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET")
  const refreshToken = Deno.env.get("GMAIL_REFRESH_TOKEN")
  if (!clientId || !clientSecret || !refreshToken) return null

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: refreshToken, grant_type: "refresh_token",
    }),
  })
  if (!res.ok) return null
  const data = await res.json()
  return data.access_token ?? null
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
