# DNA OS — A4 company document — THE single format

แม่แบบเดียวของเอกสารบริษัท DNA OS คือไฟล์นี้: `public/documents/dna-os-a4-master.html` (เปิด/พิมพ์ได้ตรงที่ `/documents/dna-os-a4-master.html`)
เอกสารทุกชนิด (ใบแจ้งหนี้ ใบเสร็จ ใบเสนอราคา หนังสือ แจ้งหนี้ค้างชำระ) ต้องใช้ **รูปแบบนี้เท่านั้น**
ถ้าเจอเอกสารรูปแบบอื่น ให้ย้ายมาใช้ไฟล์นี้ แล้วลบรูปแบบเดิมทิ้ง — ห้ามมีรูปแบบที่สองในระบบ

## ไฟล์ในชุดนี้ (ครบชุด มีเท่านี้)

| ไฟล์ | หน้าที่ |
| --- | --- |
| `public/documents/dna-os-a4-master.html` | แม่แบบจริง — มี CSS, ฟอนต์ฝังในตัว, ช่องกรอก `data-field` (แอปเสิร์ฟไฟล์นี้ให้ preview/print ใช้) |
| `layout-tokens.json` | ค่าที่วัดได้จากแม่แบบ (ขนาดกระดาษ ฟอนต์ สี ระยะ) ใช้อ้างอิงตอนเขียนโค้ด |
| `style-spec.md` | เอกสารนี้ — กฎการใช้งาน |

ไม่มี `layout.html` และไม่มีชั้นลายน้ำอีกแล้ว (ถอดออกพร้อมรูปแบบเดิม เมื่อ 2026-11-10)

## หน้ากระดาษ

- A4 portrait 210 × 297 mm, margin ซ้าย/ขวา 13 mm, ขอบบน 22 mm, footer ล่าง 12 mm
- พิมพ์: `@page{size:A4;margin:0}` + `@media print` ตั้ง `break-after:page` ที่ `.sheet`
  พื้นหลังจอเป็น `#E6E8E5` แต่ตอนพิมพ์เป็นกระดาษขาว
- หนึ่งเอกสาร = หนึ่ง `.sheet` = หนึ่งหน้า A4

## ฟอนต์ (ฝังในไฟล์ ไม่ต้องติดตั้งเพิ่ม)

Thai ใช้ `Thonburi` ก่อน ถ้าเครื่องไม่มีจึงใช้ `'Document Thai'` ที่ฝังไว้
ละติน/ตัวเลขใช้ `Arial` ก่อน แล้วตกไปที่ `'Document Thai'` ชุดละตินที่ฝังไว้ (ไม่ตกไปที่ฟอนต์ระบบอื่น)

ฝังไว้ 4 หน้า (data URI woff2 ใน `<style>`): น้ำหนัก 400 และ 700 อย่างละชุดไทย `U+0E00-0E7F`
และชุดละติน `U+0000-00FF, U+2000-206F, U+20A0-20CF`
เพราะฝังในไฟล์ เอกสารจึงหน้าตาเหมือนกันทุกเครื่องและใน PDF ที่ render บนเซิร์ฟเวอร์

| องค์ประกอบ | ขนาด |
| --- | --- |
| wordmark `DNA OS` | 27 pt / 700, tracking 1.5 pt |
| ชื่อเรื่องเอกสาร | 17 pt |
| ชื่อผู้ออกเอกสาร | 12 pt / 700 |
| เนื้อหา | 9 pt, line-height 1.55 |
| ป้ายกำกับ | 8.2 pt |
| จำนวนเงิน | 10 pt / 700, tabular-nums |
| footer | 7 pt |

## สี

`--ink #202321` · `--label #777D79` · `--rule #D5DAD6` · `--brand #183E32` · กระดาษ `#FFFFFF`

## ช่องกรอกข้อมูล (29 ช่อง, `data-field`)

เอกสารเป็นแบบฟอร์ม: ทุกช่องเป็น `<span data-field="...">` มีเส้นประและข้อความตัวอย่าง `[ชื่อช่อง]`
ตัวเติมเอกสารแทนที่ **ข้อความข้างใน** เท่านั้น ห้ามลบ `data-field` และห้ามแก้ CSS ในไฟล์นี้

`ISSUER_NAME` `ISSUER_NAME_EN` `ISSUER_TAX_ID` `ISSUER_ADDRESS` · `DOCUMENT_TYPE` `DOCUMENT_TYPE_EN`
`DOCUMENT_NUMBER` `DOCUMENT_DATE` `DOCUMENT_SUBJECT` `DOCUMENT_SUBJECT_EN` `DOCUMENT_NOTE`
`RECIPIENT_NAME` `RECIPIENT_NAME_EN` `RECIPIENT_TAX_ID` `RECIPIENT_ADDRESS`
`TRANSACTION_DATE` `DUE_DATE` `TRANSACTION_CHANNEL` `ORDER_REFERENCE`
`ITEM_ROWS` `SUBTOTAL` `VAT_RATE` `VAT_AMOUNT` `TOTAL_AMOUNT` `AMOUNT_IN_WORDS`
`PAYMENT_TERMS` `PAYMENT_STATUS` `PAYMENT_REFERENCE` `AUTHORIZED_SIGNATURE`

### รายการสินค้า (`ITEM_ROWS`)

`ITEM_ROWS` เป็น **ตารางเดียว** เต็มความกว้าง (`.items > table`) หนึ่งแถว = คำอธิบาย + จำนวน × ราคาต่อหน่วย
+ ยอดของแถวนั้นในคอลัมน์ `td.amt` (กว้าง 43 mm) ยอดจึงตรงกับบรรทัดสินค้าเสมอ
ห้ามแยกยอดไปช่องอื่น (โครงเดิมมี `ITEM_AMOUNTS` แยกคอลัมน์ ซึ่งทำให้ยอดลอยคนละที่ — ตัดออกแล้ว)

ชั้นความหนาแน่น: 5–8 รายการใส่ `table.compact` (8 pt), 9+ ใส่ `table.tight` (7.2 pt)
ถ้ายังยาวเกินหนึ่งหน้า ตัวประกอบเอกสาร (`renderA4Document`) จะแบ่งเป็นหลาย `.sheet` A4
หน้าละ 10 แถว (compact 8 แถว) โดยหน้ากลางไม่มีส่วนยอดรวม/บันทึก/ลายเซ็น และมีเลขหน้า `หน้า X / Y`
— เนื้อหาจึงไม่ล้นออกนอกขอบกระดาษและไม่มีแถวหาย

## ขอบเขต

แม่แบบนี้กำหนด **หน้าตา** ของเอกสาร ไม่คำนวณยอดเงินเองและไม่ออกเลขที่เอกสารเอง
ตัวเลขทุกตัวต้องมาจาก engines ที่คำนวณแล้ว (ห้ามเดา ห้ามปัดเศษเอง)
