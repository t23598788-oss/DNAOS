# DNA OS — COST STRUCTURE EVIDENCE
**วันที่:** 2026-10-25 · **หลักฐาน:** registry ที่เจ้าของดูแล, schema ค่าใช้จ่าย, ฟังก์ชัน sync ใบแจ้งหนี้
**ข้อสรุปหลัก:** ต้นทุนที่ **ยืนยันได้จาก source ตอนนี้มีเพียงค่าโดเมน 50 บาท/เดือน** และค่าบริการที่ประกาศเป็น 0 (free tier) — **ยังไม่มีต้นทุนต่อธุรกรรมที่วัดได้** จึงติดป้าย `COST_UNALLOCATED` แทบทั้งหมด

> กฎที่ใช้: ห้ามนำราคาหน้าเว็บผู้ให้บริการมาแทนค่าใช้จ่ายจริง — ต้องมีใบแจ้งหนี้หรือ usage record ของ DNA OS เอง

---

## 1. แหล่งต้นทุนที่มีอยู่ในระบบ

| แหล่ง | ตาราง/ไฟล์ | เก็บอะไร | ใช้เป็นต้นทุนจริงได้หรือไม่ |
|---|---|---|---|
| Declared infrastructure | `registry/infrastructure.json` | service, plan, `cost_monthly_thb`, renewal | เป็น **ประกาศของเจ้าของ** ไม่ใช่ใบแจ้งหนี้ |
| SaaS invoice sync | `subscription_services` `20260803000004:12` + `supabase/functions/subscription-email-sync` | ผู้ให้บริการ, amount, currency, cycle, invoice no, email source | ใช้ได้ **เมื่อมีแถวจริง** — จำนวนแถว = `DATA REQUIRED` |
| Supabase billing email | `supabase_billing_events` `20260731000001:10` + `supabase-billing-sync` | USD/THB, invoice, exchange rate, status | ใช้ได้เมื่อมีแถว — `DATA REQUIRED` |
| Company expenses | `company_expenses` + `amount_pre_vat`/`vat_amount` `20260731000004:12` | ค่าใช้จ่ายที่บันทึก/แนบใบ | ใช้ได้ แต่ต้องมีหลักฐานใบกำกับ |
| Partner payable | `partner_payable_requests` `20260727000003:25` | เจ้าหนี้ผู้ขาย/ขนส่ง | เป็น **ต้นทุนบริการ** เมื่อจ่ายจริงเท่านั้น |
| Resource cost | `resource_transactions` (`unit_cost`, `total_cost`) `20260620000000:107` | ต้นทุนเครื่องจักร/เที่ยว | ใช้ได้ถ้ามีแถว — `DATA REQUIRED` |
| AI actual cost | `registry/COST_LEDGER.json` | actual_cost ต่อ request | **entries = 0** — ยังไม่มีต้นทุน AI ที่วัดได้ |

---

## 2. ต้นทุนที่ประกาศไว้ (จาก `registry/infrastructure.json`)

| บริการ | Plan | `cost_monthly_thb` | สถานะ |
|---|---|---|---|
| Supabase | Free | 0 | active |
| Vercel | Hobby | 0 | active |
| OpenAI API | — | 0 | role reassigned / not implemented |
| Anthropic Claude API | — | **null** | pending credential — *ไม่เดาต้นทุน* |
| Google Gemini | Free tier | 0 | active |
| LINE Messaging API | Free (500 msg/เดือน) | 0 | active |
| LINE Notify | Free | 0 | active |
| Google Maps API | $200 free credit/เดือน | 0 | active |
| Gmail API | Free | 0 | active |
| GitHub | Free | 0 | active |
| Domain dnaos.co.th | Annual | **50** | active (renew 2026-09-08) |
| Node.js / Deno runtime | Built-in | 0 | active |

**สรุปตัวเลขที่ยืนยันได้:** fixed cost ที่ประกาศ = **50 THB/เดือน** (600 THB/ปี) · อื่น ๆ = 0 ตาม free tier · Anthropic = `UNKNOWN`
**ยังไม่รวม:** ค่าไฟ/อินเทอร์เน็ต/ค่าแรง/บัญชี/กฎหมาย/ภาษี/ค่าธรรมเนียมรับเงิน — **ไม่มีหลักฐานในระบบ**

---

## 3. การจำแนกประเภทต้นทุน

| ประเภท | รายการ | หลักฐาน | สถานะ |
|---|---|---|---|
| **Fixed** | โดเมน | 50 THB/เดือน (declared) | มีตัวเลข |
| **Fixed** | เครื่องมือพัฒนา/AI subscription | `subscription_services` | `DATA REQUIRED` (ไม่มีจำนวนแถว) |
| **Shared** | Supabase/Vercel/GitHub/Gmail/Maps | declared 0 (free tier) | ใช้งานร่วมทุก tenant — ยังไม่มีกฎจัดสรร |
| **Direct — AI** | token ต่อ request | `worker_usage_events` + `COST_LEDGER` | meter มี, cost = 0 entries → `COST_UNALLOCATED` |
| **Direct — messaging** | ข้อความ LINE เกินโควตา | declared 0 จนถึง 500 msg/เดือน | เกินโควตา = `UNKNOWN` |
| **Direct — storage** | storage/backup | declared 0 (Supabase free) | `COST_UNALLOCATED` |
| **Direct — payment** | ค่าธรรมเนียมรับเงิน | **ไม่มี payment provider integration** | `MISSING` |
| **Variable — compute** | CPU/GPU | `COMPUTE_RESOURCE_REGISTRY` resources = 0 | `MISSING` |
| **Variable — network** | bandwidth | ไม่มี meter | `MISSING` |
| **Operating** | ค่าแรง/บัญชี/กฎหมาย/compliance | ไม่มีในระบบ | `MISSING` |

---

## 4. กฎการจัดสรรที่ยังไม่มี (ต้องตัดสินก่อนคิดกำไร)

1. **Shared cost allocation key** — ต่อ tenant / ต่อ transaction / ต่อ revenue / เท่ากันทุก tenant? (ยังไม่มี)
2. **AI cost attribution** — `worker_usage_events` ไม่มี `tenant_id` จึงแยกต้นทุนต่อลูกค้าไม่ได้
3. **Free-tier boundary** — ใครจ่ายเมื่อเกินโควตา LINE/Supabase/Maps (DNA OS หรือ tenant)
4. **Payment fee** — ยังไม่มีผู้ให้บริการชำระเงิน จึงยังไม่มีอัตราค่าธรรมเนียมจริง
5. **Labor** — ยังไม่มีบันทึกชั่วโมง/เงินเดือนใน schema
6. **Tax treatment** — VAT/WHT ของค่าบริการแพลตฟอร์มต้องมีข้อสรุปทางบัญชี (ยังไม่มี)

---

## 5. ข้อสรุปตัวเลข

| ตัวชี้วัด | ค่า |
|---|---|
| ต้นทุนที่ยืนยันจากเอกสาร/ใบแจ้งหนี้ในรอบนี้ | **0 รายการใหม่** (ไม่ได้เชื่อม DB) |
| ต้นทุนที่ประกาศและมีตัวเลข | 1 รายการ = 50 THB/เดือน |
| ต้นทุนที่ประกาศเป็น 0 | 11 รายการ |
| ต้นทุนที่ประกาศเป็น null โดยไม่เดา | 1 รายการ (Anthropic) |
| AI cost ledger entries | **0** |
| AI budget entries | **0** |
| Compute resources | **0** |
| ต้นทุนต่อธุรกรรมที่วัดได้ | **`COST_UNALLOCATED`** |

> ดังนั้น "กำไรต่อหน่วย" ยังคำนวณไม่ได้ — ไม่ใช่เพราะสูตรไม่ครบ แต่เพราะ **ยังไม่มีต้นทุนจริงต่อหน่วยที่ยืนยันได้**

---

## 6. Production evidence (read-only census 2026-10-25)

| รายการ | ค่าที่วัดได้ | ข้อจำกัด |
|---|---|---|
| `subscription_services` | **825 แถว** · THB **30,026.63** + USD **4,846.32** (ตลอดประวัติ) | 561 แถว ส.ค. / 264 ก.ย.; 66 unique combo → อาจมีใบซ้ำ |
| — ส.ค. 2026 | THB **23,562.63** + USD **4,059.56** | ยังไม่ normalize เป็น monthly burn |
| — ก.ย. 2026 | THB **6,464.00** + USD **786.78** | — |
| `company_expenses` | **149 แถว** · **50,072.95 THB** | pre-VAT รวมเพียง 8,411.21 → ข้อมูลไม่ครบ |
| — ส.ค. 2026 | 126 แถว · **27,622.19** | อาจซ้ำกับ subscription |
| — ก.ย. 2026 | 19 แถว · **7,250.78** | — |
| `supabase_billing_events` | **1 ใบ** · USD **39.51** = THB **1,325.83** | status ยัง `owner_notified` |
| `partner_payable_requests` | **1 รายการ** · **1,325.83** · pending | ตรงกับ Supabase bill |
| `COST_LEDGER` (AI) | **0 entries** แม้มี 104 usage events | actual cost ไม่ถูกบันทึก |
| `COMPUTE_RESOURCE_REGISTRY` | **0 resources** | — |

**ข้อสรุปจากข้อมูลจริง:** ต้นทุนที่ "จับได้" เป็น **ใบ subscription/ใบเสร็จที่ sync เข้ามา** ไม่ใช่บัญชีต้นทุนที่ normalize แล้ว; การบวก `subscription_services` กับ `company_expenses` เข้าด้วยกันอาจ **นับซ้ำ** เพราะไม่มีคีย์กระทบยอด → ต้องรักษาสถานะ `COST_UNALLOCATED` ต่อไปจนกว่าจะมี reconciliation key
