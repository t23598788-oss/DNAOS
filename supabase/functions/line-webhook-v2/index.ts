import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4"
import { 
  getOrInitState, 
  updateConversationState, 
  extractEntities, 
  saveEntitiesToRegistry, 
  executeBusinessValidation,
  checkBusinessQualification,
  extractStructuredEntitiesWithGemini,
  resolveAddressToCoordinates
} from "./helpers.ts"
import { ResponseGateway } from "./engines/response.ts"
import { haversine as calculateDistance } from "../_shared/haversine.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
  const qualification = checkBusinessQualification(updatedState)
  
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
    drivers.forEach((driver: any) => {
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
  
  // Apply 15 km minimum distance cap for small orders (quantity < 10 or vehicle_type === '6_wheeler')
  const isSmallOrder = quantity < 10 || updatedState.vehicle_type === '6_wheeler'
  const effectiveDistance = isSmallOrder && targetDistance < 15 ? 15 : targetDistance
  const transportCostPerTrip = (effectiveDistance * fuelPrice) + driverWage

  const vehicleThaiLabels: Record<string, string> = {
    '6_wheeler': 'รถหกล้อ',
    '10_wheeler': 'รถสิบล้อ',
    'trailer': 'รถพ่วง'
  }

  // CASE 1: UNQUALIFIED STATE (Missing level 2 fields) -> Reply with preliminary price ONLY. DO NOT create BOQ.
  if (!qualification.isQualified) {
    const missingThai = qualification.missingFields.map((f: string) => qualification.thaiFieldNames[f] || f)
    const missingListText = missingThai.map((f: string) => `- ${f}`).join('\n')

    const rawPricing = {
      configs: { markupPercent },
      materialBasePrice,
      transportCostPerTrip,
      quantity,
      vehicle_type: updatedState.vehicle_type,
      resolvedMatName,
      targetDistance,
      matchedPitName
    }

    traceLogs?.push({ step: 'quotation', status: 'BLOCKED', reason: 'Missing Level 2 Business Qualification fields', timestamp: new Date().toISOString() })
    if (traceLogs) {
      await supabase.from('line_events').update({
        admin_note: JSON.stringify({ trace_log: traceLogs })
      }).eq('id', eventId)
    }

    await ResponseGateway.dispatchResponse(replyToken, {
      type: 'PRELIMINARY_PRICING',
      rawPricing,
      missingFieldsText: missingListText
    }, 'CUSTOMER_LINE')
    return
  }

  // CASE 2: QUALIFIED STATE -> Create match queue item and notify pit owner
  const { data: matchResult, error: matchError } = await supabase.rpc('create_match', {
    customer_line_id: lineUserId,
    material: resolvedMatName,
    quantity: quantity,
    cust_lat: updatedState.destination_location.lat,
    cust_lng: updatedState.destination_location.lng
  })

  if (matchError || (matchResult && matchResult.status === 'error')) {
    console.error('Failed to create match:', matchError || matchResult)
    traceLogs?.push({ step: 'create_match', status: 'FAILED', reason: matchError?.message || matchResult?.message, timestamp: new Date().toISOString() })
    await ResponseGateway.dispatchResponse(replyToken, {
      type: 'VALIDATION_ERROR',
      message: `ขออภัยครับ ระบบจับคู่ขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง หรือติดต่อผู้ดูแลระบบครับ`
    }, 'CUSTOMER_LINE')
    return
  }

  traceLogs?.push({ step: 'create_match', status: 'SUCCESS', data: { match_id: matchResult.match_id }, timestamp: new Date().toISOString() })
  await updateConversationState(lineUserId, { status: 'COMPLETED' }, supabase)

  // Get matched pit details including pit owner's line_user_id
  const { data: queueData } = await supabase
    .from('match_queue')
    .select('id, pit_id, pit_profiles(pit_name, line_user_id)')
    .eq('id', matchResult.match_id)
    .single()

  const matchedPit = queueData?.pit_profiles as any
  const ownerLineId = matchedPit?.line_user_id

  if (ownerLineId) {
    const ownerMsg = `มีรายการขอซื้อวัสดุใหม่!\n` +
      `บ่อ: ${matchedPit.pit_name}\n` +
      `วัสดุ: ${resolvedMatName} จำนวน ${quantity} คิว\n` +
      `ราคาเสนอขาย (รวมส่ง): ${(matchResult.quoted_price ?? 0).toLocaleString()} บาท\n` +
      `จุดส่ง: ${finalAddress}\n\n` +
      `พิมพ์ 'ยอมรับ ${matchResult.match_id}' เพื่อยืนยันและออกบิล`
    await ResponseGateway.pushMessage(ownerLineId, ownerMsg)
    console.log(`Sent match request notification to pit owner ${ownerLineId} for match ID ${matchResult.match_id}`)
  } else {
    console.warn(`No line_user_id found for pit ${matchedPit?.pit_name || 'unknown'}`)
  }

  // Notify customer
  const customerMsg = `ระบบได้รับการระบุข้อมูลครบถ้วนแล้วครับ กำลังประสานงานตรวจสอบคิวจองกับทางบ่อผลิตและรถขนส่งให้ท่าน\n\n` +
    `รายละเอียดคำขอ:\n` +
    `โครงการ: ${updatedState.project_name || 'ไม่ระบุ'}\n` +
    `วัสดุ: ${resolvedMatName} จำนวน ${quantity} คิว\n` +
    `จุดส่ง: ${finalAddress}\n\n` +
    `ระบบจะจัดส่งเอกสารใบเสนอราคาให้ท่านทันทีที่ได้รับการยืนยันครับ`
  
  await ResponseGateway.dispatchResponse(replyToken, { type: 'VALIDATION_ERROR', message: customerMsg }, 'CUSTOMER_LINE')

  traceLogs?.push({ step: 'reply_dispatched', status: 'SUCCESS', timestamp: new Date().toISOString() })
  if (traceLogs) {
    await supabase.from('line_events').update({
      admin_note: JSON.stringify({ trace_log: traceLogs })
    }).eq('id', eventId)
  }
}

async function handleSilentMatching(
  supabase: any,
  lineUserId: string,
  state: any,
  dbEventId: string,
  traceLogs: any[]
) {
  // If no material is resolved in the state/message, we cannot match
  if (!state.material) {
    traceLogs.push({ step: 'silent_matching', status: 'SKIPPED', reason: 'No material found in state/message', timestamp: new Date().toISOString() });
    await supabase.from('line_events').update({
      admin_note: JSON.stringify({ trace_log: traceLogs })
    }).eq('id', dbEventId);
    return;
  }

  // Check if we have coordinates. If we have destination_text but no coordinates, try to resolve via Gemini
  let lat = state.destination_location?.lat;
  let lng = state.destination_location?.lng;
  let address = state.destination_location?.address || state.destination_text || 'กรุงเทพมหานคร';

  if ((!lat || !lng) && state.destination_text) {
    console.log(`Resolving coords for typed address: "${state.destination_text}"`);
    const resolvedCoords = await resolveAddressToCoordinates(state.destination_text);
    if (resolvedCoords) {
      lat = resolvedCoords.lat;
      lng = resolvedCoords.lng;
      
      const newLocObj = { lat, lng, address: state.destination_text };
      await updateConversationState(lineUserId, { destination_location: newLocObj }, supabase);
      state.destination_location = newLocObj;
      traceLogs.push({ step: 'resolve_address_coords', status: 'SUCCESS', coords: resolvedCoords, timestamp: new Date().toISOString() });
    }
  }

  // Fallback to Bangkok coordinates if still missing, so we can always run matching
  if (!lat || !lng) {
    lat = 13.7563;
    lng = 100.5018;
    console.log("Using fallback Bangkok coordinates for matching");
  }

  // Match material type in DB
  let materialInput = state.material;
  if (materialInput === 'ทราย' || materialInput === 'ทรายถม') materialInput = 'ทรายหยาบ';
  if (materialInput === 'หิน') materialInput = 'หินคลุก';

  const cleanedMaterial = materialInput.replace(/\s+/g, '');
  const { data: matType } = await supabase
    .from('material_types')
    .select('id, name')
    .ilike('name', `%${cleanedMaterial}%`)
    .limit(1)
    .maybeSingle();

  if (!matType) {
    traceLogs.push({ step: 'silent_matching', status: 'FAILED', reason: `Material type "${state.material}" not found`, timestamp: new Date().toISOString() });
    await supabase.from('line_events').update({
      admin_note: JSON.stringify({ trace_log: traceLogs })
    }).eq('id', dbEventId);
    return;
  }

  const resolvedMatName = matType.name;
  const quantity = state.quantity || 5; // default to 5 (min 6-wheeler) if not specified

  // Run database matching RPC
  console.log(`Executing match for Customer: ${lineUserId}, Material: ${resolvedMatName}, Qty: ${quantity}, Lat: ${lat}, Lng: ${lng}`);
  const { data: matchResult, error: matchError } = await supabase.rpc('create_match', {
    customer_line_id: lineUserId,
    material: resolvedMatName,
    quantity: quantity,
    cust_lat: lat,
    cust_lng: lng
  });

  if (matchError || (matchResult && matchResult.status === 'error')) {
    console.error('Failed to create match in silent mode:', matchError || matchResult);
    traceLogs.push({ step: 'create_match', status: 'FAILED', reason: matchError?.message || matchResult?.message, timestamp: new Date().toISOString() });
    await supabase.from('line_events').update({
      admin_note: JSON.stringify({ trace_log: traceLogs })
    }).eq('id', dbEventId);
    return;
  }

  traceLogs.push({ step: 'create_match', status: 'SUCCESS', data: { match_id: matchResult.match_id }, timestamp: new Date().toISOString() });
  await updateConversationState(lineUserId, { status: 'COMPLETED' }, supabase);

  // Retrieve the matched pit and partner profile
  const { data: queueData } = await supabase
    .from('match_queue')
    .select('id, pit_id, pit_profiles(pit_name, line_user_id, phone)')
    .eq('id', matchResult.match_id)
    .single();

  const matchedPit = queueData?.pit_profiles as any;
  const pitName = matchedPit?.pit_name || 'บ่อวัสดุใกล้เคียง';
  const ownerLineId = matchedPit?.line_user_id;

  // Compile notification message for partner
  const customerName = state.contact_name || 'ลูกค้าโครงการ';
  const customerPhone = state.contact_phone || 'ไม่ระบุ';
  const projectLabel = state.project_name || 'ไม่ระบุ';

  const partnerMsg = `มีรายการขอซื้อวัสดุใหม่!\n` +
    `บ่อ: ${pitName}\n` +
    `วัสดุ: ${resolvedMatName} จำนวน ${quantity} คิว\n` +
    `ราคาเสนอขาย (รวมส่ง): ${(matchResult.quoted_price ?? 0).toLocaleString()} บาท\n` +
    `จุดส่ง: ${address}\n` +
    `ผู้ซื้อ: ${customerName} (${customerPhone})\n` +
    `โครงการ: ${projectLabel}\n\n` +
    `พิมพ์ 'ยอมรับ ${matchResult.match_id}' เพื่อยืนยันและออกบิล`;

  // Direct notifications to partner channels
  let dispatched = false;
  if (ownerLineId) {
    await ResponseGateway.pushMessage(ownerLineId, partnerMsg);
    dispatched = true;
    console.log(`Notified pit owner ${ownerLineId} via LINE`);
  }

  // Simulating Facebook Page / TikTok integration by checking potential partner fields
  const { data: pitPartner } = await supabase
    .from('partners')
    .select('id, name')
    .limit(1)
    .maybeSingle();

  if (pitPartner) {
    const pageId = (pitPartner as any).facebook_page_id;
    const tiktokId = (pitPartner as any).tiktok_user_id;
    if (pageId) {
      await ResponseGateway.pushFacebookMessage(pageId, partnerMsg);
      dispatched = true;
      console.log(`Notified Facebook partner ${pageId}`);
    }
    if (tiktokId) {
      await ResponseGateway.pushTikTokMessage(tiktokId, partnerMsg);
      dispatched = true;
      console.log(`Notified TikTok partner ${tiktokId}`);
    }
  }

  traceLogs.push({ step: 'partner_notified', status: dispatched ? 'SUCCESS' : 'NO_CHANNEL', timestamp: new Date().toISOString() });
  await supabase.from('line_events').update({
    admin_note: JSON.stringify({ trace_log: traceLogs })
  }).eq('id', dbEventId);
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
      const groupId = event.source?.groupId ?? event.source?.roomId ?? null

      // --- 0. GROUP / ROOM MESSAGES — log only, ไม่เข้า pipeline ตอบอัตโนมัติ ---
      // เหตุผล: pipeline ที่มีอยู่ (matching/quotation/reply) ออกแบบมาสำหรับคุยแบบ 1:1
      // การส่งราคา/จับคู่อัตโนมัติเข้ากลุ่มสาธารณะโดยไม่ตั้งใจมีความเสี่ยงทางธุรกิจ
      // จึงบันทึกไว้ให้เห็นข้อมูลก่อน รอออกแบบ workflow เฉพาะกลุ่มภายหลัง
      if (groupId) {
        if (event.type === 'message' && event.message) {
          await supabase.from('line_events').insert({
            line_user_id: lineUserId || null,
            group_id: groupId,
            raw_text: event.message.text ?? event.message.type,
            line_message_id: event.message.id || null,
            raw_type: `group_${event.message.type}`,
            status: 'new',
          })
        }
        continue
      }

      if (!lineUserId) continue

      // --- 1. HANDLE LOCATION MESSAGES ---
      if (event.type === 'message' && event.message && event.message.type === 'location') {
        const address = event.message.address || event.message.title || 'พิกัดหน้างานที่ส่งมา'
        const latitude = event.message.latitude
        const longitude = event.message.longitude
        const messageId = event.message.id

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

        const state = await getOrInitState(lineUserId, supabase)
        traceLogs.push({ step: 'get_state', status: 'SUCCESS', timestamp: new Date().toISOString() })

        const locationObj = {
          lat: latitude,
          lng: longitude,
          address: address
        }

        await saveEntitiesToRegistry(lineUserId, dbEvent.id, { destination_location: locationObj, destination_text: address }, supabase)
        traceLogs.push({ step: 'save_registry', status: 'SUCCESS', timestamp: new Date().toISOString() })

        await updateConversationState(lineUserId, { destination_location: locationObj, destination_text: address }, supabase)
        traceLogs.push({ step: 'save_state', status: 'SUCCESS', timestamp: new Date().toISOString() })

        const updatedState = {
          ...state,
          destination_location: locationObj,
          destination_text: address
        }

        // Silent matching for location share
        await handleSilentMatching(supabase, lineUserId, updatedState, dbEvent.id, traceLogs)
        continue
      }

      // --- 2. HANDLE TEXT MESSAGES ---
      if (event.type === 'message' && event.message && event.message.type === 'text') {
        const text = (event.message.text || '').trim()
        const messageId = event.message.id
        const replyToken = event.replyToken

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

        // Owner accepted match route (KEEP ACTIVE)
        const matchIdRegex = /^ยอมรับ\s+([0-9a-fA-F-]{36})(?:\s+(\d+(?:\.\d+)?))?$/i
        const matchMatch = text.match(matchIdRegex)
        if (matchMatch) {
          const matchId = matchMatch[1]
          const customPrice = matchMatch[2] ? parseFloat(matchMatch[2]) : null
          console.log(`Owner accepted match: ${matchId} with custom price: ${customPrice}`)
          
          const { data: acceptResult, error: acceptError } = await supabase.rpc('owner_accept', { 
            match_id: matchId,
            custom_price: customPrice
          })
          if (acceptError || (acceptResult && acceptResult.status === 'error')) {
            const errMsg = acceptResult?.message || acceptError?.message || 'เกิดข้อผิดพลาดในการกดยอมรับงาน'
            await ResponseGateway.dispatchResponse(replyToken, { type: 'VALIDATION_ERROR', message: `ยอมรับงานไม่สำเร็จ: ${errMsg}` }, 'CUSTOMER_LINE')
            continue
          }

          const { data: billResult, error: billError } = await supabase.rpc('create_unified_bill', { match_id: matchId })
          if (billError || (billResult && billResult.status === 'error')) {
            const errMsg = billResult?.message || billError?.message || 'เกิดข้อผิดพลาดในการสร้างบิล'
            await ResponseGateway.dispatchResponse(replyToken, { type: 'VALIDATION_ERROR', message: `ยอมรับสำเร็จ แต่ไม่สามารถสร้างบิลได้: ${errMsg}` }, 'CUSTOMER_LINE')
            continue
          }

          const { data: billText, error: formatError } = await supabase.rpc('format_unified_bill_for_line', { bill_id: billResult.bill_id })
          if (formatError) {
            await ResponseGateway.dispatchResponse(replyToken, { type: 'VALIDATION_ERROR', message: `ยอมรับและออกบิลสำเร็จ (เลขที่บิล: ${billResult.bill_id}) แต่การดึงข้อมูลบิลล้มเหลว` }, 'CUSTOMER_LINE')
            continue
          }

          const ownerSuccessMsg = customPrice 
            ? `ยอมรับงานรหัส ${matchId} เรียบร้อยแล้วครับด้วยราคาเสนอขาย ${customPrice.toLocaleString()} บาท! ดำเนินการออกบิลเลขที่ ${billResult.bill_id} และแจ้งลูกค้าแล้ว`
            : `ยอมรับงานรหัส ${matchId} เรียบร้อยแล้วครับ! ดำเนินการออกบิลเลขที่ ${billResult.bill_id} และแจ้งลูกค้าแล้ว`
          await ResponseGateway.dispatchResponse(replyToken, { type: 'VALIDATION_ERROR', message: ownerSuccessMsg }, 'CUSTOMER_LINE')

          const { data: queueData } = await supabase
            .from('match_queue')
            .select('customer_line_id')
            .eq('id', matchId)
            .single()

          if (queueData && queueData.customer_line_id) {
            await ResponseGateway.pushMessage(queueData.customer_line_id, billText)
          }
          continue
        }

        // Silent customer query processing
        const traceLogs: any[] = [
          { step: 'receive_text', status: 'SUCCESS', timestamp: new Date().toISOString() }
        ]

        const state = await getOrInitState(lineUserId, supabase)
        traceLogs.push({ step: 'get_state', status: 'SUCCESS', timestamp: new Date().toISOString() })

        console.log(`Extracting entities with Gemini for: "${text}"`)
        const extracted = await extractStructuredEntitiesWithGemini(text)
        
        if (extracted) {
          traceLogs.push({ step: 'gemini_extraction', status: 'SUCCESS', data: extracted, timestamp: new Date().toISOString() })
          
          const stateUpdates: any = {
            current_intent: extracted.material ? 'PRICE_REQUEST' : state.current_intent,
            ...extracted
          }

          const updatedState = {
            ...state,
            ...stateUpdates
          }

          await saveEntitiesToRegistry(lineUserId, dbEvent.id, extracted, supabase)
          traceLogs.push({ step: 'save_registry', status: 'SUCCESS', timestamp: new Date().toISOString() })

          await updateConversationState(lineUserId, stateUpdates, supabase)
          traceLogs.push({ step: 'save_state', status: 'SUCCESS', timestamp: new Date().toISOString() })

          await handleSilentMatching(supabase, lineUserId, updatedState, dbEvent.id, traceLogs)
        } else {
          traceLogs.push({ step: 'gemini_extraction', status: 'FAILED', timestamp: new Date().toISOString() })
          await supabase.from('line_events').update({
            admin_note: JSON.stringify({ trace_log: traceLogs })
          }).eq('id', dbEvent.id)
        }
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
