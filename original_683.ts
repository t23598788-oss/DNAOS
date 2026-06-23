import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4"

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

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
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

        // Search the nearest pit in the database
        const { data: pits } = await supabase
          .from('pit_profiles')
          .select('id, pit_name, address, latitude, longitude')
          .not('latitude', 'is', null)
          .not('longitude', 'is', null)

        let nearestPit = null
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

        // D. Load Last Shared Location Coordinates
        const { data: lastLocation } = await supabase
          .from('line_events')
          .select('raw_text, extracted')
          .eq('line_user_id', lineUserId)
          .eq('raw_type', 'location')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        // E. Load Last Created Draft Document details
        const { data: lastDraft } = await supabase
          .from('line_draft_documents')
          .select('id, payload, status')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        // F. Retrieve last few chat history events (to prevent repeating greetings)
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
          lastLocation: lastLocation ? {
            address: lastLocation.raw_text,
            lat: lastLocation.extracted?.latitude,
            lng: lastLocation.extracted?.longitude
          } : null,
          lastDraft: lastDraft ? {
            id: lastDraft.id,
            payload: lastDraft.payload,
            status: lastDraft.status
          } : null
        }

        // Ask Gemini Sales Agent
        let replyText = await askGeminiAgent(text, history, contextData)

        // G. FALLBACK ROUTER (If Gemini is not enabled, or fails to fetch)
        if (!replyText || replyText.startsWith("ขออภัยครับ ระบบไม่สามารถเรียกใช้งานสมอง AI")) {
          console.log("No Gemini API key or error. Falling back to native TS dialogue router.")
          
          if (text === 'เช็คคิว' || text === 'คิว' || text.toLowerCase() === 'queue') {
            // --- DRIVER QUEUE FALLBACK ---
            let queueMsg = '🚛 รายชื่อคิวคนขับรถล่าสุด:\n'
            if (!drivers || drivers.length === 0) {
              queueMsg += '- ไม่มีข้อมูลคนขับรถในระบบในขณะนี้ครับ'
            } else {
              drivers.forEach((driver: any, index: number) => {
                const activeAssignment = driver.job_assignments?.find((a: any) =>
                  a.assignment_status === 'ACCEPTED' || a.assignment_status === 'IN_PROGRESS'
                )
                const plate = `${driver.vehicle_plate_code || ''} ${driver.vehicle_plate_text || ''} ${driver.vehicle_plate_province || ''}`.trim()
                if (activeAssignment) {
                  queueMsg += `${index + 1}. พี่${driver.driver_name} (ทะเบียน ${plate}) - 🔴 กำลังส่งสินค้าหน้างาน: ${activeAssignment.jobs?.project_name || 'ไม่ระบุ'}\n`
                } else {
                  queueMsg += `${index + 1}. พี่${driver.driver_name} (ทะเบียน ${plate}) - 🟢 ว่างพร้อมปฏิบัติงานครับ\n`
                }
              })
            }
            replyText = `${queueMsg.trim()}\n\nหากต้องการจองคิวรถจัดส่ง หรือต้องการเตรียมส่งวันไหน แจ้งผมได้เลยครับ!`

          } else if (text.includes('กี่กิโล') || text.includes('ระยะทาง') || text.includes('กิโลเมตร') || text.includes('ระยะขนส่ง')) {
            // --- LOGISTICS DISTANCE FALLBACK ---
            replyText = `ระยะทางจัดส่งประเมินเบื้องต้นจะคิดที่ประมาณ ${defaultDistance} กิโลเมตรจากบ่อวัสดุที่ใกล้ที่สุดครับ ทั้งนี้ เพื่อความแม่นยำสูงสุดในการคิดค่าจัดส่ง ท่านสามารถกดส่งพิกัดสถานที่ (Location Share) เข้ามาได้เลยนะครับ เดี๋ยวผมจะคำนวณราคาขนส่งจากพิกัดจริงให้ทันทีครับ`

          } else if (text.includes('เครื่องจักร') || text.includes('เช่า') || text.includes('รถแม็คโคร') || text.includes('รถขุด')) {
            // --- MACHINERY FALLBACK ---
            replyText = `เรามีบริการให้เช่าเครื่องจักรหน้างานแบบครบวงจรเลยครับ ทั้งรถขุดแม็คโคร U-55 และเครื่องจักรระบบอื่น ๆ คิดอัตราโปร่งใสตามชั่วโมงทำงานจริงครับ หากท่านสนใจเช่าใช้งานวันไหน แจ้งข้อมูลเบื้องต้นให้ผมประสานงานลงจองคิวรถให้ได้เลยนะครับ`

          } else if (text.includes('ส่งได้ไหม') || text.includes('ส่งพรุ่งนี้') || text.includes('ส่งวันไหน')) {
            // --- DELIVERY DATE INQUIRY FALLBACK ---
            replyText = `คิวรถจัดส่งของเรามีรอบพร้อมวิ่งงานจัดส่งให้ท่านได้ทันทีครับ หากเป็นการขอใบเสนอราคา BOQ ที่ร่างในระบบเรียบร้อยแล้ว ท่านสามารถแจ้งยืนยันช่วงเวลาที่ต้องการให้ทยอยเข้าจัดส่งได้เลยนะครับ เดี๋ยวประสานลงตารางคิวให้ทันทีครับ`

          } else if (text.includes('รวมค่าขนส่ง') || text.includes('พร้อมขนส่ง') || text.includes('รวมส่ง')) {
            // --- SHIPPING INCLUSION FALLBACK ---
            if (lastDraft) {
              const hasTransport = lastDraft.payload?.items?.some((i: any) => i.description.includes('ขนส่ง') || i.description.includes('เที่ยว'))
              if (hasTransport) {
                replyText = `ราคาประเมินรวมประมาณการสุทธิ ${lastDraft.payload.net_amount.toLocaleString()} บาท (ตามใบร่างอ้างอิง: ${lastDraft.id}) นั้น **รวมค่าบริการขนส่งเรียบร้อยแล้วครับ**`
              } else {
                replyText = `สำหรับใบร่างเอกสารเสนอราคาล่าสุด ยอดที่แสดงอาจจะยังเป็นเฉพาะค่าวัสดุครับ ท่านต้องการให้ผมคำนวณบวกค่าขนส่งรวมไปด้วยเลยไหมครับ? รบกวนส่งพิกัดจัดส่งเข้ามาในแชทนี้ได้เลยครับ`
              }
            } else {
              replyText = `โดยปกติการเสนอราคารวมส่งจะคำนวณจากระยะทางพิกัดหน้างานจริงไปยังบ่อทรายที่ใกล้ที่สุดครับ ท่านสามารถส่งพิกัดจัดส่งเข้ามาเพื่อให้ผมร่างใบเสนอราคา BOQ รวมค่าจัดส่งที่ถูกต้องที่สุดให้ท่านได้ทันทีครับ`
            }

          } else if (text.startsWith('ขอราคา') || text.includes('ราคา') || text.includes('เสนอราคา') || text.includes('เท่าไหร่') || text.includes('เท่าไร')) {
            // --- DYNAMIC QUOTATION FALLBACK ---
            const materialRegex = /(ดินถม|ดินลูกรัง|ทรายหยาบ|ทรายละเอียด|ทรายถม|ทราย|หินเกล็ด|หินคลุก|หิน 3\/4|หิน 3\/2|หิน|คอนกรีตสำเร็จรูป|เหล็กข้ออ้อย|เหล็กเส้น)/i
            const matMatch = text.match(materialRegex)

            if (!matMatch) {
              replyText = `ยินดีครับ! เพื่อความถูกต้องในการดึงราคากลางบ่อทราย รบกวนแจ้งชนิดวัสดุที่ต้องการใช้งาน (เช่น ดินถม, หินคลุก, หิน 3/4, ทรายหยาบ) และจำนวนที่ต้องการมาได้เลยนะครับ`
            } else {
              let materialInput = matMatch[1]
              if (materialInput === 'ทราย' || materialInput === 'ทรายถม') materialInput = 'ทรายหยาบ'
              if (materialInput === 'หิน') materialInput = 'หินคลุก'

              // Clean message of material and fractions
              let textForQty = text.replace(materialInput, '')
              textForQty = textForQty.replace(/\d+\/\d+/g, '')

              let quantity = 0
              const qtyWithUnitMatch = textForQty.match(/(\d+(?:\.\d+)?)\s*(?:คิว|ตัน|เที่ยว|ถุง|เส้น|ตัว|แผ่น|รายการ)/i)
              if (qtyWithUnitMatch) {
                quantity = parseFloat(qtyWithUnitMatch[1])
              } else {
                const qtyMatch = textForQty.match(/(\d+(?:\.\d+)?)/)
                if (qtyMatch) {
                  quantity = parseFloat(qtyMatch[1])
                }
              }

              // Search material in DB
              const { data: matType } = await supabase
                .from('material_types')
                .select('id, name')
                .ilike('name', `%${materialInput}%`)
                .limit(1)
                .maybeSingle()

              if (!matType) {
                replyText = `ขออภัยครับ ตอนนี้ยังค้นหาข้อมูลราคาของ "${materialInput}" ไม่พบในตารางระบบ รบกวนระบุเป็นวัสดุหลัก เช่น ดินถม, ทรายหยาบ, หรือหินคลุก ครับ`
              } else {
                // Get price
                const { data: pitMat } = await supabase
                  .from('pit_materials')
                  .select('price, pit_profile_id')
                  .eq('material_type_id', matType.id)
                  .order('price', { ascending: true })
                  .limit(1)
                  .maybeSingle()

                let materialBasePrice = 120.00
                if (pitMat) {
                  materialBasePrice = parseFloat(pitMat.price)
                }

                if (quantity <= 0) {
                  replyText = `สำหรับ ${matType.name} ตอนนี้ราคาหน้าบ่อวัสดุเริ่มต้นจะอยู่ที่ประมาณ ${materialBasePrice} บาทต่อคิวครับ หากต้องการราคารวมจัดส่ง รบกวนแจ้งปริมาณที่ต้องการใช้ (คิว/เที่ยว) หรือส่งพิกัดจัดส่งเข้ามาในแชทนี้ได้เลยนะครับ เดี๋ยวผมคิดราคาพิเศษรวมส่งให้ทันทีครับ!`
                } else {
                  // Resolve distance
                  let targetDistance = defaultDistance
                  let finalAddress = 'จุดจัดส่งประเมินเริ่มต้น'
                  let matchedPitName = 'บ่อวัสดุในระบบ'

                  if (lastLocation && lastLocation.extracted) {
                    const userLat = parseFloat(lastLocation.extracted.latitude)
                    const userLng = parseFloat(lastLocation.extracted.longitude)
                    finalAddress = lastLocation.raw_text

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

                  // Determine vehicle capacity from keywords
                  let matchedCapacity = capacityPerTrip
                  if (text.includes('พ่วง') || text.includes('รถพ่วง')) {
                    matchedCapacity = 30.00
                  } else if (text.includes('หกล้อ') || text.includes('6 ล้อ')) {
                    matchedCapacity = 5.00
                  }

                  const trips = Math.ceil(quantity / matchedCapacity)
                  const transportCostPerTrip = (targetDistance * fuelPrice) + driverWage
                  const totalTransportCost = trips * transportCostPerTrip
                  const materialCost = quantity * materialBasePrice

                  const totalCost = materialCost + totalTransportCost
                  const markupMargin = totalCost * (markupPercent / 100)
                  const totalPrice = totalCost + markupMargin

                  // Create draft
                  const draftPayload = {
                    document_type: 'invoice',
                    party_name: `โครงการ LINE ID: ${lineUserId.substring(0, 10)}...`,
                    discount_amount: 0,
                    vat_enabled: false,
                    withholding_tax_percent: 0,
                    subtotal_amount: parseFloat(totalCost.toFixed(2)),
                    markup_margin: parseFloat(markupMargin.toFixed(2)),
                    gross_amount: parseFloat(totalPrice.toFixed(2)),
                    net_amount: parseFloat(totalPrice.toFixed(2)),
                    items: [
                      {
                        description: `ค่าวัสดุ ${matType.name}`,
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
                      event_id: dbEvent.id,
                      doc_type: 'invoice',
                      payload: draftPayload,
                      status: 'pending'
                    })
                    .select()
                    .single()

                  if (draft) {
                    replyText = `📋 ร่างรายการประมาณราคาจัดหาและขนส่งวัสดุ (BOQ Draft)\n` +
                      `-----------------------------------------\n` +
                      `[รายละเอียดข้อมูลโครงการจัดส่ง]\n` +
                      `- จุดจัดส่ง: ${finalAddress}\n` +
                      `- แหล่งผลิต/บ่อวัสดุ: ${matchedPitName} (ระยะจริง ${targetDistance} กม.)\n\n` +
                      `[ตารางประมาณราคาวัสดุ]\n` +
                      `1. รายการวัสดุ: ${matType.name}\n` +
                      `   - ปริมาณ: ${quantity} คิว\n` +
                      `   - อัตราค่าวัสดุ: ${materialBasePrice} บาท/คิว\n` +
                      `   - ยอดรวมค่าวัสดุ: ${materialCost.toLocaleString()} บาท\n` +
                      `2. รายการบริการจัดส่ง (จำนวน ${trips} เที่ยว):\n` +
                      `   - อัตราค่าบริการ: ${transportCostPerTrip.toLocaleString()} บาท/เที่ยว\n` +
                      `   - ยอดรวมค่าขนส่ง: ${totalTransportCost.toLocaleString()} บาท\n` +
                      `-----------------------------------------\n` +
                      `💰 ยอดรวมสุทธิประมาณราคาทั้งสิ้น: ${totalPrice.toLocaleString()} บาท\n` +
                      `📝 เลขอ้างอิงใบร่างระบบ: ${draft.id}\n` +
                      `-----------------------------------------\n` +
                      `ข้อมูลนี้ได้ถูกส่งจัดส่งเสนอผู้บริหารเพื่อพิจารณาอนุมัติเงื่อนไขพิเศษเรียบร้อยแล้วครับ สะดวกให้ประสานจองคิวรถจัดส่งในวันพรุ่งนี้หรือวันไหนดีครับ?`

                    const notifyMsg = `\n📢 [AI Quote Request] ลูกค้าขอใบเสนอราคาใหม่ผ่านไลน์\n` +
                      `🔹 วัสดุ: ${matType.name}\n` +
                      `🔹 จำนวน: ${quantity} คิว\n` +
                      `🔹 ราคาเสนอประเมิน: ${totalPrice.toLocaleString()} บาท\n` +
                      `🔗 อนุมัติเอกสารคลิก: https://tmxkiripdvorrcnuezvm.supabase.co/dashboard/drafts/${draft.id}`

                    await sendLineNotify(notifyMsg)
                  }
                }
              }
            }
          } else {
            // --- GENERAL GREETING FALLBACK ---
            replyText = `สวัสดีครับ ยินดีให้บริการครับ! 😊 ผมเป็นผู้ช่วยดูแลระบบจัดจัดหาและจัดส่งวัสดุก่อสร้างโครงการต่าง ๆ ครับ\n\nท่านสามารถพิมพ์สอบถามความต้องการได้ทันทีเลยนะครับ เช่น:\n- ประเมินราคารวมส่ง: พิมพ์ เช่น "ขอราคา ทรายถม 200 คิว รถพ่วง"\n- ตรวจสอบคิวรถวิ่งงานในวันนี้: พิมพ์ "เช็คคิว"\n- สอบถามข้อมูลระยะขนส่ง หรือส่งพิกัดแชร์ตำแหน่งเข้ามาเพื่อวัดระยะได้ทันทีครับ!`
          }
        } else {
          // If Gemini was used, check if it generated a draft command in its text
          const draftMatch = replyText.match(/\[CREATE_DRAFT:\s*({.+?})\]/)
          if (draftMatch) {
            try {
              const draftParams = JSON.parse(draftMatch[1])
              const { material, qty } = draftParams

              if (material && qty) {
                const qtyNum = parseFloat(qty)
                const { data: dbMat } = await supabase
                  .from('material_types')
                  .select('id, name')
                  .ilike('name', `%${material}%`)
                  .limit(1)
                  .maybeSingle()

                let resolvedMatName = material
                let resolvedMatId = null
                let materialBasePrice = 120.00

                if (dbMat) {
                  resolvedMatName = dbMat.name
                  resolvedMatId = dbMat.id
                  const { data: pitMat } = await supabase
                    .from('pit_materials')
                    .select('price, pit_profile_id')
                    .eq('material_type_id', resolvedMatId)
                    .order('price', { ascending: true })
                    .limit(1)
                    .maybeSingle()

                  if (pitMat) {
                    materialBasePrice = parseFloat(pitMat.price)
                  }
                }

                let distance = defaultDistance
                let matchedPitName = 'บ่อวัสดุในระบบ'

                if (lastLocation && lastLocation.extracted) {
                  const userLat = parseFloat(lastLocation.extracted.latitude)
                  const userLng = parseFloat(lastLocation.extracted.longitude)
                  
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
                      distance = parseFloat(currentMin.toFixed(2))
                    }
                  }
                }

                let matchedCapacity = capacityPerTrip
                if (text.includes('พ่วง') || text.includes('รถพ่วง')) {
                  matchedCapacity = 30.00
                } else if (text.includes('หกล้อ') || text.includes('6 ล้อ')) {
                  matchedCapacity = 5.00
                }

                const trips = Math.ceil(qtyNum / matchedCapacity)
                const transportCostPerTrip = (distance * fuelPrice) + driverWage
                const totalTransportCost = trips * transportCostPerTrip
                const materialCost = qtyNum * materialBasePrice

                const totalCost = materialCost + totalTransportCost
                const markupMargin = totalCost * (markupPercent / 100)
                const totalPrice = totalCost + markupMargin

                const draftPayload = {
                  document_type: 'invoice',
                  party_name: `โครงการ LINE ID: ${lineUserId.substring(0, 10)}...`,
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
                      qty: qtyNum,
                      unit_label: 'คิว',
                      unit_price: materialBasePrice,
                      line_total: materialCost
                    },
                    {
                      description: `ค่าบริการขนส่ง (ระยะจริง ${distance} กม. จำนวน ${trips} เที่ยวด้วยรถคันละ ${matchedCapacity} คิว)`,
                      qty: trips,
                      unit_label: 'เที่ยว',
                      unit_price: parseFloat(transportCostPerTrip.toFixed(2)),
                      line_total: totalTransportCost
                    }
                  ]
                }

                const { data: newDraft } = await supabase
                  .from('line_draft_documents')
                  .insert({
                    event_id: dbEvent.id,
                    doc_type: 'invoice',
                    payload: draftPayload,
                    status: 'pending'
                  })
                  .select()
                  .single()

                if (newDraft) {
                  const boqText = `📋 ร่างรายการประมาณราคาจัดหาและขนส่งวัสดุ (BOQ Draft)\n` +
                    `-----------------------------------------\n` +
                    `[รายละเอียดข้อมูลโครงการจัดส่ง]\n` +
                    `- จุดจัดส่ง: ${lastLocation ? lastLocation.raw_text : 'จุดจัดส่งประเมินเริ่มต้น'}\n` +
                    `- แหล่งผลิต/บ่อวัสดุ: ${matchedPitName} (ระยะจริง ${distance} กม.)\n\n` +
                    `[ตารางประมาณราคาวัสดุ]\n` +
                    `1. รายการวัสดุ: ${resolvedMatName}\n` +
                    `   - ปริมาณ: ${qtyNum} คิว\n` +
                    `   - อัตราค่าวัสดุ: ${materialBasePrice} บาท/คิว\n` +
                    `   - ยอดรวมค่าวัสดุ: ${materialCost.toLocaleString()} บาท\n` +
                    `2. รายการบริการจัดส่ง (จำนวน ${trips} เที่ยว):\n` +
                    `   - อัตราค่าบริการ: ${transportCostPerTrip.toLocaleString()} บาท/เที่ยว\n` +
                    `   - ยอดรวมค่าขนส่ง: ${totalTransportCost.toLocaleString()} บาท\n` +
                    `-----------------------------------------\n` +
                    `💰 ยอดรวมสุทธิประมาณราคาทั้งสิ้น: ${totalPrice.toLocaleString()} บาท\n` +
                    `📝 เลขอ้างอิงใบร่างระบบ: ${newDraft.id}\n` +
                    `-----------------------------------------\n` +
                    `ข้อมูลนี้ได้ถูกส่งจัดส่งเสนอผู้บริหารเพื่อพิจารณาอนุมัติเงื่อนไขพิเศษในระบบแล้วครับ สะดวกให้จองคิวรถจัดส่งในวันพรุ่งนี้หรือช่วงวันไหนดีครับ?`

                  replyText = replyText.replace(/\[CREATE_DRAFT:\s*({.+?})\]/, '').trim()
                  if (replyText.length > 0) {
                    replyText = `${replyText}\n\n${boqText}`
                  } else {
                    replyText = boqText
                  }

                  const notifyMsg = `\n📢 [AI Quote Request] ลูกค้าขอใบเสนอราคาใหม่ผ่านไลน์\n` +
                    `🔹 วัสดุ: ${resolvedMatName}\n` +
                    `🔹 จำนวน: ${qtyNum} คิว\n` +
                    `🔹 ราคาเสนอประเมิน: ${totalPrice.toLocaleString()} บาท\n` +
                    `🔗 อนุมัติเอกสารคลิก: https://tmxkiripdvorrcnuezvm.supabase.co/dashboard/drafts/${newDraft.id}`

                  await sendLineNotify(notifyMsg)
                }
              }
            } catch (err) {
              console.error('Failed to parse or create draft from Gemini trigger:', err)
            }
          }
        }

        // Send final response to the user
        await replyToLine(replyToken, replyText)
      }
    }

    return new Response(JSON.stringify({ status: 'ok' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    console.error('Unhandled server error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

