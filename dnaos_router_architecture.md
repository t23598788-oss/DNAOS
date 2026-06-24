# DNAOS Router Architecture

## 1. Router Layer
- **Sync Ingestion Gateway (`line-webhook`)**: รับ HTTP POST จาก LINE Webhook, ตรวจสอบลายเซ็น (LINE Signature Verification), แปลง Payload ของ LINE ให้เป็นมาตรฐาน **Event Envelope**, บันทึกลงตาราง `events` ใน Supabase ทันที และส่งตอบกลับ HTTP `200 OK` ภายในเวลาน้อยกว่า 100ms เพื่อป้องกัน Timeout
- **Async Dispatcher (Database Trigger & pg_net)**: หลังจากที่ข้อความถูกเพิ่มในตาราง `events` ระบบจะใช้ Database Trigger ร่วมกับ PostgreSQL `pg_net` Extension ในการยิง HTTP POST แบบ Asynchronous ไปหาปลายทางของแต่ละ Engine ที่เกี่ยวข้องโดยวิเคราะห์จากประเภทของเหตุการณ์

## 2. Event Schema
Event Envelope มาตรฐานเก็บโครงสร้างดังนี้:
- **id**: UUID (Primary Key)
- **source_type**: TEXT (`line_webhook`, `system`, `manual`)
- **event_type**: TEXT (ประเภทกิจกรรมหลักที่เกิดขึ้นเพื่อทำ Routing)
- **line_user_id**: TEXT (ไอดีลูกค้าฝั่ง LINE)
- **reply_token**: TEXT (Token ตอบกลับชั่วคราว มีอายุใช้งานสั้น)
- **payload**: JSONB (รายละเอียดของข้อความและค่าพารามิเตอร์ต่าง ๆ)
- **processed_status**: TEXT (`PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`)
- **error_message**: TEXT (ข้อความความผิดพลาดกรณีคำนวณหรือทำงานล้มเหลว)
- **created_at / updated_at**: TIMESTAMPTZ (บันทึกเวลา)

## 3. Event Types
การจำแนกประเภทกิจกรรมเพื่อส่งต่อไปยัง Engine:
- **Pricing Engine**:
  - `message.text` (ข้อความตัวอักษรสอบถามราคาหรือขอใบเสนอราคา)
  - `message.location` (พิกัดสถานที่จัดส่งวัสดุ)
  - `pricing.request` (คำนวณราคาวัสดุร่วมขนส่ง)
- **Order Engine**:
  - `order.draft_created` (สร้างร่างสั่งซื้อวัสดุ)
  - `order.confirmed` (ยืนยันคำสั่งซื้อจากผู้บริหาร)
- **Logistics Engine**:
  - `logistics.driver_assigned` (มอบหมายรถร่วมเข้าวิ่งงาน)
  - `logistics.location_update` (รายงานตำแหน่งติดตามพิกัดจัดส่ง)
- **Document Engine**:
  - `document.boq_generated` (จัดทำเอกสารและตอบกลับเสนอราคาในไลน์)
  - `document.invoice_generated` (ออกใบส่งของหรือเรียกเก็บเงิน)
- **Finance Engine**:
  - `finance.payment_received` (หลักฐานยืนยันการโอนเงิน)
  - `finance.payout_calculated` (รายงานสรุปยอดส่วนแบ่งบัญชีคู่ค้า)

## 4. Engine Structure
ระบบทำงานแบบแยกส่วนอิสระ (Decoupled Edge Functions):
- **Pricing Engine**: วิเคราะห์ราคาวัสดุ และระยะขนส่งจากบ่อวัสดุที่ใกล้ที่สุด
  - *Missing Price Guard*: หากวัสดุไม่มีราคาขายจริงในระบบ จะหยุดคำนวณ และแจ้งข้อความ "ไม่มีข้อมูลราคา" ส่งพิกัดและข้อมูลด่วนเข้าคิวตรวจสอบ พร้อมส่งแจ้งเตือน LINE Notify ไปหา CEO โดยทันที ห้ามนำราคา Default มาตอบกลับเด็ดขาด
- **Order Engine**: ควบคุมสถานะและดำเนินการจัดสร้างเอกสารสั่งจองวัสดุในระบบ
- **Logistics Engine**: ติดตามและจัดการลำดับการวิ่งงานของคนขับรถขนส่งในคิว
- **Document Engine**: ออก BOQ หรือ Invoice ในฐานข้อมูล
  - *LINE Reply/Push Strategy*: หากประมวลผลทันทีใช้ `replyToken` ส่งตอบกลับภายในเวลาไม่เกิน 10 วินาที หากเป็นธุรกรรมระยะยาวที่รอนาน (เช่น คอยคนขับหรือโอนเงิน) จะยิงผ่าน LINE Push Message API (`/v2/bot/message/push` ผ่าน `lineUserId`) แทนการใช้ Token ชั่วคราว
- **Finance Engine**: บันทึกการรับชำระเงิน ตรวจสอบสลิป และคำนวณผลประโยชน์แบ่งจ่ายรายคันรถ

## 5. Database Tables ที่เกี่ยวข้อง
- **`public.events` (ตารางใหม่)**: ใช้สำหรับจดบันทึก Event Queue และประวัติประมวลผล
- **`public.line_events` (ตารางเดิม)**: บันทึกดิบของข้อความพิกัด/ตัวอักษรของลูกค้า
- **`public.pit_profiles` / `public.pit_materials` / `public.material_types` (ตารางเดิม)**: ข้อมูลตำแหน่งของบ่อ ราคากลางวัสดุและชื่อชนิดสินค้า
- **`public.driver_profiles` / `public.job_assignments` (ตารางเดิม)**: ทะเบียนรถ สถานะคนขับว่าง/งานรับปัจจุบัน
- **`public.line_draft_documents` (ตารางเดิม)**: ใบเสนอราคาแบบร่าง ยอดเงินและสถานะอนุมัติ

## 6. Event Flow
1. **รับข้อความ**: ลูกค้าส่งข้อความแชทหรือพิกัดจัดส่ง ➔ LINE Webhook ➔ Router (`line-webhook` Edge Function)
2. **เก็บ Event**: Router บันทึก Event ลงตาราง `events` ในสถานะ `PENDING` และตอบ LINE กลับด้วยสถานะ HTTP 200 OK ทันที
3. **ส่งต่อ Engine**: PostgreSQL Trigger ดักข้อมูลแถวใหม่ แล้วเรียกใช้ `pg_net` ส่ง HTTP POST ไปยัง Engine ปลายทางตามประเภท Event
4. **ประมวลผล**: Engine ที่รับงานเปลี่ยนสถานะงานในตาราง `events` เป็น `PROCESSING` ดำเนินการวิเคราะห์และอัปเดตข้อมูลลงตารางธุรกิจหลัก เสร็จแล้วปรับสถานะงานเป็น `COMPLETED`
5. **ตอบกลับ**: Engine ส่งข้อความสรุปผล (เช่น ลิงก์อนุมัติ BOQ) ย้อนกลับหาลูกค้าโดยใช้ Reply Token หรือ Push Message API

## 7. Missing Components
- โครงสร้างตาราง `public.events` และตัว Trigger ที่ตั้งค่าร่วมกับ `pg_net` ในรูปแบบฐานข้อมูล SQL
- โมดูลใช้ร่วมกัน Deno Shared Module (`_shared`) สำหรับจัดการ CORS, โครงสร้าง Event Envelope Types และ SDK Client
- การแยกตรรกะประมวลผลในโค้ด `line-webhook` เดิม และแบ่งงานสร้าง Edge Functions ใหม่ทั้ง 5 Engine แยกจากกัน
- หน้ากระดานคิวและตรรกะสำหรับงานที่ติด Missing Price Guard รอให้เจ้าของมาใส่ราคาแบบแมนนวล

## 8. Recommended Implementation Order
1. **Migration Schema**: ติดตั้งตาราง `events` และจัดทำ Database triggers ควบคุมการจำแนกกระจายงาน
2. **Router Deployment**: ติดตั้ง Deno Edge Function `line-webhook` ใหม่ทำหน้าที่ Router รับและบันทึกเท่านั้น เพื่อเพิ่มความทนทานระบบด่านหน้า
3. **Core Calculation Engine**: พัฒนา `pricing-engine` (เน้น Missing Price Guard) และ `document-engine` (เน้นสร้างร่าง BOQ และตอบกลับด่วนเข้าแชท)
4. **Support Services Engine**: พัฒนาและติดตั้ง `logistics-engine`, `order-engine`, และ `finance-engine` เพื่อปิดกระบวนการรับงานเดิม
5. **E2E Testing**: ทดสอบการทำงานครบวงจรตั้งแต่การรับข้อความ คำนวณราคา การอนุมัติเอกสารและออกบิลขนส่ง
