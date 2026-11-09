# PRICING_DOMAIN — กติกาด้านราคาของ DNA OS

> อ่านเอกสารนี้ก่อนแก้ไฟล์ใดก็ตามที่บวก คูณ หรือแสดงราคา
> ถ้าโค้ดกับเอกสารนี้ขัดกัน — หยุดและรายงาน ห้ามเลือกฝ่ายเอง

## 1. เอกสารนี้ครอบคลุมอะไร

`pit_materials`, `pit_profiles`, `pit_price_requests`, `engines/quote-price.ts`,
`engines/validation/dispatcher.ts`,
`supabase/functions/line-webhook-v2/engines/quote-price.ts`,
`engines/cost.ts`, `presenter/explainer.ts`

## 2. สามฝ่าย และใครเป็นเจ้าของอะไร

| ฝ่าย | เป็นเจ้าของ | ไม่ได้เป็นเจ้าของ |
|---|---|---|
| ลูกค้า | ความต้องการ | ของ, รถ, ราคา |
| พาร์ตเนอร์/บ่อ | สต็อกวัสดุ, ราคาฐาน | รถ (ส่วนใหญ่), ระบบ |
| ขนส่ง | รถ, คนขับ | วัสดุ, ราคาวัสดุ |
| **DNA OS** | **ท่อประมวลผล, แพลตฟอร์ม** | **ไม่มีของ ไม่มีรถ ไม่ตั้งราคาฐาน** |

## 3. ราคาสองตัว ไม่ใช่บั๊ก

- **ราคาฐาน (Price A)** = `pit_materials.price` — ราคาที่พาร์ตเนอร์ต้องได้รับ
- **ราคาลูกค้า (Price B)** = Price A × 1.25 + ค่าขนส่ง × 1.25

ผู้อ่านที่เจอตัวเลขสองค่าสำหรับวัสดุเดียวกัน กำลังเห็น A กับ B
ไม่ใช่ความผิดพลาด ห้ามพยายาม "รวมให้ตรงกัน"

## 4. ใครกำหนดเลขไหน

- ราคาฐาน: พาร์ตเนอร์ (ผ่านแอดมินกรอก หรือผ่าน LINE reply ที่เก็บเป็น
  หลักฐานใน `pit_price_requests.reply_price`)
- ค่าขนส่ง: คำนวณจาก GPS × ราคาน้ำมัน × อัตราสิ้นเปลือง
- Platform Commission 25%: DNA OS กำหนดตามสัญญา — ตัวเดียวทั้งระบบ
- DNA OS ไม่ได้ "ตั้งราคาสินค้า" แต่เป็น "ผู้กำหนดอัตราค่าคอมมิชชั่นตามสัญญา"

## 5. สิ่งที่ DNA OS คูณ/บวกได้

อนุญาตเฉพาะ:

1. บวกค่าขนส่ง
2. คูณ 1.25 (Platform Commission) กับทุกรายการที่ขายในระบบ

ห้าม: คูณซ้อน, ฮาร์ดโค้ดอัตราอื่น, เดาจากไฟล์ข้างเคียง

## 6. สามเส้นทางราคาในโค้ด (ห้าม merge)

| # | ไฟล์ | ให้อะไร | ใครใช้ |
|---|---|---|---|
| 1 | `supabase/functions/line-webhook-v2/engines/quote-price.ts` | Price B (ลูกค้า), ปิดชื่อบ่อ | LINE webhook |
| 2 | `engines/quote-price.ts` | Price A ดิบ (หลังบ้าน), เปิดชื่อบ่อ | /admin/ask, dispatcher |
| 3 | `engines/validation/dispatcher.ts` | Price A + ขนส่ง (ยังไม่คูณ 1.25) | /api/chat, /api/v1/query |

`engines/quote-price.ts` หัวไฟล์เขียนว่า "Next.js-side equivalent" ของ
Deno engine — **ข้อความนี้ผิด** สองไฟล์ให้ผลต่างกันเพราะให้คนละฝ่าย

## 7. หน่วยนับ

`pit_materials.price` เป็น **บาท/ตัน**
คิว → ตัน ผ่าน `material_types.density_ton_per_cbm` เท่านั้น
ไม่มี density = ปฏิเสธการเสนอราคา
ห้ามติดป้ายคอลัมน์เดียวกันด้วยสองหน่วย (Node quote engine ติดป้าย
`บาท/คิว` / `quantityUnit: "คิว"` — ผิด)

## 8. การปิดชื่อบ่อ

ลูกค้าเห็นแค่ระยะทาง ไม่เห็นชื่อบ่อ (กันการ shopping around)
หลังบ้านและเอกสารเห็นชื่อได้

## 9. ข้อสรุปที่ห้ามเดา

- ห้าม merge Deno กับ Node quote engine
- ห้ามเขียน Price B กลับลง `pit_materials`
- ห้ามเรียก `pit_materials.price` ว่า "cost" หรือ "ต้นทุน"
- ห้ามคิดว่า 25% เป็นกำไรจากการขายของ — มันคือ Platform Commission
- ห้ามถือว่า `engines/pricing.ts` เป็น price engine ที่ใช้งานจริง
  (ไม่มี production caller; ดู `scripts/revenue-metering-audit-test.ts`)
- ห้าม dedupe haversine ระหว่าง Deno กับ Node (เป็น runtime boundary)

## 10. วิธีตรวจราคาด้วยมือ

อ่าน A จาก `pit_materials` → GPS จาก `line_events` → haversine →
`fuel_price_log` → `vehicle_types` → trips = ceil(qty/load_capacity) →
assert total = A × qty × 1.25 + transport × 1.25

## 11. ข้อขัดแย้งที่ยังเปิดอยู่

- `line-webhook-v2/engines/quote-price.ts` ฮาร์ดโค้ด `MARKUP_MULTIPLIER = 1.25`
  และเคยอ้าง `middleware/sanitizer.ts` ที่ไม่มีอยู่จริง — citation ปลอมถูกลบแล้ว
  แต่ยังเก็บอัตรา 1.25 ไว้ (ถูกต้องตามสัญญา) แต่ยังไม่ได้อ่านจาก
  `app_configs.pricing-markup-percent`
- `BUSINESS_CAPABILITY_MATRIX` domain F ระบุ `source_of_truth` เป็น
  `engines/pricing.ts` ซึ่งเป็น dead code
- Node quote engine ติดป้าย บาท/คิว ทั้งที่คอลัมน์เป็น บาท/ตัน
- `engines/pricing.ts` คำนวณค่าธรรมเนียมกระทบยอด แต่ไม่มีใครเรียกใช้
