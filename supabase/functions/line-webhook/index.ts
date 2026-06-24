import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4"
import { 
  getOrInitState, 
  updateConversationState, 
  extractEntities, 
  saveEntitiesToRegistry, 
  executeBusinessValidation,
  checkBusinessQualification
} from "./helpers.ts"


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Haversine formula to compute distance in km between two coordinates
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371 // Radius of the earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  return R * c // Distance in km
}

// Function to reply via LINE Messaging API
async function replyToLine(replyToken: string, text: string) {
  const lineAccessToken = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN')
  if (!lineAccessToken) {
    console.log(`[LINE Reply Mock] Reply Token: ${replyToken}, Message: ${text}`)
    return
  }

  try {
    const res = await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${lineAccessToken}`
      },
      body: JSON.stringify({
        replyToken: replyToken,
        messages: [{ type: 'text', text: text }]
      })
    })

    if (!res.ok) {
      console.error('Failed to reply to LINE:', await res.text())
    } else {
      console.log('Successfully replied to LINE')
    }
  } catch (err) {
    console.error('Error sending reply to LINE:', err)
  }
}

// Function to send LINE Notify to CEO
async function sendLineNotify(message: string) {
  const lineNotifyToken = Deno.env.get('LINE_NOTIFY_TOKEN')
  if (!lineNotifyToken) {
    console.log(`[LINE Notify Mock] Token not configured. Message: ${message}`)
    return
  }

  try {
    const res = await fetch('https://notify-api.line.me/api/notify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Bearer ${lineNotifyToken}`
      },
      body: new URLSearchParams({ message }).toString()
    })

    if (!res.ok) {
      console.error('Failed to send LINE Notify:', await res.text())
    } else {
      console.log('Successfully sent LINE Notify')
    }
  } catch (err) {
    console.error('Error sending LINE Notify:', err)
  }
}

// Primary Gemini Sales Agent handler for smart B2B dialogue & intent parsing
async function askGeminiAgent(userMessage: string, history: any[], contextData: any): Promise<string | null> {
  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) return null // Return null to fallback to native TS Dialogue Agent

  try {
    const systemPrompt = `You are a warm, highly professional Thai B2B materials coordinator and project quotation helper for DNA OS.
Your goal is to answer queries and present calculated pricing structures.
CRITICAL CONSTRAINT RULES (RULES THAT MUST NOT BE VIOLATED):
1. NEVER use the word "ลูกค้า" (customer) under any circumstances. Use words like "คุณ", "ท่าน", or "โครงการ" instead.
2. NEVER use the word "ขาย" (sell/sales/close sales) under any circumstances. Use terms like "จัดหา", "เสนอราคา", "ประสานงานจองคิวรถจัดส่ง" instead.
3. If presenting a price quotation, present it in a highly structured, clean BOQ format:
   📋 ร่างรายการประมาณราคาจัดหาและขนส่งวัสดุ (BOQ Draft)
   -----------------------------------------
   [รายละเอียดข้อมูลโครงการจัดส่ง]
   - จุดจัดส่ง: ...
   - แหล่งผลิต: ...
   [ตารางประมาณราคา]
   1. รายการวัสดุ: ...
      - ปริมาณ: ... คิว
      - อัตราค่าวัสดุ: ... บาท/คิว
      - ยอดรวมค่าวัสดุ: ... บาท
   2. รายการบริการจัดส่ง (จำนวน ... เที่ยว):
      - อัตราค่าบริการ: ... บาท/เที่ยว
      - ยอดรวมค่าขนส่ง: ... บาท
   -----------------------------------------
   💰 ยอดรวมสุทธิประมาณราคาทั้งสิ้น: ... บาท
   📝 เลขอ้างอิงใบร่างในระบบ: [หากมีคำสั่งออกใบเสนอราคา รหัสไอดีจะแสดงในจุดนี้อัตโนมัติ]
   -----------------------------------------
4. Always speak in polite, project-oriented Thai (use particles like ครับ, ค่ะ, ท่าน, คุณ).

Context variables:
${JSON.stringify(contextData, null, 2)}`

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: `User message: "${userMessage}"` }] }
        ],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { maxOutputTokens: 600, temperature: 0.5 }
      })
    })

    if (!res.ok) {
      console.warn('Gemini Agent API call failed:', await res.text())
      return null
    }

    const json = await res.json()
    return json.candidates?.[0]?.content?.parts?.[0]?.text || null
  } catch (err) {
    console.error('Gemini Agent Error:', err)
    return null
  }
}

async function processQuotation(
  supabase: any,
  lineUserId: string,
  eventId: string,
  replyToken: string,
  updatedState: any,
  originalText: string,
  traceLogs?: any[]
) {
  traceLogs?.push({ step: 'process_quotation', status: 'SUCCESS', timestamp: new Date().toISOString() })
  
  // 1. Check Level 2 Business Qualification
  const qualification = checkBusinessQualification(updatedState);
  
  // A. Load Configurations from DB
  const { data: configs } = await supabase
    .from('app_configs')
    .select('title, data')

  let fuelPrice = 43.00
  let driverWage = 450.00
  let defaultDistance = 15.00
  let markupPercent = 25.00
  let capacityPerTrip = 10.00

  if (configs) {
    configs.forEach((c: any) => {
      if (c.title === 'fuel-price') fuelPrice = parseFloat(c.data) || fuelPrice
      if (c.title === 'driver-wage-per-trip') driverWage = parseFloat(c.data) || driverWage
      if (c.title === 'minimum-distance') defaultDistance = parseFloat(c.data) || defaultDistance
      if (c.title === 'pricing-markup-percent') markupPercent = parseFloat(c.data) || markupPercent
      if (c.title === 'vehicle-default-capacity') capacityPerTrip = parseFloat(c.data) || capacityPerTrip
    })
  }

  // B. Load Material Prices
  const { data: dbMaterials } = await supabase
    .from('pit_materials')
    .select(`
      price,
      material_types(name),
      pit_profiles(pit_name, latitude, longitude)
    `)

  // C. Load Driver Queue
  const { data: drivers } = await supabase
    .from('driver_profiles')
    .select(`
      driver_name,
      vehicle_plate_text,
      vehicle_plate_code,
      vehicle_plate_province,
      job_assignments(
        assignment_status,
        jobs(project_name)
      )
    `)

  let queueText = ''
  if (drivers) {
    drivers.forEach((driver: any, index: number) => {
      const activeAssignment = driver.job_assignments?.find((a: any) =>
        a.assignment_status === 'ACCEPTED' || a.assignment_status === 'IN_PROGRESS'
      )
      const plate = `${driver.vehicle_plate_code || ''} ${driver.vehicle_plate_text || ''} ${driver.vehicle_plate_province || ''}`.trim()
      if (activeAssignment) {
        queueText += `${driver.driver_name} (${plate}) - ไม่ว่าง (งาน: ${activeAssignment.jobs?.project_name})\n`
      } else {
        queueText += `${driver.driver_name} (${plate}) - ว่างพร้อมปฏิบัติงาน\n`
      }
    })
  }

  // D. Load Last Created Draft Document details
  const { data: lastDraft } = await supabase
    .from('line_draft_documents')
    .select('id, payload, status')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // E. Retrieve last few chat history events
  const { data: historyEvents } = await supabase
    .from('line_events')
    .select('raw_text, raw_type, created_at')
    .eq('line_user_id', lineUserId)
    .order('created_at', { ascending: false })
    .limit(6)

  const history = historyEvents ? historyEvents.reverse().map((h: any) => ({
    type: h.raw_type,
    text: h.raw_text,
    time: h.created_at
  })) : []

  // Synthesize routing text for the fallback router & Gemini matching
  let routingText = originalText
  if (updatedState.current_intent === 'PRICE_REQUEST' && updatedState.material && updatedState.quantity) {
    routingText = `ขอราคา ${updatedState.material} จำนวน ${updatedState.quantity} คิว`
    if (updatedState.vehicle_type) {
      if (updatedState.vehicle_type === 'trailer') routingText += ' รถพ่วง'
      else if (updatedState.vehicle_type === '6_wheeler') routingText += ' รถหกล้อ'
      else if (updatedState.vehicle_type === '10_wheeler') routingText += ' รถสิบล้อ'
    }
  }

  // Compile Context for Gemini
  const contextData = {
    configs: { fuelPrice, driverWage, defaultDistance, markupPercent, capacityPerTrip },
    materials: dbMaterials?.map((m: any) => ({
      material: m.material_types?.name,
      pit: m.pit_profiles?.pit_name,
      price: m.price,
      lat: m.pit_profiles?.latitude,
      lng: m.pit_profiles?.longitude
    })),
    driverQueue: queueText.trim(),
    lastDraft: lastDraft ? {
      id: lastDraft.id,
      payload: lastDraft.payload,
      status: lastDraft.status
    } : null,
    conversationState: updatedState
  }

  // Resolve distance, address and pit details
  let targetDistance = defaultDistance
  let finalAddress = 'จุดจัดส่งประเมินเริ่มต้น'
  let matchedPitName = 'บ่อวัสดุในระบบ'

  if (updatedState.destination_location && updatedState.destination_location.lat && updatedState.destination_location.lng) {
    const userLat = updatedState.destination_location.lat
    const userLng = updatedState.destination_location.lng
    finalAddress = updatedState.destination_location.address || updatedState.destination_text || 'จุดจัดส่งประเมินเริ่มต้น'

    const { data: pits } = await supabase
      .from('pit_profiles')
      .select('pit_name, latitude, longitude')
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)

    if (pits && pits.length > 0) {
      let currentMin = Infinity
      pits.forEach((pit: any) => {
        const d = calculateDistance(userLat, userLng, parseFloat(pit.latitude), parseFloat(pit.longitude))
        if (d < currentMin) {
          currentMin = d
          matchedPitName = pit.pit_name
        }
      })
      if (currentMin !== Infinity) {
        targetDistance = parseFloat(currentMin.toFixed(2))
      }
    }
  }

  // Match material details and base price
  let materialInput = updatedState.material || 'ทรายหยาบ'
  if (materialInput === 'ทราย' || materialInput === 'ทรายถม') materialInput = 'ทรายหยาบ'
  if (materialInput === 'หิน') materialInput = 'หินคลุก'

  const cleanedMaterialInput = materialInput.replace(/\s+/g, '')
  const { data: matType } = await supabase
    .from('material_types')
    .select('id, name')
    .ilike('name', `%${cleanedMaterialInput}%`)
    .limit(1)
    .maybeSingle()

  let resolvedMatName = materialInput
  let materialBasePrice = 120.00
  if (matType) {
    resolvedMatName = matType.name
    const { data: pitMat } = await supabase
      .from('pit_materials')
      .select('price')
      .eq('material_type_id', matType.id)
      .order('price', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (pitMat && pitMat.price) {
      materialBasePrice = parseFloat(pitMat.price)
    }
  }

  const quantity = updatedState.quantity || 0
  const materialCost = quantity * materialBasePrice
  const transportCostPerTrip = (targetDistance * fuelPrice) + driverWage

  const vehicleThaiLabels: Record<string, string> = {
    '6_wheeler': 'รถหกล้อ',
    '10_wheeler': 'รถสิบล้อ',
    'trailer': 'รถพ่วง'
  }

  // CASE 1: UNQUALIFIED STATE (Missing level 2 fields) -> Reply with preliminary price ONLY. DO NOT create BOQ.
  if (!qualification.isQualified) {
    const getOptionText = (label: string, cap: number) => {
      const trips = Math.ceil(quantity / cap)
      const totalTransport = trips * transportCostPerTrip
      const totalCost = materialCost + totalTransport
      const markup = totalCost * (markupPercent / 100)
      const total = totalCost + markup
      return `- ${label} (บรรจุ ${cap} คิว/เที่ยว - จำนวน ${trips} เที่ยว):\n` +
             `  • ค่าจัดส่ง: ${transportCostPerTrip.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} บาท/เที่ยว (รวม ${totalTransport.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} บาท)\n` +
             `  • ยอดรวมประมาณการวัสดุ+ค่าส่ง (รวมกำไร): ${total.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})} บาท`
    }

    let transportOptionsText = ''
    if (updatedState.vehicle_type) {
      const cap = updatedState.vehicle_type === 'trailer' ? 30.00 : (updatedState.vehicle_type === '6_wheeler' ? 5.00 : 10.00)
      const label = vehicleThaiLabels[updatedState.vehicle_type] || 'รถขนส่ง'
      transportOptionsText = getOptionText(label, cap)
    } else {
      transportOptionsText = getOptionText('รถหกล้อ', 5.00) + '\n' +
                             getOptionText('รถสิบล้อ', 10.00) + '\n' +
                             getOptionText('รถพ่วง', 30.00)
    }

    const missingThai = qualification.missingFields.map(f => qualification.thaiFieldNames[f] || f)
    const missingListText = missingThai.map(f => `🔹 ${f}`).join('\n')

    const replyText = `💸 ราคาประเมินเบื้องต้น (Preliminary Price)\n` +
                      `-----------------------------------------\n` +
                      `- ชนิดวัสดุ: ${resolvedMatName}\n` +
                      `- ปริมาณ: ${quantity} คิว\n` +
                      `- จุดจัดส่ง: ${finalAddress}\n` +
                      `- แหล่งผลิต/บ่อวัสดุ: ${matchedPitName} (ระยะจริง ${targetDistance} กม.)\n` +
                      `- ราคาหน้าบ่อเริ่มต้น: ${materialBasePrice.toLocaleString()} บาท/คิว (ค่าวัสดุรวม: ${materialCost.toLocaleString()} บาท)\n\n` +
                      `[ตัวเลือกค่าบริการขนส่งและยอดรวมจัดส่งประเมิน]:\n` +
                      `${transportOptionsText}\n` +
                      `-----------------------------------------\n` +
                      `⚠️ ข้อมูลไม่เพียงพอสำหรับการจัดทำ BOQ / ใบเสนอราคาอย่างเป็นทางการ\n\n` +
                      `รบกวนแจ้งข้อมูลโครงการและข้อมูลติดต่อเพิ่มเติมดังนี้ครับ:\n` +
                      `${missingListText}\n` +
                      `-----------------------------------------\n` +
                      `เมื่อได้รับข้อมูลครบถ้วนแล้ว ระบบจะออกใบร่างเสนอราคา BOQ อัตโนมัติทันทีครับ!`

    traceLogs?.push({ step: 'quotation', status: 'BLOCKED', reason: 'Missing Level 2 Business Qualification fields', timestamp: new Date().toISOString() })
    if (traceLogs) {
      await supabase.from('line_events').update({
        admin_note: JSON.stringify({ trace_log: traceLogs })
      }).eq('id', eventId)
    }
    await replyToLine(replyToken, replyText)
    return
  }

  // CASE 2: QUALIFIED STATE -> Create BOQ Draft document and send notifications
  let matchedCapacity = capacityPerTrip
  if (updatedState.vehicle_type === 'trailer') {
    matchedCapacity = 30.00
  } else if (updatedState.vehicle_type === '6_wheeler') {
    matchedCapacity = 5.00
  } else if (updatedState.vehicle_type === '10_wheeler') {
    matchedCapacity = 10.00
  }

  const trips = Math.ceil(quantity / matchedCapacity)
  const totalTransportCost = trips * transportCostPerTrip
  const totalCost = materialCost + totalTransportCost
  const markupMargin = totalCost * (markupPercent / 100)
  const totalPrice = totalCost + markupMargin

  const draftPayload = {
    document_type: 'invoice',
    party_name: updatedState.payer_name || `โครงการ LINE ID: ${lineUserId.substring(0, 10)}...`,
    project_name: updatedState.project_name,
    contact_name: updatedState.contact_name,
    contact_phone: updatedState.contact_phone,
    discount_amount: 0,
    vat_enabled: false,
    withholding_tax_percent: 0,
    subtotal_amount: parseFloat(totalCost.toFixed(2)),
    markup_margin: parseFloat(markupMargin.toFixed(2)),
    gross_amount: parseFloat(totalPrice.toFixed(2)),
    net_amount: parseFloat(totalPrice.toFixed(2)),
    items: [
      {
        description: `ค่าวัสดุ ${resolvedMatName}`,
        qty: quantity,
        unit_label: 'คิว',
        unit_price: materialBasePrice,
        line_total: materialCost
      },
      {
        description: `ค่าบริการขนส่ง (ระยะขนส่งจริง ${targetDistance} กม. จำนวน ${trips} เที่ยวด้วยรถคันละ ${matchedCapacity} คิว)`,
        qty: trips,
        unit_label: 'เที่ยว',
        unit_price: parseFloat(transportCostPerTrip.toFixed(2)),
        line_total: totalTransportCost
      }
    ]
  }

  const { data: draft } = await supabase
    .from('line_draft_documents')
    .insert({
      event_id: eventId,
      doc_type: 'invoice',
      payload: draftPayload,
      status: 'pending'
    })
    .select()
    .single()

  let boqText = ''
  if (draft) {
    traceLogs?.push({ step: 'create_draft', status: 'SUCCESS', data: { draft_id: draft.id }, timestamp: new Date().toISOString() })
    await updateConversationState(lineUserId, { status: 'COMPLETED' }, supabase)
    
    boqText = `📋 ร่างรายการประมาณราคาจัดหาและขนส่งวัสดุ (BOQ Draft)\n` +
      `-----------------------------------------\n` +
      `[รายละเอียดข้อมูลโครงการจัดส่ง]\n` +
      `- โครงการ: ${updatedState.project_name}\n` +
      `- ผู้รับสินค้า/ผู้ติดต่อ: ${updatedState.contact_name} (โทร ${updatedState.contact_phone})\n` +
      `- ผู้ชำระเงิน: ${updatedState.payer_name}\n` +
      `- จุดจัดส่ง: ${finalAddress}\n` +
      `- แหล่งผลิต/บ่อวัสดุ: ${matchedPitName} (ระยะจริง ${targetDistance} กม.)\n\n` +
      `[ตารางประมาณราคาวัสดุ]\n` +
      `1. รายการวัสดุ: ${resolvedMatName}\n` +
      `   - ปริมาณ: ${quantity} คิว\n` +
      `   - อัตราค่าวัสดุ: ${materialBasePrice} บาท/คิว\n` +
      `   - ยอดรวมค่าวัสดุ: ${materialCost.toLocaleString()} บาท\n` +
      `2. รายการบริการจัดส่ง (จำนวน ${trips} เที่ยวด้วย${vehicleThaiLabels[updatedState.vehicle_type!]}):\n` +
      `   - อัตราค่าบริการ: ${transportCostPerTrip.toLocaleString()} บาท/เที่ยว\n` +
      `   - ยอดรวมค่าขนส่ง: ${totalTransportCost.toLocaleString()} บาท\n` +
      `-----------------------------------------\n` +
      `💰 ยอดรวมสุทธิประมาณราคาทั้งสิ้น: ${totalPrice.toLocaleString()} บาท\n` +
      `📝 เลขอ้างอิงใบร่างระบบ: ${draft.id}\n` +
      `-----------------------------------------\n` +
      `ข้อมูลนี้ได้ถูกบันทึกเข้าระบบเป็นใบร่าง BOQ เรียบร้อยแล้วครับ และส่งแจ้งเตือนผู้บริหารเพื่ออนุมัติเงื่อนไขในระบบเรียบร้อยแล้วครับ สะดวกให้เข้าจัดส่งในช่วงวันไหนดีครับ?`

    const notifyMsg = `\n📢 [AI Quote Request] ลูกค้าขอใบเสนอราคาใหม่ผ่านไลน์\n` +
      `🔹 โครงการ: ${updatedState.project_name}\n` +
      `🔹 ผู้ติดต่อ: ${updatedState.contact_name} (${updatedState.contact_phone})\n` +
      `🔹 ยอดเสนอประเมิน: ${totalPrice.toLocaleString()} บาท\n` +
      `🔗 อนุมัติเอกสารคลิก: https://tmxkiripdvorrcnuezvm.supabase.co/dashboard/drafts/${draft.id}`

    await sendLineNotify(notifyMsg)
  }

  // Ask Gemini if possible to format or customize conversation part
  let replyText = boqText
  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (apiKey) {
    traceLogs?.push({ step: 'gemini_agent', status: 'PENDING', timestamp: new Date().toISOString() })
    const geminiReply = await askGeminiAgent(routingText, history, contextData)
    if (geminiReply) {
      traceLogs?.push({ step: 'gemini_agent', status: 'SUCCESS', timestamp: new Date().toISOString() })
      // Strip any [CREATE_DRAFT] tag if Gemini generated it to prevent double draft handling
      let cleanGemini = geminiReply.replace(/\[CREATE_DRAFT:\s*({.+?})\]/, '').trim()
      replyText = cleanGemini.length > 0 ? `${cleanGemini}\n\n${boqText}` : boqText
    } else {
      traceLogs?.push({ step: 'gemini_agent', status: 'FAILED', reason: 'Gemini Agent returned null', timestamp: new Date().toISOString() })
    }
  }

  traceLogs?.push({ step: 'reply_dispatched', status: 'SUCCESS', data: { text: replyText }, timestamp: new Date().toISOString() })
  if (traceLogs) {
    await supabase.from('line_events').update({
      admin_note: JSON.stringify({ trace_log: traceLogs })
    }).eq('id', eventId)
  }
  await replyToLine(replyToken, replyText || "")
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let body
    try {
      body = await req.json()
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    console.log('Received LINE webhook payload:', JSON.stringify(body))

    const events = body.events || []
    if (!Array.isArray(events)) {
      return new Response(JSON.stringify({ error: 'Invalid events format' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing environment variables: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
      return new Response(JSON.stringify({ error: 'Internal server configuration error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    for (const event of events) {
      const lineUserId = event.source?.userId
      if (!lineUserId) continue

      // --- 1. HANDLE LOCATION MESSAGES ---
      if (event.type === 'message' && event.message && event.message.type === 'location') {
        const address = event.message.address || event.message.title || 'พิกัดหน้างานที่ส่งมา'
        const latitude = event.message.latitude
        const longitude = event.message.longitude
        const messageId = event.message.id
        const replyToken = event.replyToken

        // Log location event in database
        const { data: dbEvent, error: insertError } = await supabase
          .from('line_events')
          .insert({
            line_user_id: lineUserId,
            raw_text: address,
            line_message_id: messageId || null,
            raw_type: 'location',
            status: 'new',
            extracted: { latitude, longitude }
          })
          .select()
          .single()

        if (insertError) {
          console.error('Failed to log location event:', insertError)
          continue
        }

        const traceLogs: any[] = [
          { step: 'receive_location', status: 'SUCCESS', timestamp: new Date().toISOString() }
        ]

        // Retrieve and initialize conversation state
        const state = await getOrInitState(lineUserId, supabase)
        traceLogs.push({ step: 'get_state', status: 'SUCCESS', timestamp: new Date().toISOString() })

        const locationObj = {
          lat: latitude,
          lng: longitude,
          address: address
        }

        // Save extracted entities to registry
        await saveEntitiesToRegistry(lineUserId, dbEvent.id, { destination_location: locationObj, destination_text: address }, supabase)
        traceLogs.push({ step: 'save_registry', status: 'SUCCESS', timestamp: new Date().toISOString() })

        // Persist updated conversation state
        await updateConversationState(lineUserId, { destination_location: locationObj, destination_text: address }, supabase)
        traceLogs.push({ step: 'save_state', status: 'SUCCESS', timestamp: new Date().toISOString() })

        const updatedState = {
          ...state,
          destination_location: locationObj,
          destination_text: address
        }

        // Execute validation to check if the transaction is now complete (Resume Workflow)
        const validation = await executeBusinessValidation(updatedState, supabase)
        if (validation.isValid && (updatedState.current_intent === 'PRICE_REQUEST' || updatedState.current_intent === 'CONCRETE_REQUEST')) {
          traceLogs.push({ step: 'validation', status: 'SUCCESS', timestamp: new Date().toISOString() })
          console.log("State is complete after Location Share. Resuming quotation workflow.")
          await processQuotation(supabase, lineUserId, dbEvent.id, replyToken, updatedState, `ส่ง${address}`, traceLogs)
          continue
        }

        // Search the nearest pit in the database (filtered by material if present in state)
        let query = supabase
          .from('pit_profiles')
          .select('id, pit_name, address, latitude, longitude')
          .not('latitude', 'is', null)
          .not('longitude', 'is', null)

        if (state.material) {
          const cleanedMaterial = state.material.replace(/\s+/g, '')
          const { data: matType } = await supabase
            .from('material_types')
            .select('id')
            .ilike('name', `%${cleanedMaterial}%`)
            .limit(1)
            .maybeSingle()

          if (matType) {
            const { data: pitMats } = await supabase
              .from('pit_materials')
              .select('pit_profile_id')
              .eq('material_type_id', matType.id)

            if (pitMats && pitMats.length > 0) {
              const matchedIds = pitMats.map((pm: any) => pm.pit_profile_id)
              query = query.in('id', matchedIds)
            }
          }
        }

        const { data: pits } = await query

        let nearestPit: any = null
        let minDistance = 15.0

        if (pits && pits.length > 0) {
          let currentMin = Infinity
          pits.forEach((pit: any) => {
            const d = calculateDistance(latitude, longitude, parseFloat(pit.latitude), parseFloat(pit.longitude))
            if (d < currentMin) {
              currentMin = d
              nearestPit = pit
            }
          })
          if (currentMin !== Infinity) {
            minDistance = parseFloat(currentMin.toFixed(2))
          }
        }

        const pitName = nearestPit ? nearestPit.pit_name : 'บ่อวัสดุก่อสร้างในเครือ'
        const distanceStr = minDistance.toFixed(2)

        const replyMsg = `ระบบทำการบันทึกพิกัดโครงการจัดส่งเรียบร้อยแล้วครับ\n` +
          `📍 จุดจัดส่ง: ${address}\n` +
          `🚛 ตรวจพบแหล่งผลิตใกล้ที่สุด: ${pitName} (ระยะทางขนส่งจัดทำราคาจริงอยู่ที่ ${distanceStr} กม.)\n\n` +
          `ท่านสามารถระบุวัสดุและจำนวนที่ต้องการ (เช่น ทรายถม 200 คิว หรือ ดินถม 100 คิว) เพื่อจัดทำร่างเอกสารประมาณราคาเสนอผู้บริหารได้ทันทีครับ`

        traceLogs.push({ step: 'location_fallback_nearest_pit', status: 'SUCCESS', data: { pit_name: pitName, distance: minDistance }, timestamp: new Date().toISOString() })
        await supabase.from('line_events').update({
          admin_note: JSON.stringify({ trace_log: traceLogs })
        }).eq('id', dbEvent.id)

        await replyToLine(replyToken, replyMsg)
        continue
      }

      // --- 2. HANDLE TEXT MESSAGES ---
      if (event.type === 'message' && event.message && event.message.type === 'text') {
        const text = (event.message.text || '').trim()
        const messageId = event.message.id
        const replyToken = event.replyToken

        // Log incoming message first
        const { data: dbEvent, error: insertError } = await supabase
          .from('line_events')
          .insert({
            line_user_id: lineUserId,
            raw_text: text,
            line_message_id: messageId || null,
            raw_type: 'text',
            status: 'new'
          })
          .select()
          .single()

        if (insertError) {
          console.error('Failed to log text event:', insertError)
          continue
        }

        const traceLogs: any[] = [
          { step: 'receive_text', status: 'SUCCESS', timestamp: new Date().toISOString() }
        ]

        // Retrieve and initialize conversation state
        const state = await getOrInitState(lineUserId, supabase)
        traceLogs.push({ step: 'get_state', status: 'SUCCESS', timestamp: new Date().toISOString() })

        // Extract entities and intent
        const { intent: detectedIntent, entities: extracted } = extractEntities(text, state.current_intent)

        // Merge state updates
        const stateUpdates: any = {
          current_intent: detectedIntent,
          ...extracted
        }

        // Decoupling: If user typed a new destination_text in this message, we must invalidate destination_location coordinates
        if (extracted.destination_text && state.destination_text !== extracted.destination_text) {
          stateUpdates.destination_location = null
        }

        const updatedState = {
          ...state,
          ...stateUpdates
        }

        // Save extracted entities to registry
        if (Object.keys(extracted).length > 0) {
          await saveEntitiesToRegistry(lineUserId, dbEvent.id, extracted, supabase)
          traceLogs.push({ step: 'save_registry', status: 'SUCCESS', timestamp: new Date().toISOString() })
        }

        // Persist updated conversation state
        await updateConversationState(lineUserId, stateUpdates, supabase)
        traceLogs.push({ step: 'save_state', status: 'SUCCESS', timestamp: new Date().toISOString() })

        // Execute Business Validation Middleware
        const validation = await executeBusinessValidation(updatedState, supabase)
        if (!validation.isValid) {
          traceLogs.push({ step: 'validation', status: 'BLOCKED', reason: validation.message, timestamp: new Date().toISOString() })
          await supabase.from('line_events').update({
            admin_note: JSON.stringify({ trace_log: traceLogs })
          }).eq('id', dbEvent.id)
          await replyToLine(replyToken, validation.message)
          continue
        }

        traceLogs.push({ step: 'validation', status: 'SUCCESS', timestamp: new Date().toISOString() })

        // Delegate quotation processing to helper function
        await processQuotation(supabase, lineUserId, dbEvent.id, replyToken, updatedState, text, traceLogs)
      }
    }

    return new Response(JSON.stringify({ status: 'ok' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error: any) {
    console.error('Unhandled server error:', error)
    return new Response(JSON.stringify({ error: (error as any).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

