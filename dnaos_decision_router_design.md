# DNAOS Context Loader & Decision Router Design

เอกสารนี้ระบุการออกแบบสถาปัตยกรรมตัวโหลดบริบท (Context Loader) และตัวจัดการเส้นทางตัดสินใจ (Decision Router) ของระบบปฏิบัติการ DNA OS เพื่อเพิ่มความสามารถการตรวจสอบความสมบูรณ์ของพารามิเตอร์ และกรองเงื่อนไขการส่งต่อข้อมูลอย่างมีระเบียบตาม Entity Schema ล่าสุด

---

## 🗺️ 1. Intent ➔ Query Mapping & Supabase Tables

เพื่อลดภาระการโหลดข้อมูลที่เกินความจำเป็น ระบบจะทำการคัดกรองเจตจำนง (Intent) ขาเข้าก่อน เพื่อสืบค้นข้อมูลเฉพาะจากตาราง Supabase PostgreSQL ที่จำเพาะเจาะจง:

| เจตจำนง (Intent) | ตารางที่ต้องโหลด (Supabase Tables) | รายละเอียดข้อมูลที่เลือก |
| :--- | :--- | :--- |
| **`PRICE_REQUEST`** | `app_configs`<br/>`material_types`<br/>`pit_materials`<br/>`pit_profiles`<br/>`line_events` | ค่าคำนวณพื้นฐาน (ราคาน้ำมัน, ค่าแรง), ไอดีและชื่อวัสดุ, ราคาหน้าบ่อ, พิกัดละติจูด/ลองจิจูดของบ่อวัสดุ, พิกัดโครงการของลูกค้า |
| **`TRANSPORT_REQUEST`**| `app_configs`<br/>`pit_profiles`<br/>`line_events` | ค่าบริการระบบ, พิกัดบ่อวัสดุต้นทาง, พิกัดโครงการจุดจัดส่งปลายทาง |
| **`CONCRETE_REQUEST`** | `pit_profiles`<br/>`pit_materials`<br/>`line_events` | รายการเฉพาะแพล้นท์ปูน (`plant`), ราคาปูน ksc แต่ละเกรด, พิกัดจุดเทปูนหน้างาน |
| **`DRIVER_QUEUE_REQUEST`**| `driver_profiles`<br/>`job_assignments`<br/>`jobs` | รายชื่อคนขับรถทั้งหมด, ทะเบียนรถ, สถานะคิวงานวิ่งในปัจจุบันพร้อมชื่อโปรเจกต์จัดส่ง |

---

## 📋 2. ข้อมูลบังคับเชิงประมวลผล (Required Data per Intent)

*   **`PRICE_REQUEST`**:
    *   `material_id` (ชนิดวัสดุที่ถูกต้องในระบบ)
    *   `base_price` (ราคาหน้าบ่อวัสดุที่จับคู่ได้)
    *   `quantity` (ปริมาณคิวที่แน่นอน)
    *   `user_coords` (ละติจูด/ลองจิจูดลูกค้า) และ `pit_coords` (ละติจูด/ลองจิจูดบ่อ)
    *   `configs` (ราคาน้ำมัน, ค่าแรงคนขับ, เปอร์เซ็นต์ Markup)
*   **`TRANSPORT_REQUEST`**:
    *   `pickup_coords` (พิกัดต้นทาง) และ `destination_coords` (พิกัดปลายทาง)
    *   `vehicle_capacity` (ความจุของประเภทรถที่เลือกวิ่ง เช่น 6 ล้อ = 5 คิว, พ่วง = 30 คิว)
    *   `configs` (ราคาน้ำมัน, ค่าแรงคนขับ)
*   **`CONCRETE_REQUEST`**:
    *   `concrete_material_id` (ไอดีคอนกรีต ksc ที่สั่ง)
    *   `base_price` (ราคาปูนหน้าแพล้นท์)
    *   `quantity` (ปริมาณสั่งคิวปูน)
    *   `user_coords` (พิกัดหน้างานจัดส่ง) และ `plant_coords` (พิกัดแพล้นท์ปูน)
    *   `configs` (ราคาน้ำมัน, ค่าแรงคนขับ, เปอร์เซ็นต์ Markup)

---

## 🧮 3. ลำดับขั้นตอนคำนวณ (Calculation Flow)

หากข้อมูลบังคับเข้าเกณฑ์ครบถ้วน ระบบคำนวณราคาจะดำเนินการคำนวณตามสูตรทางธุรกิจดังนี้:

1.  **คำนวณหาระยะทาง (Haversine Formula)**:
    คำนวณระยะทางจริง ($d$ เป็นกิโลเมตร) ระหว่างพิกัดสองจุดพิกัดละติจูด/ลองจิจูด ($\phi, \lambda$):
    $$d = 2 \times R \times \arcsin\left(\sqrt{\sin^2\left(\frac{\Delta \phi}{2}\right) + \cos(\phi_1) \cos(\phi_2) \sin^2\left(\frac{\Delta \lambda}{2}\right)}\right)$$
    *(กำหนดให้ $R = 6371$ กม. รัศมีโลก)*
2.  **คำนวณจำนวนเที่ยวรถขนส่ง (Trips)**:
    $$\text{trips} = \lceil \text{quantity} / \text{vehicle\_capacity} \rceil$$
3.  **คำนวณต้นทุนค่าขนส่ง (Transport Cost)**:
    $$\text{transport\_cost\_per\_trip} = (\text{distance} \times \text{fuel\_price}) + \text{driver\_wage}$$
    $$\text{total\_transport\_cost} = \text{trips} \times \text{transport\_cost\_per\_trip}$$
4.  **คำนวณต้นทุนรวมและส่วนต่างบวกกำไร (Net Total with Markup)**:
    $$\text{material\_cost} = \text{quantity} \times \text{base\_price}$$
    $$\text{subtotal} = \text{material\_cost} + \text{total\_transport\_cost}$$
    $$\text{markup\_margin} = \text{subtotal} \times \left(\frac{\text{markup\_percent}}{100}\right)$$
    $$\text{net\_total} = \text{subtotal} + \text{markup\_margin}$$

---

## 🔄 4. ขั้นตอนการประมวลเมื่อข้อมูลไม่ครบ (Missing Data Flow)

```
[Required Field Is Null] ➔ [Halt Math Calculation Engine]
                                   │
                      1. Extract partial entities
                                   │
                                   v
             [Update Session State in public.line_events]
                                   │
               2. Match missing field to Reply message
                                   │
                                   v
                    [Send targeted LINE Msg to user]
                                   │
                      3. Bypass Gemini API call
```

---

## 🤖 5. กฎเกณฑ์เรียกใช้สมอง AI (Gemini Invocation Rule)

เพื่อการประหยัดค่า Tokens ปริมาณสิทธิ์การโทร และหลีกเลี่ยงความล่าช้าในการแชท (Latency Control):

*   **Rule 1: Short-Circuit Bypassing (กรองบังคับหลุด)**:
    *   หากวิเคราะห์พบ Intent ของข้อความเป็นประเภทธุรกรรม (`PRICE_REQUEST`, `TRANSPORT_REQUEST`, `CONCRETE_REQUEST`) แต่ผลลัพธ์ข้อมูลบังคับ (Required Fields) ขาดหาย **ห้ามส่งคำสั่งไปหา Gemini API** ให้ส่งคำตอบทวงถามข้อมูลในแชททันที
*   **Rule 2: Direct Database Route (ทางผ่านตรงสำหรับงานคิว)**:
    *   หากตรวจพบเจตนาของผู้ใช้เป็น `DRIVER_QUEUE_REQUEST` (เช็คคิวคนขับรถร่วม) **ห้ามส่งคำสั่งไปหา Gemini API** ให้ดึงสถานะจากฐานข้อมูลมาตอบลูกค้าโดยตรงทันที (ใช้เวลารอบการตอบแชท < 150ms)
*   **Rule 3: Conversational AI Mode (ทำงานแชทบอทปกติ)**:
    *    Gemini API จะถูกเรียกประมวลผลก็ต่อเมื่อ:
        1. เป็นข้อความสอบถามคำถามทั่วไป บทสนทนา หรือเช่าเครื่องจักรหน้างาน
        2. ข้อมูลบังคับสำหรับการขอราคาครบถ้วนทั้งหมดแล้ว เพื่อให้ AI พูดคุยโต้ตอบ B2B และปล่อยคำสั่งร่าง BOQ `[CREATE_DRAFT: ...]` ออกมาได้ถูกต้อง

---

## 💻 6. ซูโดโค้ดการทำงาน (Context Loader & Router Pseudocode)

```typescript
// 1. ตัวโหลดบริบทแยกตาม Intent (Context Loader Module)
async function loadContextData(intent: string, lineUserId: string, supabase: any) {
  const context: Record<string, any> = {};

  // ดึง Configurations พื้นฐาน
  const { data: configs } = await supabase.from('app_configs').select('title, data');
  context.configs = parseConfigs(configs);

  if (intent === 'PRICE_REQUEST' || intent === 'CONCRETE_REQUEST') {
    // โหลดประวัติพิกัดจัดส่งล่าสุด
    const { data: lastLoc } = await supabase
      .from('line_events')
      .select('raw_text, extracted')
      .eq('line_user_id', lineUserId)
      .eq('raw_type', 'location')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    context.lastLocation = lastLoc;

    // โหลดรายละเอียดวัสดุ
    const { data: materials } = await supabase.from('pit_materials').select('*, material_types(name), pit_profiles(*)');
    context.materials = materials;
  }
  
  else if (intent === 'DRIVER_QUEUE_REQUEST') {
    const { data: drivers } = await supabase.from('driver_profiles').select('*, job_assignments(*, jobs(*))');
    context.driverQueue = compileQueueText(drivers);
  }

  return context;
}

// 2. ตัวจัดการเส้นทางตัดสินใจ (Decision Router Module)
async function routeDecision(text: string, lineUserId: string, replyToken: string, supabase: any) {
  // A. แยกเจตจำนงเบื้องต้น
  const intent = detectIntent(text);
  
  // B. โหลดเฉพาะข้อมูลที่จำเป็นตามประเภทเจตจำนง (Context Loader)
  const contextData = await loadContextData(intent, lineUserId, supabase);

  // C. เรียกใช้ Business Validation Middleware
  const validation = validateRequiredFields(intent, text, contextData);

  // D. หากข้อมูลไม่ครบ ➔ ตีกลับ (Missing Data Flow)
  if (intent !== null && !validation.isValid) {
    const missingReply = buildMissingResponseMsg(validation.intent, validation.missingFields);
    
    // บันทึกตัวแปรที่ได้ไว้ใน State ของแชท
    await supabase.from('line_events').update({ extracted: validation.extracted }).eq('line_user_id', lineUserId);
    
    await replyToLine(replyToken, missingReply);
    return; // Bypass Gemini
  }

  // E. หากเจตนาเป็นตรวจคิวรถร่วม ➔ ตอบกลับโดยตรงไม่ต้องใช้ AI
  if (intent === 'DRIVER_QUEUE_REQUEST') {
    await replyToLine(replyToken, contextData.driverQueue);
    return; // Bypass Gemini
  }

  // F. ข้อมูลครบถ้วน / เป็นแชททั่วไป ➔ เรียกใช้ Gemini AI Agent
  const history = await fetchChatHistory(lineUserId, supabase);
  const aiResponse = await askGeminiAgent(text, history, contextData);
  
  // ประมวลผลและสร้างใบร่างเอกสารหาก AI สั่งทำ
  await processResponseActions(aiResponse, replyToken, supabase);
}
```
