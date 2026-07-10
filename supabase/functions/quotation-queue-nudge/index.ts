// One-off catch-up: business_events created BEFORE the auto-job-creation
// logic (engines/jobs/auto-create.ts) was wired into build-event never got
// asked for their missing info. This nudges them now — same short, direct
// asks, no guessing (owner instruction 2026-07-10: "ถามตรงๆ...ไม่ต้องอธิบาย
// เยอะ"). Guarded by the same secret as line-profile-reconcile.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4"

const MISSING_LABEL: Record<string, string> = {
  partner: "ขอชื่อบริษัทหรือชื่อที่ติดต่อด้วยครับ",
  material: "ส่งชนิดวัสดุที่ต้องการให้หน่อยครับ",
  quantity: "ขอจำนวนที่ต้องการด้วยครับ",
  destination: "ส่ง GPS หรือที่อยู่จัดส่งให้หน่อยครับ",
  contact: "ขอชื่อผู้ติดต่อหน้างานกับเบอร์โทรด้วยครับ",
}

const QUOTE_ONLY_TYPES = new Set(["ขอราคา", "สอบถามทั่วไป", "inquiry"])

function splitMaterialText(text: string): string[] {
  return text.split(/[,、]|(?:\bและ\b)|(?:\bกับ\b)/).map((s) => s.trim()).filter(Boolean)
}

Deno.serve(async (req) => {
  const expected = Deno.env.get('RECONCILE_CRON_SECRET')
  const got = req.headers.get('x-reconcile-secret')
  if (!expected || got !== expected) return new Response('unauthorized', { status: 401 })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const lineToken = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN')
  if (!lineToken) return Response.json({ error: 'LINE_CHANNEL_ACCESS_TOKEN not set' }, { status: 500 })

  const supabase = createClient(supabaseUrl, serviceKey)

  const { data: events, error } = await supabase
    .from('business_events')
    .select('id, event_code, event_type, partner_id, material_text, quantity, destination, contact_phone, source_line_user_id')
    .in('status', ['quotation_pending', 'awaiting_info'])

  if (error) return Response.json({ error: error.message }, { status: 500 })

  const { data: materialTypes } = await supabase.from('material_types').select('id, name')
  const results: Record<string, string> = {}

  for (const ev of events ?? []) {
    if (!ev.source_line_user_id) { results[ev.event_code] = 'no line_user_id, skipped'; continue }

    const isQuoteOnly = QUOTE_ONLY_TYPES.has(ev.event_type ?? '')
    const missing: string[] = []
    let ambiguous: { input: string; candidates: string[] } | null = null

    if (!isQuoteOnly && !ev.partner_id) missing.push('partner')

    if (!ev.material_text) {
      missing.push('material')
    } else {
      for (const part of splitMaterialText(ev.material_text)) {
        const norm = part.replace(/\s+/g, '')
        const exact = (materialTypes ?? []).find((m: any) => m.name.replace(/\s+/g, '') === norm)
        if (exact) continue
        const candidates = (materialTypes ?? []).filter((m: any) => {
          const mn = m.name.replace(/\s+/g, '')
          return mn.includes(norm) || norm.includes(mn)
        })
        if (candidates.length !== 1) {
          missing.push('material')
          if (candidates.length > 1) ambiguous = { input: part, candidates: candidates.map((c: any) => c.name) }
          break
        }
      }
    }

    if (!ev.quantity) missing.push('quantity')

    if (isQuoteOnly) {
      if (!ev.destination) missing.push('destination')
    } else if (ev.partner_id) {
      const { data: site } = await supabase
        .from('customer_sites').select('id').eq('customer_company_id', ev.partner_id).eq('is_active', true).limit(1).maybeSingle()
      if (!site && !ev.destination) missing.push('destination')
    } else {
      if (!ev.destination) missing.push('destination')
    }

    if (!isQuoteOnly && !ev.contact_phone) missing.push('contact')

    if (missing.length === 0) { results[ev.event_code] = 'already complete, no nudge needed'; continue }

    const text = ambiguous
      ? `"${ambiguous.input}" เอาชนิดไหนครับ ${ambiguous.candidates.join(' / ')}`
      : missing.map((m) => MISSING_LABEL[m]).filter(Boolean).join(' ')

    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lineToken}` },
      body: JSON.stringify({ to: ev.source_line_user_id, messages: [{ type: 'text', text }] }),
    })
    results[ev.event_code] = res.ok ? `sent: ${text}` : `failed HTTP ${res.status}`
  }

  return Response.json({ checked: (events ?? []).length, results })
})
