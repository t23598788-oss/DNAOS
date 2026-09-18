import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4";
import { getLineChannelAccessToken } from "../../_shared/line-client.ts";

async function logErrorToDb(errorMsg: string) {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (supabaseUrl && supabaseServiceKey) {
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      const { data: latestEvent } = await supabase
        .from('line_events')
        .select('id, admin_note')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestEvent) {
        let note = {};
        try {
          note = JSON.parse(latestEvent.admin_note || '{}');
        } catch {
          note = { raw_note: latestEvent.admin_note };
        }
        const updatedNote = { ...note, webhook_v2_error: errorMsg };
        await supabase
          .from('line_events')
          .update({ admin_note: JSON.stringify(updatedNote) })
          .eq('id', latestEvent.id);
      }
    }
  } catch (e) {
    console.error('Failed to log error to DB:', e);
  }
}

// --- Low-level LINE API senders ---

// Every outbound send gets logged here, at the one choke point both
// replyMessages() and pushMessages() go through — no call site elsewhere in
// the codebase needs to change. Before this, line_events only ever held
// INBOUND customer messages; nothing the bot said back was ever recorded, so
// no screen could show a real two-sided conversation (owner request
// 2026-07-11: make the admin chat view show both sides like the real LINE
// app). reply_token is looked up against the inbound row that carried it to
// find which contact this reply belongs to, since LINE's reply API itself
// doesn't include a userId.
function extractReadableText(messages: any[]): string {
  const first = messages[0] as any
  return first?.text ?? first?.altText ?? `(${first?.type ?? "message"})`
}

async function logOutboundToDb(lineUserId: string | null, messages: object[]) {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !supabaseServiceKey || !lineUserId) return
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    await supabase.from('line_events').insert({
      line_user_id: lineUserId,
      raw_type: 'text',
      raw_text: extractReadableText(messages),
      status: 'processed',
      direction: 'out',
    })
  } catch (e) {
    console.error('Failed to log outbound message to DB:', e)
  }
}

async function resolveUserIdFromReplyToken(replyToken: string): Promise<string | null> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !supabaseServiceKey) return null
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const { data } = await supabase
      .from('line_events')
      .select('line_user_id')
      .eq('reply_token', replyToken)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    return data?.line_user_id ?? null
  } catch {
    return null
  }
}

// Customer Auto-Reply Kill Switch (owner, 2026-07-31): "ปิดท่อตัดท่อการต่อ
// ข้อความอัตโนมัติลูกค้าก่อน...ยังรับข้อมูลเข้ามาประมวลผลเข้าเก็บในคลัง
// หลังบ้านเราเหมือนเดิม แต่ไม่มีการตอบพูดคุยกับลูกค้า...ของเฮีย LINE ของเฮีย
// ห้ามปิด" — owner is auditing the cognitive/session-isolation work before
// letting the bot talk to real customers again. Nothing about inbound
// processing changes (saveEvent, classification, ai_tasks, receipt/
// business-event writes all still run exactly as before) — this is
// deliberately the single outbound choke point every reply/push method
// funnels through, so no per-handler edits were needed anywhere else.
// To re-enable customer replies, remove this block (or delete the env var).
async function isOwnerLineUserId(userId: string | null): Promise<boolean> {
  const ownerId = Deno.env.get('OWNER_LINE_USER_ID')
  return !!ownerId && userId === ownerId
}

async function replyMessages(replyToken: string, messages: object[]) {
  const targetUserId = await resolveUserIdFromReplyToken(replyToken)
  if (!(await isOwnerLineUserId(targetUserId))) {
    console.log(`[LINE Reply SUPPRESSED — customer auto-reply is off] would have sent to ${targetUserId}:`, JSON.stringify(messages))
    return
  }

  // Canonical credential path (LINE cutover): bridge → connector lifecycle
  // Run gate — fail-closed, no env fallback (mock log = token unavailable).
  const lineAccessToken = await getLineChannelAccessToken()
  if (!lineAccessToken) {
    console.log(`[LINE Reply Mock]`, JSON.stringify(messages))
    return
  }
  const res = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${lineAccessToken}` },
    body: JSON.stringify({ replyToken, messages }),
  })
  if (!res.ok) {
    const err = await res.text()
    console.error('LINE reply failed:', err)
    await logErrorToDb(`LINE reply failed: ${err}`)
    return
  }
  await logOutboundToDb(targetUserId, messages)
}

// Owner-reported bug (2026-07-26): "ทำไมไม่มีเห็นแจ้งเตือนว่าอ่านแล้วหรือยัง
// ไม่ได้อ่าน...คนใช้งานอีกฝั่งไม่รู้เลยว่ากูรอคำตอบจากใครวะ" — real silence
// while a message sits in the local-AI queue (up to ~20-30s) feels dead.
// LINE's real "loading animation" API shows a genuine "..." typing-style
// indicator in the chat for a bounded, real number of seconds — not a fake
// promise, an actual visual cue the platform provides for exactly this.
async function showLoadingAnimation(userId: string, seconds: number) {
  if (!(await isOwnerLineUserId(userId))) return // customer auto-reply is off — see replyMessages
  const lineAccessToken = await getLineChannelAccessToken()
  if (!lineAccessToken) return
  // LINE requires a multiple of 5, clamped 5-60.
  const clamped = Math.min(60, Math.max(5, Math.round(seconds / 5) * 5))
  const res = await fetch('https://api.line.me/v2/bot/chat/loading/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${lineAccessToken}` },
    body: JSON.stringify({ chatId: userId, loadingSeconds: clamped }),
  })
  if (!res.ok) {
    console.error('LINE loading animation failed:', await res.text())
  }
}

async function pushMessages(to: string, messages: object[]) {
  if (!(await isOwnerLineUserId(to))) {
    console.log(`[LINE Push SUPPRESSED — customer auto-reply is off] would have sent to ${to}:`, JSON.stringify(messages))
    return
  }

  const lineAccessToken = await getLineChannelAccessToken()
  if (!lineAccessToken) {
    console.log(`[LINE Push Mock]`, JSON.stringify(messages))
    return
  }
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${lineAccessToken}` },
    body: JSON.stringify({ to, messages }),
  })
  if (!res.ok) {
    const err = await res.text()
    console.error('LINE push failed:', err)
    await logErrorToDb(`LINE push failed: ${err}`)
    return
  }
  await logOutboundToDb(to, messages)
}

/**
 * STRICTLY PRIVATE: replyToLine.
 * Dispatches raw messages directly to the LINE Messaging API.
 */
async function replyToLine(replyToken: string, text: string) {
  await replyMessages(replyToken, [{ type: 'text', text }])
}

/**
 * STRICTLY PRIVATE: pushToLine.
 * Dispatches raw messages directly to the LINE Messaging API via push endpoint.
 */
async function pushToLine(to: string, text: string) {
  await pushMessages(to, [{ type: 'text', text }])
}

// Removed 2026-07-26 (owner: "เก็บงานให้เรียบร้อยให้หมดก่อนซีซั่นนี้",
// following the architecture audit's finding of dead hardcoded-pricing
// paths still live in the file). Per Rule 104 (Nothing Is Wasted), the
// knowledge is recorded here before deletion, not just silently dropped:
//
// - `sendLineNotify()` (LINE Notify API), `askGeminiAgent()` (Gemini LLM
//   call, GEMINI_API_KEY), `ResponsePayload` type, `pushFacebookMessage()`,
//   `pushTikTokMessage()`, and `ResponseGateway.dispatchResponse()` (the
//   PRELIMINARY_PRICING/BOQ_DRAFT cases that called `sanitizePricing()`
//   with its hardcoded fallbacks `materialBasePrice ?? 120`,
//   `targetDistance ?? 15`, `markupPercent ?? 25`) were confirmed via
//   `grep -rn "dispatchResponse"` to have ZERO real call sites anywhere in
//   this repo — an earlier-generation pricing/response pipeline, fully
//   superseded by `engines/quote-price.ts` (real DB-driven pricing,
//   deployed 2026-07-25/26) and the `ResponseGateway.replyText/replyFlex/
//   pushMessage/pushFlex` methods still below, which the live code paths
//   actually use.
// - Facebook/TikTok/Gemini/LINE-Notify integrations were never wired to
//   any real trigger — no admin route, webhook handler, or cron job ever
//   called them. If a real Facebook/TikTok channel or Gemini-based
//   response step is wanted later, it should be built fresh against the
//   current architecture (ai_tasks queue + local Ollama, or a real cloud
//   key), not resurrected from this dead code — the old design assumed a
//   synchronous cloud-LLM call inside the webhook request, which this
//   repo confirmed doesn't hold (no ANTHROPIC_API_KEY, and by extension no
//   reason to assume GEMINI_API_KEY was ever really configured either).
// - `middleware/sanitizer.ts` (`sanitizePricing`, `RawPricingData`) is now
//   unused by this file too — left in place as its own file (not deleted)
//   since Rule 104 knowledge-extraction for *that* file's specific
//   history lives in its own header comment; a future cleanup pass can
//   remove the file itself once confirmed to have zero other importers.

export class ResponseGateway {
  static async pushMessage(to: string, text: string) {
    await pushToLine(to, text);
  }

  // --- LINE Native Template methods ---

  static async replyText(replyToken: string, text: string) {
    await replyMessages(replyToken, [{ type: 'text', text }])
  }

  static async replyFlex(replyToken: string, altText: string, contents: object) {
    await replyMessages(replyToken, [{ type: 'flex', altText, contents }])
  }

  static async replyWithQuickReply(replyToken: string, text: string, items: object[]) {
    await replyMessages(replyToken, [{
      type: 'text',
      text,
      quickReply: { items },
    }])
  }

  static async pushFlex(to: string, altText: string, contents: object) {
    await pushMessages(to, [{ type: 'flex', altText, contents }])
  }

  static async pushWithQuickReply(to: string, text: string, items: object[]) {
    await pushMessages(to, [{
      type: 'text',
      text,
      quickReply: { items },
    }])
  }

  static async showLoading(userId: string, seconds: number) {
    await showLoadingAnimation(userId, seconds)
  }
}
