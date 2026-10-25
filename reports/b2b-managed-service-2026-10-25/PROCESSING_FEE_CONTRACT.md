# PROCESSING FEE CONTRACT (ค่าบริการประมวลผล DNA OS)
**วันที่:** 2026-10-25 · **สถานะ:** ข้อเสนอสัญญา + Migration Proposal — **ยังไม่สร้างตาราง ไม่มี migration ถูก apply**
**อ้างอิง:** `B2B_TRANSACTION_LIFECYCLE.md` · `TAX_DOCUMENT_GATE_DESIGN.md` (issuer/กิจการ)

> 🟢 PROVEN · 🟡 โค้ดจริง · 🔴 MISSING · 🔵 PROPOSED

---

## 01 OBJECTIVE

แยก **ยอด A (รายได้ผู้ขาย)** ออกจาก **ยอด B (รายได้ DNA OS)** ให้ชัดในระดับข้อมูล เอกสาร และรายงาน โดย DNA OS ไม่กลายเป็นผู้ขายวัสดุ และไม่หักเงินผู้ขายโดยไม่มีอำนาจ

**เกณฑ์ผ่าน**
1. ยอด A และ B มี issuer คนละราย และมีเอกสารคนละใบ
2. ค่าบริการคำนวณครั้งเดียวต่อธุรกรรม (idempotent) และไม่บวก VAT ซ้ำ
3. ไม่มีการหักค่าบริการจากเงินค่าวัสดุ เว้นแต่มี grant/ข้อตกลงที่อ้างได้
4. รายได้ DNA OS รับรู้ตามเงื่อนไขที่กำหนด ไม่ใช่ตอนส่งข้อความหรือออกเอกสาร
5. ทุกยอดย้อนกลับ source record ได้

---

## 02 SOURCE EVIDENCE — สถานะจริงวันนี้

| ข้อ | ข้อเท็จจริง | หลักฐาน |
|---|---|---|
| F-1 | **ไม่มีแนวคิดค่าบริการประมวลผลในระบบเลย** | grep `processing_fee` / `platform_fee` / `ค่าประมวลผล` ทั้งโปรเจกต์ = 0 ผลใน domain |
| F-2 | `service_fee_amount` ที่มีอยู่เป็นของ `credit_agreements` (สินเชื่อภายใน) | `20261013000001_internal_credit_evidence_integration.sql:16` + `engines/canonical/internal-credit-evidence.ts:12` |
| F-3 | `invoice.serviceFee` เป็นเพียงบรรทัดแสดงผลบนเทมเพลต | `engines/documents/template.ts:103` |
| F-4 | ไม่มีผู้ออกเอกสารในข้อมูล → แยกใบผู้ขาย/ใบ DNA OS ไม่ได้ | TAX audit F1 (`invoices` ไม่มี `issuer_company_id`) |
| F-5 | ไม่มีที่เก็บข้อตกลงค่าบริการ (อัตรา/ฐาน/ผู้จ่าย/เงื่อนไขเกิดสิทธิ์) | ไม่มีตาราง fee/contract ใด ๆ |
| F-6 | ระบบหักเงินอัตโนมัติไม่มีอยู่ (ดี) | ไม่มีเส้นทาง netting; payment allocations ต้องระบุเป้าหมายจริง (`payment-write.ts:238`) |
| F-7 | มีแบบอย่าง "ข้อตกลง + หลักฐาน + สถานะรีวิว" ที่ใช้ได้ | `credit_agreements` + `credit_agreement_receipt_bindings` (🔵 ใช้เป็นแม่แบบ) |

**สรุป:** ขั้นนี้ **🔴 MISSING ทั้งเส้น** — ต้องสร้างโมเดลใหม่ แต่ต้องไม่สร้าง finance writer คู่ขนาน (ใช้ `createDocument` + canonical audit เดิม)

---

## 03 ข้อสัญญาที่ต้องกำหนด (ตัวเลข/เงื่อนไขเป็นของผู้ให้บริการและผู้ขายตกลง — ยังไม่ตัดสินในเอกสารนี้)

### 3.1 คู่สัญญา
| ฝ่าย | บทบาท |
|---|---|
| ผู้ให้บริการ | บริษัท ดีเอ็นเอ โอเอส จำกัด ( issuer ของ **ยอด B** ) |
| ผู้ขายวัสดุ | เฮียอุทัย ( issuer ของ **ยอด A** ) |
| ผู้ซื้อ | บุคคล/กิจการผู้สั่งซื้อจริง (ผู้จ่ายค่าบริการตามข้อ 3.4) |

### 3.2 นิยามยอด
| ยอด | องค์ประกอบ | เจ้าของ | เอกสาร |
|---|---|---|---|
| **A — ค่าวัสดุ** | ค่าวัสดุ + ค่าขนส่ง (ถ้าผู้ขายเป็นคู่สัญญาขนส่งจริง) + ภาษีของผู้ขายตามสถานะกฎหมาย | ผู้ขาย | ใบแจ้งหนี้/ใบกำกับในนาม **ผู้ขาย** |
| **B — ค่าบริการประมวลผล** | ค่าธรรมเนียมต่อธุรกรรม + ค่าบริการระบบตามข้อตกลง + VAT ของ DNA OS | DNA OS | ใบแจ้งหนี้/ใบกำกับในนาม **DNA OS** |

**ห้าม:** รวม A+B ในเอกสารเดียว · หัก B ออกจาก A ในระบบโดยไม่มีสิทธิ์ · นับ A เป็นรายได้ DNA OS

### 3.3 ฐานคำนวณ (ต้องเลือกหนึ่ง — ยังไม่ตัดสิน)
| แบบ | สูตร | ข้อควรระวัง |
|---|---|---|
| FIXED | `fee = ค่าคงที่ต่อธุรกรรม` | ต้องนิยาม "ธุรกรรมที่คิดเงิน" ให้ชัด (ปิดงาน? ส่งมอบ?) |
| PERCENT | `fee = round2(base × rate)` โดย `base` = มูลค่าก่อน VAT ของยอด A | ต้องตรึง base ณ เวลาที่เกิดสิทธิ์ ไม่ใช่ยอดที่แก้ภายหลัง |
| TIERED | ตามช่วงมูลค่า | ต้องเก็บ tier ที่ใช้จริงในฟิลด์ ไม่คำนวณซ้ำภายหลัง |

**กติกากลาง:** คำนวณครั้งเดียว เก็บ `fee_base_amount`, `fee_rate`, `fee_amount`, `fee_currency`, `computed_at`, `rule_version` — **ห้ามคำนวณสดในรายงาน**

### 3.4 ผู้จ่ายและวิธีจ่าย
| ตัวเลือก | ผลทางบัญชี | ต้องมี |
|---|---|---|
| ผู้ซื้อจ่าย DNA OS แยก | เงินเข้า 2 ทางชัดเจน (แนะนำ) | เอกสาร 2 ใบ + บัญชีรับเงิน 2 บัญชี |
| ผู้ขายจ่าย DNA OS | DNA OS ออกใบในนามผู้ขาย | ข้อตกลงค่าบริการ + ใบเสร็จ |
| หักจากเงินค่าวัสดุ | **ต้องมีอำนาจชัด** | `authority_grant` scope `deduct_fee` + หลักฐานยินยอม + การบันทึกยอดหักแยก |

**ห้ามเด็ดขาด:** หักเงินผู้ขายจากยอดที่ผู้ซื้อโอนให้ผู้ขาย โดยไม่มี grant/ข้อตกลงที่อ้างได้ — และแม้มี ต้องบันทึกเป็นรายการแยก (gross คงเดิม, fee เป็นรายการของตัวเอง)

### 3.5 เงื่อนไขเกิดสิทธิ์ (Service Fee Earned)
ต้องมี **เหตุการณ์ที่ตรวจสอบได้** อย่างน้อยหนึ่ง:
- `delivery_confirmed` (ส่งมอบครบตามเอกสาร) **และ** ผู้ขายยืนยัน
- หรือ `payment_verified` (เงินเข้าจริงตาม `receipt_documents` + `payment_allocations`)
- **ไม่ใช่**: ส่งข้อความสำเร็จ, ออกใบเสนอราคา, มีคำสั่งซื้อ

### 3.6 ภาษี
- ค่าบริการเป็น **การให้บริการของผู้ให้บริการ** → VAT เป็นของ DNA OS ตามสถานะจดทะเบียนของ DNA OS (อัตรา ณ วันออก ไม่ hardcode)
- ห้ามนำ VAT ของผู้ขายมาคำนวณซ้ำในยอด B และห้ามนำ VAT ของ B ไปปนในเอกสาร A
- WHT (ถ้ามีการหัก ณ ที่จ่าย) ต้องเป็นฟิลด์แยก + หนังสือรับรองแยกเอกสาร

---

## 04 MODELS (🔵 PROPOSED — Migration Proposal เท่านั้น ยังไม่ apply)

### 4.1 `fee_contracts`
```
id, provider_company_id, seller_company_id,
basis            text check in ('fixed','percent','tiered'),
rate             numeric null,       -- percent
fixed_amount     numeric null,       -- fixed
tiers            jsonb null,         -- tiered: [{from,to,rate}]
currency         text default 'THB',
payer            text check in ('buyer','seller'),
deduct_allowed   boolean not null default false,  -- true ต้องมี authority_grant อ้างอิง
trigger_event    text check in ('delivery_confirmed','payment_verified'),
vat_applicable   boolean,
valid_from date not null, valid_to date not null,
evidence_artifact_id uuid,           -- สัญญา/ข้อตกลง (sha256)
status           text check in ('draft','active','terminated'),
created_by, created_at
```
ข้อบังคับ: 1 คู่ (provider, seller) มี active contract ได้ครั้งละ 1 ฉบับ (partial unique)

### 4.2 `fee_charges` (หนึ่งแถวต่อธุรกรรม — idempotent)
```
id, transaction_id (customer_orders.id), fee_contract_id,
seller_company_id, provider_company_id,
fee_base_amount, fee_rate, fee_amount, vat_amount, wht_amount, net_payable,
currency, rule_version, computed_at,
state text check in ('pending','earned','invoiced','paid','waived','voided'),
earned_event_id (business_events.id), invoice_id (เอกสาร B),
idempotency_key text unique        -- เช่น fee:<transaction_id>
```
**ห้าม** คำนวณ fee ซ้ำ: unique `idempotency_key`

### 4.3 `fee_charge_events` (append-only)
`fee_charge_id, event (computed|earned|invoiced|paid|waived|voided), at, actor, evidence jsonb`

### 4.4 การรับรู้รายได้ (ไม่สร้างตารางบัญชีใหม่)
- ใช้ `tax_register_entries` (TAX design §4.6) โดย `company_id = provider_company_id`, `entry_kind='output_vat'` สำหรับยอด B
- ยอด A อยู่ฝั่งผู้ขาย (`company_id = seller_company_id`)
- รายงานต้องแยก issuer — ห้ามรวมเป็นก้อนเดียว

---

## 05 CONTRACT ของการคำนวณ (รูปแบบที่ต้องบังคับในโค้ด)

```
computeFee(transaction, contract, at):
  1. contract ต้อง active ณ `at` และคู่สัญญาตรงกับผู้ขาย/ผู้ให้บริการของธุรกรรม
  2. base = มูลค่าก่อน VAT ของยอด A ที่ถูก freeze แล้ว (จาก version snapshot ไม่ใช่ยอดสด)
  3. fee = fixed | round2(base × rate) | tier(base)
  4. vat = vat_applicable ? round2(fee × rate_at(at)) : 0
  5. fee_charge ถูกสร้างด้วย idempotency_key = fee:<transaction_id>
     ถ้ามีอยู่แล้ว → คืนแถวเดิม ไม่คำนวณใหม่
  6. state = pending จนถึง trigger_event จริง → earned
  7. invoiced เมื่อมีเอกสาร B (createDocument) ; paid เมื่อ allocation จริง
```
**ห้าม:** คำนวณซ้ำเมื่อ retry · คำนวณจากยอดที่แก้ภายหลัง · บวก VAT สองรอบ · ปัดเศษต่างกันในแต่ละที่ (ใช้ `round2` เดียวทั้งระบบ)

---

## 06 INVARIANTS (ต้องมี verifier)

| # | invariant | verifier proposed |
|---|---|---|
| I1 | ไม่มี fee_charge ที่ไม่มี contract active | `fee_requires_active_contract` |
| I2 | 1 ธุรกรรม ≤ 1 fee_charge | unique + `fee_single_charge_per_transaction` |
| I3 | fee ไม่คิดบนธุรกรรม CANCELLED | `no_fee_on_cancelled` |
| I4 | ยอด A ไม่ปรากฏในรายงานของ DNA OS | `seller_revenue_not_in_provider_reports` |
| I5 | fee invoiced ต้องมี issuer = provider | `fee_invoice_issuer_is_provider` |
| I6 | ถ้า `deduct_allowed` ต้องมี authority grant ที่ยังมีผล | `fee_deduction_requires_grant` |

---

## 07 ผลกระทบต่อของเดิม (ไม่สร้าง writer คู่ขนาน)

| งาน | ใช้ของเดิม | ห้ามทำ |
|---|---|---|
| ออกเอกสาร B | `createDocument` (kind=invoice) + issuer=DNA OS | เขียน `invoices` ตรง |
| บันทึกค่าใช้จ่ายฝั่งผู้ขาย (ถ้าจ่ายค่าบริการ) | `recordCompanyExpense` + field ภาษี (TAX §4.7) | สร้างตารางค่าใช้จ่ายใหม่ |
| รับเงินค่าบริการ | `receipt_documents` + `confirmPayment` (allocation → เอกสาร B) | นับ `payment_verified` เป็นเงิน |
| audit | `recordCanonicalAudit` | เขียน audit เอง |
| รายงาน | `tax_register_entries` แยก issuer | รวม A+B |

---

## 08 Test matrix (mock — ยังไม่รัน)

| # | กรณี | ต้องได้ |
|---|---|---|
| F1 | คำนวณ fee 2 ครั้ง (retry) | 1 แถว, ยอดเดิม |
| F2 | ไม่มี contract | ปฏิเสธ `FEE_CONTRACT_REQUIRED` |
| F3 | contract หมดอายุ ณ วันเกิดสิทธิ์ | ปฏิเสธ |
| F4 | ธุรกรรม CANCELLED | ไม่มี fee_charge |
| F5 | fee + VAT | VAT คิดครั้งเดียวตามอัตรา ณ วันออก |
| F6 | ออกเอกสาร B | issuer = DNA OS, ลูกค้า = ผู้จ่าย |
| F7 | รายงาน | ยอด A ไม่อยู่ในรายงาน DNA OS |
| F8 | หักค่าบริการโดยไม่มี grant | ปฏิเสธ `FEE_DEDUCTION_FORBIDDEN` |

---

## 09 สิ่งที่ต้องตัดสินใจ (blocking)

1. ฐานคิดค่าบริการ (fixed / percent / tiered) และอัตราจริง
2. ผู้จ่าย = ผู้ซื้อ หรือ ผู้ขาย (หรือผสมตามเงื่อนไข)
3. เงื่อนไขเกิดสิทธิ์: ส่งมอบ หรือ เงินเข้า หรือทั้งคู่
4. อนุญาตให้หักจากเงินค่าวัสดุหรือไม่ (ถ้าใช่ → ต้องมีหนังสือยินยอมรูปแบบใด)
5. DNA OS จดทะเบียน VAT อยู่หรือไม่ และออกใบกำกับค่าบริการในนามใด (เลขภาษี/สาขา)
6. นโยบายยกเว้น/คืนค่าบริการ (waive/refund) และผู้อนุมัติ

> ทั้งหมดนี้ยังเป็น **ข้อเสนอ + Migration Proposal** ตามข้อห้าม "ห้าม Apply Production Migration"
