import { haversine as calculateDistance } from "../_shared/haversine.ts"

export interface ConversationState {
  line_user_id: string;
  current_intent: string | null;
  material: string | null;
  quantity: number | null;
  vehicle_type: string | null;
  concrete_type: string | null;
  pickup: string | null;
  destination_text: string | null;
  destination_location: {
    lat?: number;
    lng?: number;
    address?: string;
  } | null;
  tax_id: string | null;
  status: 'ACTIVE' | 'COMPLETED' | 'EXPIRED';
  expires_at: string;
  project_name: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  payer_name: string | null;
}

// 1. Get or Initialize State
export async function getOrInitState(lineUserId: string, supabase: any): Promise<ConversationState> {
  const { data: state, error } = await supabase
    .from('conversation_states')
    .select('*')
    .eq('line_user_id', lineUserId)
    .maybeSingle();

  if (error) {
    console.error('Error fetching conversation state:', error);
  }

  const now = new Date();
  const defaultExpiry = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour

  if (!state || new Date(state.expires_at) < now || state.status === 'COMPLETED') {
    const newState: Partial<ConversationState> = {
      line_user_id: lineUserId,
      current_intent: null,
      material: null,
      quantity: null,
      vehicle_type: null,
      concrete_type: null,
      pickup: null,
      destination_text: null,
      destination_location: null,
      tax_id: null,
      status: 'ACTIVE',
      expires_at: defaultExpiry.toISOString(),
      project_name: null,
      contact_name: null,
      contact_phone: null,
      payer_name: null
    };
    
    // Upsert to database
    const { error: upsertError } = await supabase
      .from('conversation_states')
      .upsert(newState, { onConflict: 'line_user_id' });
      
    if (upsertError) {
      console.error('Error initializing conversation state:', upsertError);
    }
    
    return newState as ConversationState;
  }

  return state as ConversationState;
}

// 2. Update Conversation State
export async function updateConversationState(
  lineUserId: string,
  updates: Partial<ConversationState>,
  supabase: any
): Promise<void> {
  const expiry = new Date(new Date().getTime() + 60 * 60 * 1000); // Extension by 1 hour
  const payload = {
    ...updates,
    expires_at: expiry.toISOString(),
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase
    .from('conversation_states')
    .update(payload)
    .eq('line_user_id', lineUserId);

  if (error) {
    console.error('Error updating conversation state:', error);
  }
}

// 3. Extract Entities and Intent from Text
export function extractEntities(text: string, stateOrIntent: string | ConversationState | null): {
  intent: string | null;
  entities: {
    material?: string;
    quantity?: number;
    vehicle_type?: string;
    concrete_type?: string;
    tax_id?: string;
    pickup?: string;
    destination_text?: string;
    project_name?: string;
    contact_name?: string;
    contact_phone?: string;
    payer_name?: string;
  };
} {
  const currentIntent = typeof stateOrIntent === 'string' ? stateOrIntent : (stateOrIntent ? stateOrIntent.current_intent : null);
  const state = typeof stateOrIntent === 'object' ? stateOrIntent : null;
  const entities: Record<string, any> = {};
  
  // Normalise text for analysis
  const materialRegex = /(ดินถม|ดินลูกรัง|ทรายหยาบ|ทรายละเอียด|ทรายถม|ทราย|หินเกล็ด|หินคลุก|หิน\s*3\/4|หิน\s*3\/2|หิน|คอนกรีตสำเร็จรูป|เหล็กข้ออ้อย|เหล็กเส้น)/i;
  const matMatch = text.match(materialRegex);
  
  const concreteRegex = /(\d+)\s*(?:ksc|เคเอสซี)/i;
  const concreteMatch = text.match(concreteRegex);

  // A. Intent Detection
  let detectedIntent = currentIntent;
  if (text.includes('เช็คคิว') || text.includes('คิวรถ') || text.trim() === 'คิว' || text.toLowerCase() === 'queue') {
    detectedIntent = 'DRIVER_QUEUE_REQUEST';
  } else if (text.includes('คอนกรีต') || text.includes('ปูน') || concreteMatch) {
    detectedIntent = 'CONCRETE_REQUEST';
  } else if (text.startsWith('ขอราคา') || text.includes('ราคา') || text.includes('เสนอราคา') || text.includes('เท่าไหร่') || text.includes('เท่าไร')) {
    detectedIntent = 'PRICE_REQUEST';
  } else if (text.includes('ส่ง') || text.includes('ขนส่ง') || text.includes('จาก') || text.includes('ไป')) {
    // Intent Hijacking prevention:
    // If we have an active Price or Concrete session, or matched a material/concrete type, keep it.
    if (currentIntent === 'PRICE_REQUEST' || currentIntent === 'CONCRETE_REQUEST' || matMatch || concreteMatch) {
      detectedIntent = currentIntent || 'PRICE_REQUEST';
    } else {
      detectedIntent = 'TRANSPORT_REQUEST';
    }
  }

  // B. Entity Extraction
  // 1. Material
  if (matMatch) {
    let materialInput = matMatch[1];
    if (materialInput === 'ทราย' || materialInput === 'ทรายถม') materialInput = 'ทรายหยาบ';
    if (materialInput === 'หิน') materialInput = 'หินคลุก';
    entities.material = materialInput;
  }

  // 2. Quantity (Strip material and fractions before parsing to avoid overlaps)
  let textForQty = text;
  if (matMatch) {
    textForQty = text.replace(matMatch[0], '');
  }
  textForQty = textForQty.replace(/\d+\/\d+/g, ''); // strip fractions

  let quantity = 0;
  const qtyWithUnitMatch = textForQty.match(/(\d+(?:\.\d+)?)\s*(?:คิว|ตัน|เที่ยว|ถุง|เส้น|ตัว|แผ่น|รายการ)/i);
  if (qtyWithUnitMatch) {
    quantity = parseFloat(qtyWithUnitMatch[1]);
  } else {
    const qtyMatch = textForQty.match(/(\d+(?:\.\d+)?)/);
    if (qtyMatch) {
      quantity = parseFloat(qtyMatch[1]);
    }
  }
  if (quantity > 0) {
    entities.quantity = quantity;
  }

  // 3. Vehicle Type
  if (text.includes('พ่วง') || text.includes('รถพ่วง') || text.includes('เทรลเลอร์') || text.includes('trailer')) {
    entities.vehicle_type = 'trailer';
  } else if (text.includes('หกล้อ') || text.includes('6 ล้อ') || text.includes('6ล้อ')) {
    entities.vehicle_type = '6_wheeler';
  } else if (text.includes('สิบล้อ') || text.includes('10 ล้อ') || text.includes('10ล้อ')) {
    entities.vehicle_type = '10_wheeler';
  } else if (state && state.quantity && state.quantity >= 10 && !state.vehicle_type) {
    const cleanText = text.trim();
    const isYes = /^(ได้|เข้าได้|ได้ครับ|ได้ค่ะ|ใช่|ใช่ครับ|ใช่ค่ะ|พ่วงได้|รถพ่วงได้|รถพ่วงเข้าได้|ได้เลย|ได้เลยครับ)$/.test(cleanText) || 
                  (cleanText.includes('ได้') && !cleanText.includes('ไม่ได้') && !cleanText.includes('เข้าไม่ได้'));
    const isNo = /(ไม่ได้|เข้าไม่ได้)/.test(cleanText);
    const is10WheelerOnly = /(สิบล้อได้|ได้แค่สิบล้อ|สิบล้อเข้าได้)/.test(cleanText);
    const is6WheelerOnly = /(สิบล้อไม่ได้|สิบล้อเข้าไม่ได้|ได้แค่หกล้อ|หกล้อได้)/.test(cleanText);

    if (is6WheelerOnly) {
      entities.vehicle_type = '6_wheeler';
    } else if (is10WheelerOnly) {
      entities.vehicle_type = '10_wheeler';
    } else if (isNo) {
      entities.vehicle_type = '10_wheeler';
    } else if (isYes) {
      const isStone = state.material && (state.material.includes('หิน') || state.material.includes('คลุก') || state.material.includes('เกล็ด'));
      if (isStone || state.quantity >= 100) {
        entities.vehicle_type = 'trailer';
      } else {
        entities.vehicle_type = '10_wheeler';
      }
    }
  }

  // 4. Concrete Type (KSC)
  if (concreteMatch) {
    entities.concrete_type = `${concreteMatch[1]} ksc`;
  }

  // 5. Tax ID (13 digits)
  const taxIdMatch = text.match(/\b\d{13}\b/);
  if (taxIdMatch) {
    entities.tax_id = taxIdMatch[0];
  }

  // 6. Destination Text
  // Strip material, quantity, and concrete type to avoid matching them as destinations.
  let cleanTextForDest = text;
  if (matMatch) cleanTextForDest = cleanTextForDest.replace(matMatch[0], '');
  if (concreteMatch) cleanTextForDest = cleanTextForDest.replace(concreteMatch[0], '');
  
  // Destination text extractor
  const destinationRegex = /(?:ส่ง|ไป|ที่|แถว|โครงการ|หน้างาน)\s*([ก-๙a-zA-Z0-9_\-\s]{2,})/i;
  const destMatch = cleanTextForDest.match(destinationRegex);
  if (destMatch) {
    // Clean trailing keywords
    let matchedDest = destMatch[1].trim();
    // Exclude common keywords if they were captured
    const excludeKeywords = ['พ่วง', 'รถพ่วง', 'หกล้อ', 'สิบล้อ', '6ล้อ', '10ล้อ', 'คิว', 'ตัน', 'เที่ยว', 'ราคา', 'เท่าไหร่', 'เท่าไร'];
    excludeKeywords.forEach(kw => {
      matchedDest = matchedDest.replace(new RegExp(`\\s*${kw}\\s*`, 'g'), '').trim();
    });
    if (matchedDest.length > 1) {
      entities.destination_text = matchedDest;
    }
  } else {
    // Fallback: If no destination keyword matched, but it is TRANSPORT_REQUEST, check Route from/to pattern
    if (detectedIntent === 'TRANSPORT_REQUEST') {
      const routeMatch = text.match(/จาก\s*([^\s]+)\s*ไป\s*([^\s]+)/);
      if (routeMatch) {
        entities.pickup = routeMatch[1];
        entities.destination_text = routeMatch[2];
      }
    }
  }

  // 7. Pickup Route
  if (detectedIntent === 'TRANSPORT_REQUEST' && !entities.pickup) {
    const pickMatch = text.match(/จาก\s*([^\s]+)/);
    if (pickMatch) {
      entities.pickup = pickMatch[1];
    }
  }

  // 8. Project Name
  const projectMatch = text.match(/(?:โครงการ|ชื่อโครงการ)\s*([ก-๙a-zA-Z0-9_\-]{2,50})/i);
  if (projectMatch) {
    entities.project_name = projectMatch[1].trim();
  }

  // 9. Contact Name
  const contactMatch = text.match(/(?:ติดต่อคุณ|ติดต่อ|ผู้รับสินค้า|ผู้รับ|ผู้ประสานงาน|ชื่อผู้รับ)\s*([ก-๙a-zA-Z\s]{2,50})/i);
  if (contactMatch) {
    entities.contact_name = contactMatch[1].trim();
  }

  // 10. Contact Phone
  const phoneMatch = text.match(/(?:เบอร์|โทร|เบอร์โทร|เบอร์ติดต่อ)?\s*\b(0[2-9]\d{1,2}-?\d{3,4}-?\d{3,4})\b/);
  if (phoneMatch) {
    entities.contact_phone = phoneMatch[1].replace(/-/g, '').trim();
  }

  // 11. Payer Name
  const payerMatch = text.match(/(?:ผู้จ่ายเงิน|ผู้ชำระเงิน|จ่ายเงินโดย|ออกบิลในนาม|ในนาม)\s*([ก-๙a-zA-Z0-9_\-]{2,50})/i);
  if (payerMatch) {
    entities.payer_name = payerMatch[1].trim();
  }

  return {
    intent: detectedIntent,
    entities
  };
}

// 4. Save Entities to Registry
export async function saveEntitiesToRegistry(
  lineUserId: string,
  eventId: string,
  entities: Record<string, any>,
  supabase: any
): Promise<void> {
  const records = [];
  const now = new Date().toISOString();

  for (const [key, value] of Object.entries(entities)) {
    if (value === null || value === undefined) continue;

    const confidence = 1.0; // regex matches are 1.0 confidence

    records.push({
      line_user_id: lineUserId,
      event_id: eventId,
      entity_type: key,
      entity_value: typeof value === 'object' ? value : { value },
      confidence,
      created_at: now
    });
  }

  if (records.length > 0) {
    const { error } = await supabase
      .from('entity_registry')
      .insert(records);

    if (error) {
      console.error('Error saving to entity_registry:', error);
    }
  }
}

// 5. Execute Business Validation Middleware (Async)
export async function executeBusinessValidation(
  state: ConversationState,
  supabase: any
): Promise<{
  isValid: boolean;
  missingFields: string[];
  message: string;
}> {
  const intent = state.current_intent;
  if (!intent) {
    return { isValid: true, missingFields: [], message: '' };
  }

  // Thailand boundary check
  const isWithinThailand = (lat: number, lng: number): boolean => {
    return lat >= 5.6 && lat <= 20.5 && lng >= 97.3 && lng <= 105.6;
  };

  if (intent === 'PRICE_REQUEST') {
    // 1. Material
    if (!state.material) {
      return {
        isValid: false,
        missingFields: ['material'],
        message: 'รบกวนระบุชนิดวัสดุที่ต้องการ (เช่น ดินถม, ทรายหยาบ, หินคลุก) เข้ามาหน่อยครับ'
      };
    }

    // Material validation check
    const cleanedMaterial = state.material.replace(/\s+/g, '');
    const { data: matType } = await supabase
      .from('material_types')
      .select('id, name')
      .ilike('name', `%${cleanedMaterial}%`)
      .limit(1)
      .maybeSingle();

    if (!matType) {
      return {
        isValid: false,
        missingFields: ['material_price'],
        message: `ขออภัยครับ ระบบไม่พบข้อมูลวัสดุ "${state.material}" ในรายการ และไม่มีข้อมูลราคา ขออนุญาตส่งเรื่องให้เจ้าหน้าที่ตรวจสอบราคาด้วยตนเองครับ`
      };
    }

    const { data: pitMat } = await supabase
      .from('pit_materials')
      .select('price')
      .eq('material_type_id', matType.id)
      .order('price', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!pitMat || !pitMat.price) {
      return {
        isValid: false,
        missingFields: ['material_price'],
        message: `ขออภัยครับ ขณะนี้ไม่มีข้อมูลราคากลางสำหรับ "${state.material}" ในระบบ ขออนุญาตส่งเรื่องให้เจ้าหน้าที่ตรวจสอบราคาด้วยตนเองครับ`
      };
    }

    // 2. Location
    const loc = state.destination_location;
    const hasLocation = loc && loc.lat && loc.lng && isWithinThailand(loc.lat, loc.lng);
    if (!hasLocation) {
      return {
        isValid: false,
        missingFields: ['destination_location'],
        message: 'รบกวนส่งโลเคชั่นหน้างาน/แชร์พิกัดจัดส่งเข้ามาหน่อยครับ เพื่อให้ระบบค้นหาแหล่งวัสดุที่ใกล้ที่สุดและคำนวณราคาต่อตันรวมส่งให้ครับ'
      };
    }

    // 3. Quantity
    if (state.quantity === null || state.quantity === undefined || state.quantity <= 0 || state.quantity > 1000) {
      // Calculate price per cubic meter dynamically
      let resolvedMatName = matType.name;
      let materialBasePrice = parseFloat(pitMat.price) || 120.00;
      let targetDistance = 15.00;

      // Find nearest pit that sells this material
      const { data: pitMats } = await supabase
        .from('pit_materials')
        .select('price, pit_profile_id, pit_profiles(pit_name, latitude, longitude)')
        .eq('material_type_id', matType.id);

      if (pitMats && pitMats.length > 0) {
        let minD = Infinity;
        let bestPitMat = pitMats[0];
        pitMats.forEach((pm: any) => {
          const pit = pm.pit_profiles;
          if (pit && pit.latitude && pit.longitude && loc && loc.lat && loc.lng) {
            const d = calculateDistance(loc.lat, loc.lng, parseFloat(pit.latitude), parseFloat(pit.longitude));
            if (d < minD) {
              minD = d;
              bestPitMat = pm;
            }
          }
        });

        if (minD !== Infinity) {
          targetDistance = parseFloat(minD.toFixed(2));
        }
        materialBasePrice = parseFloat(bestPitMat.price) || materialBasePrice;
      }

      // Load configurations
      const { data: configs } = await supabase
        .from('app_configs')
        .select('title, data');

      // Owner correction (2026-07-25): no driver-wage-per-trip constant — the
      // truck owner is an independent contractor, DNA OS proposes a price
      // to them from real distance x real fuel price only, no separate
      // driver-wage line. Also no minimum-distance floor (owner, same day:
      // "ไม่มีขั้นต่ำระยะทาง") — real distance applies even under 15km.
      // fuel-price is real now (auto-synced from Bangchak's public API daily,
      // supabase/functions/fuel-price-sync) — 43.00 default kept only as a
      // last-resort if that sync has never run yet.
      let fuelPrice = 43.00;
      let markupPercent = 25.00;

      if (configs) {
        configs.forEach((c: any) => {
          if (c.title === 'fuel-price') fuelPrice = parseFloat(c.data) || fuelPrice;
          if (c.title === 'pricing-markup-percent') markupPercent = parseFloat(c.data) || markupPercent;
        });
      }

      const transportCostPerTrip = targetDistance * fuelPrice;
      const retailMaterialUnitPrice = Math.round(materialBasePrice * (1 + markupPercent / 100));
      const retailTransportUnitPrice = Math.round((transportCostPerTrip * (1 + markupPercent / 100)) / 5);
      const totalPricePerQ = retailMaterialUnitPrice + retailTransportUnitPrice;

      return {
        isValid: false,
        missingFields: ['quantity'],
        message: `ราคาประเมินสำหรับ ${resolvedMatName}:\n` +
                 `ราคาประมาณ ${totalPricePerQ.toLocaleString()} บาท/ตัน (คำนวณที่ระยะทางประมาณ ${targetDistance.toFixed(1)} กม. ขนส่งด้วยรถหกล้อขั้นต่ำ 5 ตัน)\n\n` +
                 `ต้องการกี่ตันแจ้งได้เลยครับ`
      };
    }

    // 4. Vehicle Type
    if (!state.vehicle_type) {
      const qty = state.quantity;
      if (qty >= 10) {
        const isStone = state.material && (state.material.includes('หิน') || state.material.includes('คลุก') || state.material.includes('เกล็ด'));
        if (isStone) {
          return {
            isValid: false,
            missingFields: ['vehicle_type'],
            message: 'สำหรับหินจำนวนมาก แนะนำขนส่งด้วยรถพ่วงเพื่ออัตราค่าส่งที่คุ้มที่สุดครับ รถพ่วงสามารถเข้าหน้างานได้ไหมครับ?'
          };
        } else {
          return {
            isValid: false,
            missingFields: ['vehicle_type'],
            message: `สำหรับจำนวน ${qty} ตัน แนะนำขนส่งด้วยรถพ่วงหรือรถสิบล้อครับ รถพ่วงหรือรถสิบล้อสามารถเข้าหน้างานได้ไหมครับ?`
          };
        }
      } else {
        // Auto-assign vehicle_type = '6_wheeler' for quantity < 10
        await updateConversationState(state.line_user_id, { vehicle_type: '6_wheeler' }, supabase);
        state.vehicle_type = '6_wheeler'; // update local reference
      }
    }

    // If it passed all the above, it's valid!
    return { isValid: true, missingFields: [], message: '' };
  }

  // Legacy validation for other intents (TRANSPORT_REQUEST, CONCRETE_REQUEST)
  const VALIDATION_RULES: Record<string, string[]> = {
    TRANSPORT_REQUEST: ['pickup', 'destination_text', 'vehicle_type'],
    CONCRETE_REQUEST: ['concrete_type', 'quantity', 'destination_location']
  };

  let required = VALIDATION_RULES[intent];
  if (!required) {
    return { isValid: true, missingFields: [], message: '' };
  }

  // Dynamic validation: If user did NOT specify a destination_text for CONCRETE_REQUEST,
  // we do not require destination_location.
  if (intent === 'CONCRETE_REQUEST' && !state.destination_text) {
    required = required.filter(field => field !== 'destination_location');
  }

  const missingFields: string[] = [];

  for (const field of required) {
    const value = (state as any)[field];
    if (value === null || value === undefined || value === '') {
      missingFields.push(field);
    } else if (field === 'quantity' && (typeof value !== 'number' || value <= 0 || value > 1000)) {
      missingFields.push(field);
    } else if (field === 'destination_location') {
      const loc = value as { lat?: number; lng?: number; address?: string };
      if (!loc || !loc.lat || !loc.lng || !isWithinThailand(loc.lat, loc.lng)) {
        missingFields.push(field);
      }
    }
  }

  if (missingFields.length === 0) {
    return { isValid: true, missingFields: [], message: '' };
  }

  // Generate friendly Thai message based on intent and missing fields
  let message = 'ขออภัยครับ ข้อมูลเพื่อประมวลผลธุรกรรมของท่านยังไม่ครบถ้วน:\n';

  if (intent === 'TRANSPORT_REQUEST') {
    if (missingFields.includes('pickup')) {
      message += '- รบกวนแจ้งจุดรับสินค้า (ต้นทาง)\n';
    }
    if (missingFields.includes('destination_text')) {
      message += '- รบกวนแจ้งจุดจัดส่งสินค้า (ปลายทาง)\n';
    }
    if (missingFields.includes('vehicle_type')) {
      message += '- รบกวนระบุประเภทรถจัดส่ง (หกล้อ / สิบล้อ / รถพ่วง)\n';
    }
  } else if (intent === 'CONCRETE_REQUEST') {
    if (missingFields.includes('concrete_type')) {
      message += '- รบกวนระบุประเภทกำลังอัดคอนกรีต (เช่น 240 ksc)\n';
    }
    if (missingFields.includes('quantity')) {
      const val = state.quantity;
      if (val !== null && val > 1000) {
        message += '- ปริมาณสั่งซื้อปูนเกินขีดจำกัดสูงสุด (จำกัดสูงสุด 1,000 ตัน)\n';
      } else {
        message += '- รบกวนระบุปริมาณปูนที่ต้องการใช้ (ตัน)\n';
      }
    }
    if (missingFields.includes('destination_location')) {
      if (state.destination_text) {
        message += `- รบกวนแชร์พิกัดสถานที่จัดส่งคอนกรีต (Location Share) สำหรับ "${state.destination_text}" เพื่อคำนวณระยะทางจากแพลนท์คอนกรีตใกล้เคียงครับ\n`;
      } else {
        message += '- รบกวนแชร์พิกัดสถานที่จัดส่งคอนกรีต เพื่อคำนวณระยะทางจากแพลนท์คอนกรีตใกล้เคียงครับ\n';
      }
    }
  }

  message += '\nรบกวนส่งข้อมูลเพิ่มเติมเข้ามาได้เลยครับ ผมรอตรวจสอบให้อยู่ครับ!';
  return { isValid: false, missingFields, message };
}

// 6. Check Business Qualification (Level 2 Validation)
export function checkBusinessQualification(state: ConversationState): {
  isQualified: boolean;
  missingFields: string[];
  thaiFieldNames: Record<string, string>;
} {
  const missingFields: string[] = [];
  const required = ['project_name', 'contact_name', 'contact_phone', 'payer_name', 'vehicle_type'];
  
  const thaiFieldNames: Record<string, string> = {
    project_name: 'ชื่อโครงการ (project_name)',
    contact_name: 'ชื่อผู้ติดต่อ/ผู้รับสินค้า (contact_name)',
    contact_phone: 'เบอร์โทรศัพท์ติดต่อ (contact_phone)',
    payer_name: 'ชื่อผู้ชำระเงิน/ผู้จ่ายเงิน (payer_name)',
    vehicle_type: 'ประเภทรถขนส่ง (vehicle_type: หกล้อ / สิบล้อ / รถพ่วง)'
  };

  for (const field of required) {
    const value = (state as any)[field];
    if (value === null || value === undefined || value === '') {
      missingFields.push(field);
    }
  }

  return {
    isQualified: missingFields.length === 0,
    missingFields,
    thaiFieldNames
  };
}

export async function extractStructuredEntitiesWithGemini(text: string): Promise<{
  material?: string;
  quantity?: number;
  contact_name?: string;
  contact_phone?: string;
  project_name?: string;
  destination_text?: string;
  vehicle_type?: string;
  concrete_type?: string;
} | null> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    console.warn("Missing GEMINI_API_KEY for extraction");
    return null;
  }

  try {
    const prompt = `Analyze the following customer message requesting construction materials and extract the details as a valid JSON object.
Do not include any explanation or markdown formatting (no \`\`\`json blocks), just return the plain raw JSON.

Return format:
{
  "material": string or null (extracted material type like ดินถม, ทรายหยาบ, หินคลุก, หินเกล็ด, หิน3/4, หิน3/2, คอนกรีต),
  "quantity": number or null (numerical value in cubic meters / Q),
  "contact_name": string or null (extracted contact name),
  "contact_phone": string or null (extracted phone number, normalized to 10 digits if possible, e.g. "0812345678"),
  "project_name": string or null (extracted project or site name),
  "destination_text": string or null (extracted address or location description),
  "vehicle_type": string or null (extracted vehicle type like "trailer", "10_wheeler", "6_wheeler"),
  "concrete_type": string or null (extracted concrete strength like "240 ksc")
}

Message: "${text}"`;

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: prompt }] }
        ],
        generationConfig: {
          maxOutputTokens: 200,
          temperature: 0.1,
          responseMimeType: "application/json"
        }
      })
    });

    if (!res.ok) {
      console.warn("Gemini Extraction call failed:", await res.text());
      return null;
    }

    const json = await res.json();
    const resultText = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (resultText) {
      return JSON.parse(resultText.trim());
    }
  } catch (err) {
    console.error("Gemini Extraction Error:", err);
  }
  return null;
}

export async function resolveAddressToCoordinates(address: string): Promise<{ lat: number, lng: number } | null> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) return null;

  try {
    const prompt = `Geocode the following address text in Thailand and resolve it to approximate GPS latitude and longitude coordinates.
Return ONLY a raw JSON object with keys "lat" (number) and "lng" (number). If the address is extremely vague, return null coordinates. Do not include markdown formatting or explanations.

Address: "${address}"`;

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: prompt }] }
        ],
        generationConfig: {
          maxOutputTokens: 100,
          temperature: 0.1,
          responseMimeType: "application/json"
        }
      })
    });

    if (!res.ok) {
      console.warn("Gemini Geocoding call failed:", await res.text());
      return null;
    }

    const json = await res.json();
    const resultText = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (resultText) {
      const parsed = JSON.parse(resultText.trim());
      if (parsed && typeof parsed.lat === 'number' && typeof parsed.lng === 'number') {
        return { lat: parsed.lat, lng: parsed.lng };
      }
    }
  } catch (err) {
    console.error("Gemini Geocoding Error:", err);
  }
  return null;
}
