// One-off: manually unblocks a contact whose messages arrived before
// tryAutoBuildEvent existed (2026-07-10) — normal flow now handles this live
// via line-webhook-v2/handlers/text.ts, this is only for the backlog.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4"
import { tryAutoBuildEvent } from "../line-webhook-v2/engines/auto-build-event.ts"

Deno.serve(async (req) => {
  const expected = Deno.env.get('RECONCILE_CRON_SECRET')
  const got = req.headers.get('x-reconcile-secret')
  if (!expected || got !== expected) return new Response('unauthorized', { status: 401 })

  const { userId } = await req.json()
  if (!userId) return Response.json({ error: 'userId required' }, { status: 400 })

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const reply = await tryAutoBuildEvent(supabase, userId)

  if (reply) {
    const token = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN')
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
