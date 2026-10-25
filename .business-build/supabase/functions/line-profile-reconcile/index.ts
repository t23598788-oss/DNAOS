// Runs on a schedule (see migration 20260710000005) to catch any LINE contact
// whose profile (name/picture) is still unknown after the live webhook's own
// retries (events/store.ts + engines/profile.ts) — e.g. they followed during
// a transient LINE API outage. Keeps retrying every few minutes until it
// succeeds, so a contact is never permanently stuck as "ไม่ทราบชื่อ".
//
// Deliberately separate from line-webhook-v2: this one runs on a cron trigger,
// not a LINE webhook delivery, so it has no signature to verify — it's guarded
// by RECONCILE_CRON_SECRET instead (checked below).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4"
import { getLineChannelAccessToken } from "../_shared/line-client.ts"

Deno.serve(async (req) => {
  const expected = Deno.env.get('RECONCILE_CRON_SECRET')
  const got = req.headers.get('x-reconcile-secret')
  if (!expected || got !== expected) {
    return new Response('unauthorized', { status: 401 })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const supabase = createClient(supabaseUrl, serviceKey)

  // Canonical credential path (LINE cutover): bridge → Run gate — fail-closed.
  const lineToken = await getLineChannelAccessToken()
  if (!lineToken) {
    return Response.json({ error: 'LINE connector ยังไม่พร้อม — bridge คืน token ไม่ได้ (เช็ค lifecycle ที่ /admin/connectors)' }, { status: 500 })
  }

  // Direct-message contacts only (group_id null) — group members who never
  // friended the bot will 404 forever, no point retrying those. Missing
  // EITHER name or picture counts as incomplete — LINE sometimes returns a
  // profile with a name but no pictureUrl yet (propagation lag).
  const { data: nameRows, error: nameErr } = await supabase
    .from('line_events').select('line_user_id').is('group_id', null).not('line_user_id', 'is', null).is('line_name', null)
  const { data: pictureRows, error: picErr } = await supabase
    .from('line_events').select('line_user_id').is('group_id', null).not('line_user_id', 'is', null).is('line_picture', null)

  if (nameErr) return Response.json({ error: nameErr.message }, { status: 500 })
  if (picErr) return Response.json({ error: picErr.message }, { status: 500 })

  const userIds = [...new Set([...(nameRows ?? []), ...(pictureRows ?? [])].map((r) => r.line_user_id as string))]
  const results: Record<string, string> = {}

  for (const userId of userIds) {
    try {
      const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
        headers: { Authorization: `Bearer ${lineToken}` },
      })
      if (!res.ok) {
        results[userId] = `HTTP ${res.status}`
        continue
      }
      const profile = await res.json()
      if (!profile.displayName) {
        results[userId] = 'no displayName in response'
        continue
      }
      // Update every row still missing either field for this contact — not
      // just rows where line_name was null, so a name-only row can still
      // pick up the picture once it becomes available.
      const { error: updErr } = await supabase
        .from('line_events')
        .update({ line_name: profile.displayName, line_picture: profile.pictureUrl ?? null })
        .eq('line_user_id', userId)
        .or('line_name.is.null,line_picture.is.null')
      results[userId] = updErr ? `update failed: ${updErr.message}` : `OK: ${profile.displayName}${profile.pictureUrl ? '' : ' (still no picture on LINE side)'}`
    } catch (err) {
      results[userId] = String(err)
    }
  }

  return Response.json({ checked: userIds.length, results })
})
