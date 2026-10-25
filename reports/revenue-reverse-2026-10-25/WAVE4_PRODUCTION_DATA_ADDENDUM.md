# WAVE 4 ADDENDUM — READ-ONLY PRODUCTION CENSUS
**วันที่:** 2026-10-25 (snapshot `2026-10-24T21:35:33Z`) · **โครงการ:** `xeytcavxejhyzxwevgto` (DNA OS)
**คำสั่งเจ้าของ:** "ทำ read-only production query นับผู้ใช้/ธุรกรรม/ต้นทุนจริงเพื่อเติม DATA REQUIRED"
**ไฟล์ข้อมูลดิบ (aggregates เท่านั้น):** `production-census-2026-10-25.json`
**สคริปต์:** `scripts/revenue-production-readonly-census.mjs`

---

## 1. วิธีการและขอบเขต (อ่านอย่างเดียว)

| หัวข้อ | รายละเอียด |
|---|---|
| คำสั่งที่ยิง | HTTP **GET/HEAD เท่านั้น** ผ่าน PostgREST — ไม่มี insert/update/delete/rpc ในสคริปต์ |
| สิทธิ์ที่ใช้ | service-role key อ่านจาก Supabase CLI ที่ล็อกอินอยู่ **ในหน่วยความจำ** ไม่พิมพ์/ไม่บันทึก |
| ข้อมูลที่เก็บ | เฉพาะ **count / sum / group count / ช่วงวันที่** |
| ข้อมูลที่ไม่เก็บ | อีเมล, ชื่อ, เบอร์, LINE id, ชื่อบริษัท, เลขใบแจ้งหนี้, token, เนื้อหาเอกสาร |
| RLS | ครั้งแรกที่ลองด้วย anon key ได้ `*/0` ทุกตาราง (RLS บล็อก) — **ตัวเลข 0 นั้นไม่ใช่ข้อเท็จจริง** จึงไม่ใช้; ตัวเลขในรายงานนี้มาจาก service-role read |
| สิ่งที่ยังไม่ตรวจ | `auth.users` (ไม่อยู่ใน public schema), เนื้อหาไฟล์ storage, ความถูกต้องของใบแจ้งหนี้แต่ละใบ |

> **ไม่มีการเขียนใด ๆ ต่อ production** — ไม่มี migration, ไม่มีข้อความ, ไม่เรียกเก็บเงิน

---

## 2. ผู้ใช้ / องค์กร / การยืนยันตัวตน

| ตัวชี้วัด | ค่าจริง | นิยาม |
|---|---|---|
| Auth profiles | **3** | 2 `super_admin`, 1 `customer` (ผู้ใช้ระบบ ไม่ใช่ลูกค้าธุรกิจ) |
| Companies | **86** | 84 CUSTOMER, 1 SUPPLIER, 1 CORE · individual 6 · ACTIVE 86 |
| Connect external identities | **12** | LINE 12 |
| ยืนยันแล้ว (verified) | **8** | 8 distinct subjects |
| ผูกกับบริษัท | **10 บริษัท** | จาก `connect_external_identities.company_id` |
| LINE links | 10 | `company_line_links` |

**Registered** = 86 companies + 3 profiles
**Verified** = 8 identities (ไม่ใช่ 86)
**Active** = **13 companies** (มี order/invoice/debt activity)
**Transacting** = **3 companies** (2 order + 1 invoice customer)
**Paying** = **2 companies** (มี payment allocation)
**Retained (≥2 เดือน)** = **3 companies** (นับรวมกิจกรรม debt ย้อนหลัง — ยังไม่ใช่ retention ของรายได้)

> ห้ามใช้ 86 companies หรือจำนวน LINE followers แทน "ผู้ใช้ที่ทำธุรกรรม" — ตัวเลขที่ใช้ได้คือ **3 transacting / 2 paying**

---

## 3. ธุรกรรม / เอกสาร / GMV / เงินรับ

| ตัวชี้วัด | ค่าจริง | หมายเหตุ |
|---|---|---|
| `customer_orders` | **2** | ทั้งคู่ PAID · ก.ค. 2026 |
| `invoices` | **43** | **VOID 40**, SENT 3 |
| Invoice live (ไม่ VOID) | **3** | GMV **42,192.07 THB** · 1 บริษัท · ผูก order **0 ใบ** |
| `standalone_documents` live | **7** | **60,300.94 THB** · 3 บริษัท |
| `document_canonical` live (ไม่ VOID/quotation) | **10** | **102,493.01 THB** (GMV รวม) |
| `payment_allocations` | **4** | **49,257.80 THB** · 2 บริษัท |
| allocation target | debt 4 · invoice **0** · standalone **0** | เงินรับยังไม่ผูกใบแจ้งหนี้ |
| `receipt_documents` | **495** | ยอดรวม 1,518,138.22 (สลิป/หลักฐาน ไม่ใช่เงินรับ) |
| confirmed receipts | **3** | `ai_read` 492 |
| `debt_events` | **22** | 11 บริษัท · amount รวม 1,677,838.89 |
| `debt_snapshots` | **11** | outstanding **1,573,657.01** · overdue **1,581,015.15** |
| `business_events` | **214** | 9 partners · awaiting_payment_date 143 · quoted 16 |
| Platform fee revenue | **0** | ตาราง `fee_contracts`/`fee_charges`/`revenue_recognitions` = **HTTP 404** |

**อัตราส่วนตามข้อเท็จจริง:** GMV ที่ออกเอกสาร 102,493.01 THB = **0.1025% ของเป้าหมาย 100M** (ตัวเลขนี้เป็นสัดส่วนจริง ไม่ใช่พยากรณ์)
**รายได้ DNA OS ที่รับรู้ = 0** — ทุกอย่างข้างบนเป็น GMV/ลูกหนี้/เงินรับของธุรกิจปฏิบัติการ

---

## 4. การใช้งานระบบ (Usage Evidence)

| ประเภท | ค่าจริง | ข้อสังเกต |
|---|---|---|
| `line_events` | **952** | in 583 / out 369 · มิ.ย. 246, ก.ค. 425, ส.ค. 192, ต.ค. 89 |
| `integration_gateway_events` | **34** | LINE 11 · vscode 20 · supabase 2 · railway 1 |
| `ai_tasks` | **385** | done 128 · **failed 210** · **pending 47** · owner_cline_command 266 |
| `worker_usage_events` | **104** | tokens 132,771 · **FAILED 21** · UNKNOWN token 21 |
| — แยกตาม service | benchmark 89 · code.generate 13 · **handle_text 1 · classify_image 1** | meter ถูกใช้จริงกับลูกค้าเพียง **2 ครั้ง** |
| ช่วงเวลา usage | 2026-08-14 → 2026-08-15 | ไม่ต่อเนื่อง setelahนั้น |
| `api_tokens` | **4** | ใช้แล้ว 3 · revoked 1 · scope `read` ทั้งหมด |
| `document_versions` | 123 | — |
| `document_artifacts` | 46 | image 41 · pdf 5 |
| `storage_resources` | 93 | **193.17 GB** (193,166,499,256 bytes) |
| `storage_evidence` | 71 | — |

**สรุป:** มี event เยอะพอสมควร แต่ **ยังไม่มี billable unit** และ AI meter เกือบทั้งหมดเป็น benchmark ไม่ใช่ลูกค้าจริง

---

## 5. ทรัพยากรธุรกิจ

| ทรัพยากร | ค่าจริง |
|---|---|
| `pit_profiles` | **96** (มี owner profile 15 · ไม่มี 81 · เปิด 26) |
| `pit_materials` | **41** (มีราคา 41 · 6 ชนิดวัสดุ) |
| `material_types` | 11 |
| `vehicle_types` | 8 |
| `customer_sites` | 5 |
| `projects` | 3 |
| `equipment_assets` | **0** |
| `match_queue` | **0** |
| `resource_transactions` | **0** |

> 81/96 แหล่งยังไม่มีเจ้าของที่ยืนยันได้ — เป็นข้อจำกัด authority/การจ่ายเงิน ไม่ใช่ตัวเลขรายได้

---

## 6. ต้นทุนจริงที่เก็บได้ (ยังไม่ normalize)

| แหล่ง | ค่าจริง | ข้อจำกัด |
|---|---|---|
| `subscription_services` | **825 แถว** · lifetime THB **30,026.63** + USD **4,846.32** | 561 แถวใน ส.ค. / 264 ใน ก.ย. · 66 unique provider/service/amount/date · cycle ส่วนใหญ่ null |
| — ส.ค. 2026 | THB 23,562.63 + USD 4,059.56 | เป็นยอดใบที่ sync เข้ามา ไม่ใช่ monthly burn ที่ normalize |
| — ก.ย. 2026 | THB 6,464.00 + USD 786.78 | เดือนยังไม่จบ ณ snapshot? |
| `company_expenses` | **149 แถว** · 50,072.95 THB | subscription 145 · **amount_pre_vat = 0 เกือบทั้งหมด** |
| — ส.ค. 2026 | 126 แถว · 27,622.19 | ซ้ำซ้อนกับ `subscription_services` ได้ |
| — ก.ย. 2026 | 19 แถว · 7,250.78 | — |
| `supabase_billing_events` | **1** · USD 39.51 = THB 1,325.83 | status `owner_notified` ยังไม่ paid |
| `partner_payable_requests` | **1** · 1,325.83 · pending | ตรงกับ Supabase bill |
| `registry/COST_LEDGER.json` | **0 entries** | AI actual cost ไม่ถูกบันทึก |
| `COMPUTE_RESOURCE_REGISTRY` | **0 resources** | — |

**ข้อควรระวัง:** `subscription_services` กับ `company_expenses` อาจเป็น **รายการเดียวกันสองทาง** — ยังไม่มีคีย์กระทบยอดที่พิสูจน์ได้ → ห้ามบวกทั้งสองเป็นต้นทุนรวม
**สถานะ:** ต้นทุนส่วนใหญ่ยัง `COST_UNALLOCATED`; ตัวเลขที่ใช้ได้คือ "ใบที่เก็บได้" ไม่ใช่ "ต้นทุนต่อธุรกรรม"

---

## 7. Data Quality ที่พบ (ต้องแก้ก่อนใช้ตัวเลข)

| # | ข้อค้นพบ | หลักฐาน |
|---|---|---|
| Q1 | ใบแจ้งหนี้ 40/43 เป็น VOID; 37 ใบเป็นยอดเดียวกัน 3,371.04 ซ้ำหลายวัน | ตาราง invoices |
| Q2 | ใบ live 3 ใบไม่ผูก `customer_order_id` | live linked_to_order = 0 |
| Q3 | `payment_allocations` ผูก debt 100% ไม่ผูก invoice/standalone | targets invoice 0 |
| Q4 | `invoices.paid_amount` = 0 ทั้งที่ allocations 49,257.80 | ยอดชำระไม่ได้สะท้อนที่ใบ |
| Q5 | overdue (1,581,015.15) > outstanding (1,573,657.01) | debt_snapshots |
| Q6 | `company_expenses` pre-VAT = 0 เกือบทั้งหมด | 149 แถว, pre-VAT 8,411.21 เท่านั้น |
| Q7 | subscription 825 แถว แต่ unique combo 66 | อาจมีใบซ้ำ/ใบย่อย |
| Q8 | AI tasks ค้าง 47 / failed 210 | ai_tasks |
| Q9 | worker usage มี 2 วัน และส่วนใหญ่ benchmark | worker_usage_events |

---

## 8. ผลต่อข้อสรุป WAVE 4

| เดิม | ใหม่ (มีหลักฐาน production) |
|---|---|
| จำนวนผู้ใช้ = `DATA REQUIRED` | **3 transacting / 2 paying** จาก 86 companies; verified 8 identities |
| จำนวนธุรกรรม = `DATA REQUIRED` | 2 orders · 3 live invoices · 10 live canonical docs |
| GMV = `DATA REQUIRED` | **102,493.01 THB** (ทั้งประวัติที่มีในระบบ) |
| เงินรับ = `DATA REQUIRED` | **49,257.80 THB** allocations |
| ต้นทุน = `DATA REQUIRED` | มีใบที่เก็บได้ 825+149 แถว แต่ **ยัง normalize/กระทบยอดไม่ได้** |
| Platform revenue | **0** — ตาราง fee/revenue ไม่มีจริง (404) |

**ยังสรุปไม่ได้:** ราคาต่อหน่วย, อัตราค่าบริการ, conversion, retention ของรายได้, ต้นทุนต่อธุรกรรม, กำไรต่อหน่วย
**สรุปได้:** ระบบมีธุรกรรมจริงน้อยมาก (หลักหน่วย-สิบ) และ **ยังไม่มีรายได้ DNA OS แม้แต่รายการเดียว**

---

## 9. ข้อจำกัดและสิ่งที่ต้องมีต่อ

1. Snapshot เดียว — ไม่ใช่เวลาเดียวกันทั้งระบบ (แต่ละ GET ต่างเวลาไม่กี่วินาที)
2. Service-role read เห็นทุก tenant — ตัวเลขรวมไม่ใช่ตัวเลขที่ tenant ใดเห็น
3. ไม่ได้ตรวจ `auth.users` จึงแยก "registered แต่ยังไม่ยืนยันอีเมล" ไม่ได้
4. ไม่ได้อ่านเนื้อหาไฟล์/เอกสาร — ไม่ยืนยันความถูกต้องทางบัญชี
5. ต้องมี **เจ้าของยืนยันนิยาม** "ผู้ใช้", "ธุรกรรมที่สำเร็จ", "รายได้ DNA OS" ก่อนใช้ตัวเลขเหล่านี้ในรายงานการเงิน
