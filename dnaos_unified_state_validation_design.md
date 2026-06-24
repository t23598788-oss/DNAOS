# DNAOS Unified State, Entity & Validation Design

เอกสารนี้ระบุแผนภาพสถาปัตยกรรม คำสั่งสคริปต์โครงสร้างฐานข้อมูล (SQL Schemas) และทิศทางจัดวางระบบของชั้นจดจำสถานะ (Conversation State), ทะเบียนตัวแปร (Entity Registry) และระบบกักกันความถูกต้องทางธุรกิจ (Business Validation Middleware) เพื่อเตรียมการปรับปรุงระบบปฏิบัติการ DNA OS แบบก้าวหน้าทีละขั้นตอน

---

## 📂 ส่วนที่ 1: ระบบบันทึกสถานะการสนทนา (Conversation State)

ระบบจัดเก็บสถานะสนทนาทำหน้าที่เก็บประวัติขั้นตอนธุรกรรมและพารามิเตอร์ที่กรองได้จากข้อความของผู้ใช้ เพื่อช่วยให้ระบบแชทสามารถดำเนินกิจกรรมต่อเนื่องข้ามข้อความ (Stateful Session) ได้บน Edge Function ที่เป็น Stateless

### 1.1 SQL Schema
```sql
-- สร้างตารางเก็บสถานะการสนทนาชั่วคราว
CREATE TABLE public.conversation_states (
    line_user_id VARCHAR(255) PRIMARY KEY,
    current_intent VARCHAR(100),
    material VARCHAR(100),
    quantity NUMERIC,
    vehicle_type VARCHAR(50),
    location JSONB, -- เก็บพิกัดและที่อยู่หน้างาน {"lat": 16.4, "lng": 102.8, "address": "ขอนแก่น"}
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'COMPLETED', 'EXPIRED'
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- สร้างดัชนีเพื่อเพิ่มความเร็วในการสืบค้นตามไอดีและมิติเวลาหมดอายุ
CREATE INDEX idx_conversation_states_expiry ON public.conversation_states(expires_at);
```

### 1.2 Migration Script
```sql
-- ฟังก์ชันอัปเดต updated_at อัตโนมัติ
CREATE OR REPLACE FUNCTION public.update_conversation_states_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- สร้าง Trigger สำหรับตาราง conversation_states
CREATE OR REPLACE TRIGGER trigger_update_conversation_states_updated_at
    BEFORE UPDATE ON public.conversation_states
    FOR EACH ROW
    EXECUTE FUNCTION public.update_conversation_states_updated_at();

-- เปิดใช้งานสิทธิ์ RLS สำหรับ Service Role
ALTER TABLE public.conversation_states ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow service_role full access to conversation_states" 
    ON public.conversation_states 
    FOR ALL 
    TO service_role 
    USING (true) 
    WITH CHECK (true);
```

### 1.3 จุดที่ต้องแทรกคำสั่ง Insert/Update ใน line-webhook/index.ts
*   **จุดดึงข้อมูลเซสชัน (State Retrieval Point)**:
    *   *ตำแหน่ง*: หลังจากการบันทึกข้อความขาเข้าลงตาราง `line_events` เสร็จสิ้น (ประมาณบรรทัดที่ **274**)
    *   *การทำงาน*: Query ตาราง `conversation_states` ตามเงื่อนไข `line_user_id` และตรวจเช็คเงื่อนไขหมดอายุ หากเป็นของเก่าเกิน 1 ชั่วโมง หรือไม่พบข้อมูล ให้ทำลายสร้างสภาวะเริ่มต้นใหม่
*   **จุดปรับปรุงข้อมูลเซสชัน (State Persistence Point)**:
    *   *ตำแหน่ง*: ภายในลูปประมวลผลก่อนที่จะทำการตอบกลับลูกค้า ( reply ) และหลังการทำ Entity Extraction
    *   *การทำงาน*: อัปเดตข้อมูลพารามิเตอร์ที่แกะได้เพิ่มเติม (เช่น ชนิดวัสดุ หรือ ปริมาณคิว) และเขียนทับลงในฐานข้อมูลแถวของลูกค้านั้น ๆ พร้อมขยายเวลาหมดอายุเพิ่ม 1 ชั่วโมง

### 1.4 ซูโดโค้ดการทำงาน (Operational State Pseudocode)
```typescript
// ดึงและตั้งค่าเริ่มต้นสถานะบทสนทนา
async function getOrInitState(lineUserId: string, supabase: any) {
  const { data: state, error } = await supabase
    .from('conversation_states')
    .select('*')
    .eq('line_user_id', lineUserId)
    .maybeSingle();

  const now = new Date();
  
  // ตรวจสอบว่าคิวเซสชันหมดอายุหรือยัง
  if (!state || new Date(state.expires_at) < now || state.status === 'COMPLETED') {
    const defaultExpiry = new Date(now.getTime() + 60 * 60 * 1000); // 1 ชั่วโมง
    const newState = {
      line_user_id: lineUserId,
      current_intent: null,
      material: null,
      quantity: null,
      vehicle_type: null,
      location: null,
      status: 'ACTIVE',
      expires_at: defaultExpiry.toISOString()
    };
    
    await supabase.from('conversation_states').upsert(newState);
    return newState;
  }
  
  return state;
}

// อัปเดตตัวแปรสถานะ
async function updateConversationState(lineUserId: string, updates: Record<string, any>, supabase: any) {
  const expiry = new Date(new Date().getTime() + 60 * 60 * 1000); // ยืดอายุต่อ
  await supabase
    .from('conversation_states')
    .update({ 
      ...updates,
      expires_at: expiry.toISOString()
    })
    .eq('line_user_id', lineUserId);
}
```

---

## 📂 ส่วนที่ 2: ระบบคลังข้อมูลตัวแปร (Entity Registry)

Entity Registry Layer ทำหน้าที่เป็นทะเบียนประวัติข้อมูล (Audit Trail) จดเก็บรายละเอียดตัวแปรทั้งหมดที่สกัดได้ระหว่างการใช้งาน เพื่อใช้เป็นคลังสถิติ และเป็นประวัติตรวจสอบความต่อเนื่อง

### 2.1 SQL Schema ของ entity_registry
```sql
-- สร้างตารางเก็บบันทึกประวัติวิเคราะห์ตัวแปรเดี่ยวแยกประเภท
CREATE TABLE public.entity_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    line_user_id VARCHAR(255) NOT NULL,
    event_id UUID NOT NULL, -- อ้างอิง ID จาก events / line_events
    entity_type VARCHAR(100) NOT NULL, -- 'material', 'quantity', 'vehicle_type', 'location', 'concrete_type', 'tax_id'
    entity_value JSONB NOT NULL, -- เก็บค่าตัวแปรจริง เช่น {"name": "ทรายถม"} หรือ {"latitude": 16.4}
    confidence NUMERIC NOT NULL DEFAULT 1.0, -- ระดับความเชื่อมั่นในการสกัดข้อมูล (1.0 = Regex/Location Share, 0.8 = Gemini)
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ดัชนีเพิ่มความเร็วการสืบค้นตัวแปรค้างส่งมอบ
CREATE INDEX idx_entity_registry_search ON public.entity_registry(line_user_id, created_at DESC);
```

### 2.2 จุดที่ต้องเรียกใช้งานหลัง Extraction
*   **จุดบันทึก**: ทันทีที่ฟังก์ชัน Regex หรือคำสั่ง `JSON.parse` ของ Gemini สกัดข้อมูลตัวแปรออกมาได้สำเร็จ (ก่อนที่จะเรียกใช้งาน Business Validation Middleware)
*   **คำสั่งที่รัน**: ระบบจะลูปข้อมูล Entities ที่แกะได้และทำคำสั่ง INSERT สคริปต์บันทึกลงตาราง `entity_registry` ทั้งหมดแบบ Bulk เพื่อเก็บเป็นประวัติ

### 2.3 แผนภาพกระแสข้อมูล (Data Flow Diagram)
```
[User Message] ➔ [Regex & Gemini API Parser]
                             │
                  (สกัดได้ข้อมูลตัวแปร)
                             │
                             ├──────────────┐
                             v              v
               [entity_registry (DB)]  [conversation_states (DB)]
               (บันทึกเก็บเป็นประวัติดิบ)  (ปรับอัปเดตตัวแปรเซสชันหลัก)
                                            │
                                            v
                               [Validation Middleware] (คัดกรอง Required)
```

### 2.4 กฎเกณฑ์การตรวจทานความถูกต้อง (Validation Rules)
ก่อนจัดเก็บข้อมูลลง Registry และ State ระบบจะต้องประเมินเงื่อนไขเบื้องต้นเพื่อป้องกันข้อมูลขยะ:
*   `material`: ต้องตรงกับชื่อในตาราง `material_types` (ตัวสะกดตรงกัน)
*   `quantity`: ต้องเป็นตัวเลขบวกที่มีค่าไม่เกิน `1000` คิวต่อคำสั่งซื้อ (หากเกินจะบล็อกเพื่อตรวจสอบ)
*   `vehicle_type`: บังคับเป็นค่า `'6_wheeler'`, `'10_wheeler'` หรือ `'trailer'` เท่านั้น
*   `location`: ต้องประกอบด้วยละติจูด/ลองจิจูดอยู่ในพิกัดขอบเขตประเทศไทยจริง
*   `concrete_type`: ตัวเลขต้องลงท้ายด้วยหน่วย `'ksc'` เสมอ
*   `tax_id`: ต้องเป็นสตริงตัวเลข 13 หลักเท่านั้น

---

## 📂 ส่วนที่ 3: ระบบคัดกรองข้อมูลธุรกิจ (Business Validation Middleware)

ทำหน้าที่สกัดเจตจำนงและกักกันข้อมูล หากตรวจสอบแล้วพบว่าตัวแปรที่ต้องการสำหรับการออก BOQ หรือจองรถขนส่งไม่ครบถ้วน จะสั่งตีกลับแชททวงถามทันทีโดยไม่ต้องส่งงานให้ AI ประมวลผล

### 3.1 TypeScript Middleware Design
```typescript
interface ValidationRule {
  requiredFields: string[];
}

const VALIDATION_RULES: Record<string, ValidationRule> = {
  PRICE_REQUEST: {
    requiredFields: ['material', 'quantity', 'location']
  },
  TRANSPORT_REQUEST: {
    requiredFields: ['pickup', 'destination', 'vehicle_type']
  },
  CONCRETE_REQUEST: {
    requiredFields: ['concrete_type', 'quantity', 'location']
  }
};

// ฟังก์ชันคัดกรองข้อมูลธุรกิจหลัก
function executeBusinessValidation(state: any): { isValid: boolean; missingFields: string[] } {
  const intent = state.current_intent;
  if (!intent || !VALIDATION_RULES[intent]) {
    return { isValid: true, missingFields: [] };
  }

  const rule = VALIDATION_RULES[intent];
  const missingFields = rule.requiredFields.filter(field => {
    const value = state[field];
    if (value === null || value === undefined) return true;
    if (typeof value === 'object' && Object.keys(value).length === 0) return true;
    return false;
  });

  return {
    isValid: missingFields.length === 0,
    missingFields
  };
}
```

### 3.2 แผนภาพควบคุมการไหล (Flow Diagram)
```
          [loadContextData & getOrInitState]
                          │
                          v
            [executeBusinessValidation]
                          │
             ┌────────────┴────────────┐
       (isValid = true)         (isValid = false)
             │                         │
             v                         v
     [Call Gemini / Engine]     [Short Circuit Logic]
    - ส่งคำสั่งเสนอราคา BOQ      - ข้ามการยิง Gemini
    - อัปเดตออเดอร์ใน DB         - พิมพ์ตอบแชททวงข้อมูลที่ขาด
                                - สิ้นสุดลูป (continue)
```

### 3.3 จุดแทรกระบบใน line-webhook/index.ts
*   **จุดติดตั้ง**: แทรกที่บรรทัดประมาณ **388-390** (ก่อนที่จะเรียกใช้งานฟังก์ชัน `askGeminiAgent()` หรือคำสั่ง Fallback Router ดั้งเดิม)

### 3.4 ตรรกะระงับการทำงาน (Short Circuit Logic)
หากตัวกรองตรวจพบฟิลด์บังคับขาดหาย ระบบจะดำเนินการ:
1.  ประเมินความต้องการและเลือกสร้างประโยคแจ้งขอข้อมูลที่ขาด (เช่น ขอแชร์โลเคชัน หรือ เลือกคิว)
2.  ส่งข้อความกลับหาผู้ใช้ LINE ทันทีโดยสั่งงานผ่านฟังก์ชัน `replyToLine(replyToken, text)`
3.  ใช้คำสั่ง `continue;` ของลูปหลักเพื่อดีดการทำงานไปยังรอบถัดไปทันที (ระงับไม่ให้เรียกใช้ Gemini API หรือสร้างใบเสนอราคาฉบับร่างค้างไว้ในระบบอย่างเด็ดขาด)
