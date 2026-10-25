// One-off: re-runs the completeness check + price quote for an existing
// awaiting_info event without waiting for the customer to send another
// message — used to catch up backlog while iterating on tryCompleteAwaitingEvent.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4"
import { tryCompleteAwaitingEvent } from "../line-webhook-v2/engines/event-followup.ts"
import { getLineChannelAccessToken } from "../_shared/line-client.ts"

Deno.serve(async (req) => {
  const expected = Deno.env.get('RECONCILE_CRON_SECRET')
  const got = req.headers.get('x-reconcile-secret')
  if (!expected || got !== expected) return new Response('unauthorized', { status: 401 })

  const { userId } = await req.json()
  if (!userId) return Response.json({ error: 'userId required' }, { status: 400 })

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const reply = await tryCompleteAwaitingEvent(supabase, userId, "")

  if (reply) {
    // Canonical credential path (LINE cutover): skip silently when the
    // connector isn't runnable (same token-missing skip behavior as before).
    const token = await getLineChannelAccessToken()
    if (token) {
      await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ to: userId, messages: [{ type: 'text', text: reply }] }),
      })
    }
  }

  return Response.json({ reply })
})
