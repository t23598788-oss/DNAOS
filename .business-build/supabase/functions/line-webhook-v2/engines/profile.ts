// Fetches a LINE contact's real displayName/pictureUrl via the LINE Get Profile API.
// Called at save-time (see events/store.ts) so a contact's identity is known from
// their very first event — including "follow" (add friend), which carries no text.

import { getLineChannelAccessToken } from "../../_shared/line-client.ts"

export interface LineProfile {
  displayName: string | null
  pictureUrl: string | null
  error?: string
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchLineProfileOnce(userId: string, token: string): Promise<LineProfile> {
  const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  })
  if (!res.ok) {
    const body = await res.text()
    return { displayName: null, pictureUrl: null, error: `HTTP ${res.status}: ${body}` }
  }
  const json = await res.json()
  return {
    displayName: json.displayName ?? null,
    pictureUrl: json.pictureUrl ?? null,
  }
}

// Retries transient failures (network blips, LINE-side 5xx, brief propagation
// delay right after a "follow") — does NOT retry 404 (not a friend, will never
// succeed) since that's a real, permanent answer, not a glitch.
export async function fetchLineProfile(userId: string): Promise<LineProfile | null> {
  // Canonical credential path (LINE cutover): bridge → Run gate — fail-closed.
  const token = await getLineChannelAccessToken()
  if (!token) return { displayName: null, pictureUrl: null, error: 'LINE connector ยังไม่พร้อม (เช็ค lifecycle ที่ /admin/connectors)' }

  const delays = [0, 400, 1200]
  let last: LineProfile = { displayName: null, pictureUrl: null, error: 'unknown' }

  for (const delay of delays) {
    if (delay) await sleep(delay)
    try {
      last = await fetchLineProfileOnce(userId, token)
    } catch (err) {
      last = { displayName: null, pictureUrl: null, error: String(err) }
    }
    if (last.displayName || last.error?.startsWith('HTTP 404')) break
  }

  if (last.error && !last.error.startsWith('HTTP 404')) {
    console.error('[profile] LINE Get Profile failed after retries:', last.error)
  }
  return last
}
