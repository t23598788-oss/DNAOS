# STRUCTURE LOCK MAP — V1

**status: ACCEPTED BY OWNER, 2026-09-03 — CURRENT ARCHITECTURE BASELINE**
**unlock policy: ขอบเขตที่ LOCKED ย้ายหรือออกแบบใหม่ได้ก็ต่อเมื่อเจ้าของสั่งปลดล็อกชัดเจน**
**งานในอนาคตต้องต่อผ่าน extension point ที่ประกาศไว้เท่านั้น**

เอกสารนี้แยกห้ามิติที่คนมักปนกัน — โครงสร้างซอฟต์แวร์ · สัญญา · จุดต่อขยาย ·
ความพร้อมของการเชื่อมต่อ · สถานะการใช้งานจริง ระบบที่โครงมั่นคงแต่ยังไม่ได้ต่อสาย
ไม่ใช่ระบบที่ไม่มั่นคง การจับสองอย่างนี้รวมกันทำให้ตัดสินใจผิด

---

## LOCKED

| ขอบเขต | STRUCTURE | CONTRACT | EXTENSION POINT |
|---|---|---|---|
| Primary Navigation | LOCKED | — | `EXTRA_VIEWS` |
| Provider Adapter Boundary | LOCKED | — | `SourceEntry` + adapter ใหม่ |
| Calculation Core | LOCKED | LOCKED | สูตรใหม่ = entry + version ใหม่ |
| Resource Ownership | LOCKED | LOCKED v1 | validation เชิงเสริม |
| Core :8791 | LOCKED | — | endpoint อ่านเพิ่ม |
| Registry | LOCKED | LOCKED | ลงทะเบียนเพิ่ม |
| Payment :7910 | LOCKED | LOCKED | `providers.mjs` |
| Accounting :7900 | LOCKED | LOCKED | `event_type` |
| Owner Documentation | LOCKED | — | เพิ่มไฟล์ `.md` ในโฟลเดอร์นี้ |

**Primary Navigation** — บริการ · สั่งงาน · งาน · ระบบ · ตั้งค่า ห้ามเพิ่มปลายทางหลัก
โดยไม่ปลดล็อก Payment ไม่ใช่เมนูหลัก พื้นผิว debug ไม่ใช่เมนูหลัก

**Provider Adapter Boundary** — เส้นแบ่งอยู่ที่ `raw_evidence` ก่อนหน้านั้นรู้จัก provider
หลังจากนั้นไม่รู้จัก พิสูจน์แล้ว: คำว่า `runpod` ปรากฏ 0 ครั้งในแกนทั้ง 7 ไฟล์
เพิ่ม provider ธรรมดาต้องไม่ต้องแก้ App · Core · Calculation · Payment · Accounting

**Calculation Core** — ตอบเพียง "อะไรถูกใช้ไปเท่าไร" ห้ามให้ account หรือ intent
เข้าถึงได้ พิสูจน์แล้ว: measurement เดียวกันผ่านสอง account ได้ `formula_id`
`formula_version` และตัวเลขเท่ากันทุกหลัก

**Resource Ownership v1** — `credential_ref` บอกวิธียืนยันตัวตน
`provider_connection_id` บอกว่าเป็นของใคร คนละความหมาย ไม่รวมกัน
แถวที่ไม่มีเจ้าของเป็น `UNRESOLVED` ห้าม backfill

---

## OPEN FOR EXTENSION

Services · System · Settings · Work — เพิ่ม record/หมวด/สถานะได้
โดยไม่ย้ายขอบเขตที่ล็อกไว้

---

## NOT READY TO LOCK

| ขอบเขต | ตัวขวาง | หลักฐานถัดไปที่ต้องมี |
|---|---|---|
| **Command Owner Presentation** | มีแต่ตัวเรียก `run-semantic.sh` ไม่ใช่ชั้นแปลง | พิสูจน์ตอนรัน: internal result → owner-safe response |
| **Public Exposure Boundary** | ปลอดภัยเพราะ bind `127.0.0.1` ไม่ใช่เพราะสัญญา | ตัวกรองที่เป็นโค้ด ไม่ใช่ network topology |
| Payment Provider Connections | provider จริงทุกรายยัง NOT_CONNECTED | ต่อ provider จริง 1 ราย จบวงจรด้วยเงินจริง |
| Resource Cost → Payment | ไม่มีเส้น calculated result → payable | 1 แถวกลายเป็นรายการที่กดชำระได้ |
| Resource Usage → Financial Event | ไม่มีเส้น usage → `financial_events` | 1 usage → journal ที่ balanced |
| Provider Connection Validation | `provider_connection_id` รับสตริงอะไรก็ได้ | บังคับแบบเดียวกับ `get_source()` |

**ลำดับงานถัดไปที่เจ้าของกำหนด: 1) Command Owner Presentation  2) Public Exposure Boundary**

---

## กฎการนำเสนอต่อเจ้าของ

แสดงได้: ตัวตนที่คนอ่านออก · สถานะ · จุดประสงค์ · การกระทำที่ทำได้ · ผลลัพธ์ ·
สิ่งที่ต้องตัดสินใจ · การใช้งาน/ค่าใช้จ่ายเท่าที่มีจริง

**ห้ามขึ้นเป็นเนื้อหาหลัก:** source path · repository id · execution id · task id ·
ชื่อ worker/provider ฝั่ง implementation · port · pid · corrective-loop state ·
capability routing ดิบ · ค่า credential · ชื่อไฟล์

หลักฐานทางเทคนิคอยู่หลัง **รายละเอียด / ภายใน / หลักฐาน** ได้ แต่ไม่ใช่สิ่งแรกที่เห็น
