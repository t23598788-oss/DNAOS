// One-off: manually unblocks a contact whose messages arrived before
// tryAutoBuildEvent existed (2026-07-10) — normal flow now handles this live
// via line-webhook-v2/handlers/text.ts, this is only for the backlog.
//
// Real fix, 2026-07-31 (see registry/existence.json KM-011): the
// synchronous tryAutoBuildEvent()/auto-build-event.ts this called was
// deleted — it depended on a Claude call that has been silently returning
// null in production (dead API key/credit), fully superseded by the real,
// working async local-AI path (ai_tasks kind='handle_text' →
// ai-task-watcher.mjs on the owner's Mac → ai-callback →
// build-event-from-extraction.ts). This backlog tool now enqueues into that
// SAME real queue instead of trying to extract synchronously (which can
// never work from a Deno cloud function anyway — Ollama only listens on the
// owner's own Mac). No immediate LINE push here anymore; the local watcher
// sends the real reply once it actually processes the task, same as any
// other live message.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4"

Deno.serve(async (req) => {
  const expected = Deno.env.get('RECONCILE_CRON_SECRET')
  const got = req.headers.get('x-reconcile-secret')
  if (!expected || got !== expected) return new Response('unauthorized', { status: 401 })

  const { userId } = await req.json()
  if (!userId) return Response.json({ error: 'userId required' }, { status: 400 })

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: lastMessage } = await supabase
    .from('line_events').select('id, raw_text').eq('line_user_id', userId)
    .eq('raw_type', 'text').order('created_at', { ascending: false }).limit(1).maybeSingle()

  const { error } = await supabase.from('ai_tasks').insert({
    kind: 'handle_text',
    line_user_id: userId,
    line_event_id: lastMessage?.id ?? null,
    input_text: lastMessage?.raw_text ?? null,
    status: 'pending',
  })

  return Response.json(error ? { error: error.message } : { enqueued: true })
})
