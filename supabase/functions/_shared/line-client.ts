// Shared LINE Connector credential helper (owner, 2026-09-18) — the Edge-side
// half of the canonical LINE credential path, extracted because 11 Edge
// functions had each been reading LINE_CHANNEL_ACCESS_TOKEN from Deno env
// directly (Rule 101/103: extend the canonical path, don't keep 11 private
// copies of the credential source).
//
// Credential acquisition mirrors _shared/gmail-client.ts (owner-approved Gmail
// Phase 2): Edge Functions (Deno) cannot import core/connector-loader.ts, so
// this helper asks the Node-side internal bridge
// (app/api/internal/line/token) which resolves the real "line" connector
// through the canonical loader and enforces the connector lifecycle Run gate
// (Connect → Register → Test → Enable → Run — registry/connector-lifecycle.json).
// Fail-closed by design: bridge unreachable / connector not runnable → null —
// NO env fallback (never silently bypass the lifecycle). Callers keep their
// existing "token missing → skip/return error" behavior unchanged.
export async function getLineChannelAccessToken(): Promise<string | null> {
  const appUrl = Deno.env.get("DNA_OS_APP_URL")
  const internalSecret = Deno.env.get("LINE_INTERNAL_SECRET")
  if (!appUrl || !internalSecret) return null

  try {
    const res = await fetch(`${appUrl.replace(/\/+$/, "")}/api/internal/line/token`, {
      method: "POST",
      headers: { "x-line-internal-secret": internalSecret },
    })
    if (!res.ok) return null
    const data = await res.json()
    return data?.access_token ?? null
  } catch {
    return null
  }
}
