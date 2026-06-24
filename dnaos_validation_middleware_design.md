# DNAOS Business Validation Middleware Design

เอกสารนี้ระบุกระบวนการออกแบบสถาปัตยกรรมและซูโดโค้ด (Pseudocode) ของระบบคัดกรองข้อมูลทางธุรกิจ (Business Validation Middleware) สำหรับติดตั้งใน Edge Function `line-webhook` เพื่อสกัดเจตจำนง (Intent) ตรวจทานความครบถ้วนของข้อมูล และระงับคำขอธุรกรรมชั่วคราวกรณีข้อมูลไม่ครบถ้วนโดยไม่ต้องเรียกใช้งาน AI (Gemini)

---

## 🗺️ 1. ผังโครงสร้างสถาปัตยกรรม (Architecture Flow)

ตัวกรองนี้ทำหน้าที่เป็นด่านกักกัน (Gatekeeper) ตรวจสอบความถูกต้องก่อนที่จะนำส่งข้อความไปประมวลผลต่อในระดับ AI หรือคำนวณราคา:

```
                      [Incoming Webhook Message]
                                  │
                       1. Load Context & State
                                  │
                                  v
                    [validateBusinessRules Middleware]
                                  │
                       2. Classify Intent & Qty
                                  │
            ┌─────────────────────┴─────────────────────┐
  (Intent Found & Info Missing)             (Info Complete / No Match)
            │                                           │
            v                                           v
   [Short-Circuit Bypass]                     [Proceed normal flow]
  - ระงับการทำธุรกรรมร่าง BOQ                        - ส่งต่อไปยัง askGeminiAgent()
  - อัปเดตข้อมูลที่สกัดได้ลง State                      - ออก BOQ คำนวณราคาจริง
  - ตอบแชทขอข้อมูลที่ขาด (เช่น ขอพิกัด)                   - อัปเดตสถานะธุรกรรม
  - ใช้คำสั่ง 'continue' ข้ามลูปการเรียก AI
```

---

## 💻 2. ซูโดโค้ดการทำงาน (Validation Middleware Pseudocode)

ซูโดโค้ดภาษา TypeScript ด้านล่างนี้จะติดตั้งไว้ที่บรรทัดก่อนเรียกใช้งาน `askGeminiAgent()` (ระหว่างบรรทัดที่ 388-390):

```typescript
// 1. นำโครงสร้าง Entity Rules มาตั้งค่าตรวจเช็คข้อมูลบังคับ
interface ValidationResult {
  isValid: boolean;
  missingFields: string[];
  intent: 'PRICE_REQUEST' | 'TRANSPORT_REQUEST' | 'CONCRETE_REQUEST' | null;
  extractedEntities: Record<string, any>;
}

// 2. ฟังก์ชันตรวจสอบความถูกต้องทางธุรกิจ
function validateBusinessRules(text: string, contextData: any): ValidationResult {
  const normalizedText = text.trim().toLowerCase();
  
  let intent: ValidationResult['intent'] = null;
  const extractedEntities: Record<string, any> = {};
  const missingFields: string[] = [];

  // A. จำแนกเจตจำนง (Intent Classification) และดึง Entity
  if (normalizedText.includes('ราคา') || normalizedText.includes('เสนอราคา') || normalizedText.includes('เท่าไหร่')) {
    intent = 'PRICE_REQUEST';
    
    // ค้นหาชนิดวัสดุจากข้อความ หรือสืบค้นจาก Session State
    const materialMatch = normalizedText.match(/(ดินถม|ดินลูกรัง|ทรายหยาบ|ทรายละเอียด|ทรายถม|หินคลุก|หิน 3\/4|หิน 3\/2)/i);
    if (materialMatch) extractedEntities.material = materialMatch[1];
    else if (contextData.lastDraft?.payload?.material) extractedEntities.material = contextData.lastDraft.payload.material;

    // ค้นหาปริมาณ (Quantity)
    const qtyMatch = normalizedText.match(/(\d+)\s*(คิว|ตัน|เที่ยว)/);
    if (qtyMatch) extractedEntities.quantity = parseFloat(qtyMatch[1]);
    
    // ตรวจสอบข้อมูลพิกัด (Location) จากข้อมูลในอดีตล่าสุด
    if (contextData.lastLocation && contextData.lastLocation.lat && contextData.lastLocation.lng) {
      extractedEntities.location = contextData.lastLocation;
    }
    
    // ตรวจหาฟิลด์ที่ขาด
    if (!extractedEntities.material) missingFields.push('material');
    if (!extractedEntities.quantity) missingFields.push('quantity');
    if (!extractedEntities.location) missingFields.push('location');
  }
  
  else if (normalizedText.includes('ขนส่ง') || normalizedText.includes('ส่งรถ') || normalizedText.includes('จองคิวรถ')) {
    intent = 'TRANSPORT_REQUEST';
    
    // ค้นหารถ ยานพาหนะ และพิกัดต้นทาง/ปลายทาง
    const vehicleMatch = normalizedText.match(/(หกล้อ|6 ล้อ|สิบล้อ|พ่วง|รถพ่วง)/);
    if (vehicleMatch) extractedEntities.vehicle_type = vehicleMatch[1];

    if (contextData.lastLocation) extractedEntities.destination = contextData.lastLocation;
    
    if (!extractedEntities.pickup) missingFields.push('pickup');
    if (!extractedEntities.destination) missingFields.push('destination');
    if (!extractedEntities.vehicle_type) missingFields.push('vehicle_type');
  }
  
  else if (normalizedText.includes('ปูน') || normalizedText.includes('คอนกรีต')) {
    intent = 'CONCRETE_REQUEST';
    
    const strengthMatch = normalizedText.match(/(\d{3})\s*(ksc)/i);
    if (strengthMatch) extractedEntities.concrete_type = strengthMatch[1] + ' ksc';
    
    const qtyMatch = normalizedText.match(/(\d+)\s*(คิว)/);
    if (qtyMatch) extractedEntities.quantity = parseFloat(qtyMatch[1]);
    
    if (contextData.lastLocation) extractedEntities.location = contextData.lastLocation;
    
    if (!extractedEntities.concrete_type) missingFields.push('concrete_type');
    if (!extractedEntities.quantity) missingFields.push('quantity');
    if (!extractedEntities.location) missingFields.push('location');
  }

  return {
    intent,
    extractedEntities,
    missingFields,
    isValid: intent !== null ? missingFields.length === 0 : true
  };
}

// 3. การประยุกต์ใช้งานใน Deno.serve Webhook Loop (คั่นก่อนเรียก AI)
// -----------------------------------------------------------------
// [INSERT POINT: บรรทัดที่ 388-390]
const validation = validateBusinessRules(text, contextData);

if (validation.intent !== null && !validation.isValid) {
  let replyText = 'ขออภัยครับ ';
  
  // สร้างคำพูดตอบกลับเพื่อขอข้อมูลชี้เฉพาะ
  if (validation.intent === 'PRICE_REQUEST') {
    if (validation.missingFields.includes('location')) {
      replyText += 'ระบบพบความต้องการคำนวณราคาของคุณแล้วครับ แต่ยังขาดข้อมูลพิกัดส่งของ รบกวนแชร์พิกัดสถานที่ก่อสร้างหน้างาน (Location Share) เข้ามาเพื่อคำนวณค่าขนส่งจริงให้ท่านด้วยครับ';
    } else if (validation.missingFields.includes('material')) {
      replyText += 'ต้องการประมาณราคาวัสดุชนิดใดครับ (เช่น ทรายถม, ดินถม, หิน 3/4) รบกวนระบุเพิ่มเติมด้วยครับ';
    } else if (validation.missingFields.includes('quantity')) {
      replyText += `สำหรับ ${validation.extractedEntities.material} ต้องการใช้งานปริมาณจำนวนกี่คิว หรือกี่เที่ยวรถดีครับ`;
    }
  } 
  else if (validation.intent === 'TRANSPORT_REQUEST') {
    if (validation.missingFields.includes('vehicle_type')) {
      replyText += 'ต้องการใช้รถร่วมจัดส่งสินค้าประเภทใดครับ (เช่น รถหกล้อ หรือรถพ่วง)';
    } else {
      replyText += 'รบกวนส่งที่อยู่จัดส่งและต้นทางที่ขึ้นสินค้ามาเพิ่มเติมด้วยครับ';
    }
  }
  else if (validation.intent === 'CONCRETE_REQUEST') {
    if (validation.missingFields.includes('concrete_type')) {
      replyText += 'ต้องการปูนคอนกรีตสำเร็จรูปค่ากำลังอัดเท่าใดครับ (เช่น 240 ksc หรือ 280 ksc)';
    } else if (validation.missingFields.includes('quantity')) {
      replyText += 'ต้องการใช้งานปูนปริมาณกี่คิวครับ';
    }
  }

  // อัปเดตข้อมูลฟิลด์ที่ได้ไปสะสมไว้ในฐานข้อมูล (เพื่อใช้รอบถัดไป)
  await supabase
    .from('line_events')
    .update({ extracted: validation.extractedEntities })
    .eq('id', dbEvent.id);

  // ส่งแชทตอบกลับขอข้อมูลและตัดลูปทำงาน (Short-Circuit)
  await replyToLine(replyToken, replyText);
  continue; // ข้ามการทำงาน askGeminiAgent() และข้ามกระบวนการออก BOQ
}
```

---

## 📈 3. ผลกระทบต่อระบบ (System Impact Analysis)

*   **ประหยัดค่าใช้จ่าย API (Token Cost Savings)**:
    *   เนื่องจาก Middleware บล็อกและหยุดทำงานตั้งแต่เนิ่นๆ เมื่อพบข้อมูลไม่ครบ ระบบจึง bypass ไม่ยิง HTTP Request ไปหา Gemini API บนข้อความที่ถามคำถามไม่สมบูรณ์ ช่วยลดภาระการส่งข้อมูล System Prompt ข้อมูลบ่อและราคากลางวัสดุทั้งหมด ซึ่งช่วยประหยัดปริมาณ Tokens สะสมได้มหาศาล
*   **รักษาความสะอาดของฐานข้อมูล (Database Hygiene)**:
    *   ตาราง `public.line_draft_documents` จะไม่มีใบร่างเสนอราคาขยะที่คำนวณจากราคาขนส่งสมมุติ (ระยะทาง 15 กม. เริ่มต้น) บันทึกเก็บค้างไว้ ช่วยลดขนาดพื้นที่ใช้งานฐานข้อมูลหลัก
*   **ความรวดเร็วในการตอบสนองแชท (Latency Decrease)**:
    *   สำหรับการแจ้งเตือนขอข้อมูลเพิ่มเติม การตอบกลับจะลดความหน่วงจาก 2-3 วินาที (เวลาประมวลผล Gemini) เหลือต่ำกว่า **150 มิลลิวินาที** (สแกนตรวจสอบเสร็จแล้วส่งข้อความ LINE ทันที)
*   **เสถียรภาพระดับผู้บริหาร (CEO Peace of Mind)**:
    *   ผู้บริหาร (CEO) จะได้รับข้อความ LINE Notify แจ้งอนุมัติเฉพาะรายการที่ลูกค้าป้อนพิกัดถูกต้องจริงเท่านั้น ไม่มีปัญหาสแปมแจ้งอนุมัติราคาที่คำนวณจากค่าเริ่มต้นอีกต่อไป
