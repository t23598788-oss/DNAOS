# DNA OS — MONETIZATION DEVELOPMENT ROADMAP
**วันที่:** 2026-10-25 · **หลักการ:** เรียงลำดับจาก "หลักฐานที่มีจริง" ไม่ใช่กำไรที่ AI สมมติ
**สถานะปัจจุบัน:** ยังไม่มีบริการใดที่ "พร้อมเรียกเก็บเงิน" — มีเพียงความสามารถที่ทำงานได้และ meter บางส่วน

---

## 1. เกณฑ์จัดลำดับ (ใช้ตามลำดับ)

| ลำดับ | เกณฑ์ | ความหมาย |
|---|---|---|
| 1 | Source Code รองรับ | มี writer/route/ตารางจริง |
| 2 | ผ่าน Test จริง | มี test ใน repo และรันผ่าน |
| 3 | ผู้ใช้/พาร์ตเนอร์เข้าถึงได้ | มีช่องทาง (LINE/admin/API) |
| 4 | มีข้อตกลงเรียกเก็บ | มีสัญญา/ราคา (ยังไม่มีเลย) |
| 5 | ต้นทุนวัดได้ | มี usage + cost record |
| 6 | ช่องทางเก็บเงิน/กระทบยอด | charge → invoice → allocation |
| 7 | ข้อกำหนดกฎหมาย | ภาษี/ใบกำกับ/ความเป็นส่วนตัว |

> ลำดับที่ได้จึงเป็น **ลำดับความพร้อมทางวิศวกรรม** ไม่ใช่ลำดับผลกำไร

---

## 2. Roadmap ตามระยะ

### Phase 0 — Owner decisions (BLOCKED ถ้าไม่มี)
ต้องตัดสินก่อนเขียนโค้ดใด ๆ:
1. บริการแรกที่จะคิดเงิน (แนะนำ: ค่าประมวลผลเอกสาร — มีหลักฐานครบที่สุด)
2. ผู้จ่าย (ผู้ซื้อ/ผู้ขาย/DNA OS ดูดจาก margin)
3. ฐานคิดเงิน (ต่อธุรกรรม / % GMV / ต่อฉบับ / ต่อ token)
4. อัตรา + ภาษี (VAT 7%, WHT หรือไม่)
5. นโยบายยกเลิก/คืนเงิน/แก้ไขใบแจ้งหนี้
6. คำนิยาม "รายได้ DNA OS" ที่แยกจาก GMV อย่างเป็นทางการ

**ผลลัพธ์:** เอกสาร `FEE_POLICY.md` ที่เจ้าของลงนาม — ไม่ใช่การตั้งราคาโดย AI

### Phase 1 — Revenue attribution foundation (BUILD)
| งาน | รายละเอียด | Test |
|---|---|---|
| Service Type Registry | รายการบริการที่คิดเงินได้ + หน่วย | registry ต้องตรงกับ code |
| Tenant binding | เพิ่ม `company_id`/`tenant_id` ใน usage ที่ต้องคิดเงิน | cross-tenant isolation |
| Billable usage events | `usage_events(tenant, service, transaction, trace, quantity, unit)` + unique key | duplicate event ไม่เพิ่มหน่วย |
| Fee contract & charge | `fee_contracts`, `fee_charges` (immutable, unique per transaction+contract) | charge ซ้ำไม่ได้ |
| Revenue recognition | `revenue_recognitions` (charge → รับรู้เมื่อใด) | รับรู้ซ้ำไม่ได้ |

**Exit:** วัดหน่วยบริการได้ 1 ประเภท และออก charge ได้โดยยังไม่ต้องเก็บเงิน

### Phase 2 — เชื่อมค่าบริการเข้ากับธุรกรรมจริง (CONNECT)
- เรียก fee resolver จาก `transaction-write` **หลัง** ธุรกรรมสำเร็จ (ไม่ใช่ก่อน)
- `engines/pricing.ts` ยังใช้เป็นสูตรต้นทุน/ markup แต่ **ห้ามให้ AI ตั้งราคา** — อัตรามาจาก contract
- เพิ่ม fee เป็นรายการใบแจ้งหนี้แยก (ไม่ปนกับมูลค่าสินค้า)
- Test: GMV ไม่ถูกนับเป็นรายได้; fee 1 ครั้งต่อธุรกรรม; void/แก้ไขมี reversal

**Exit:** ธุรกรรมจริง 1 รายการ → fee charge 1 รายการ → ใบแจ้งหนี้มีบรรทัดค่าบริการ

### Phase 3 — เก็บเงินและกระทบยอด (CONNECT)
- `fee_charge` → invoice → `payment_allocations`
- revenue reader อ่านเฉพาะ `revenue_recognitions` (ไม่ใช่ invoice gross)
- Test: จ่ายบางส่วน/จ่ายเกิน/จ่ายซ้ำ; allocation ต้องไม่ทำให้รายได้เพิ่มสองรอบ

**Exit:** charge ที่ออกแล้วได้รับชำระและ reconcile กับ Canonical Finance ได้

### Phase 4 — เอกสาร/ตรวจสอบ (CONNECT)
- document issued → billable event
- verification/OCR → billable event (แยกจากค่าธรรมเนียมการเงิน)
- ต้องมี idempotency จาก `document_version_id` / `receipt_document_id`

### Phase 5 — API ภายนอก (BUILD)
- `api_usage_events` ต่อ request (token_id, endpoint, status, latency, occurred_at, request_id UNIQUE)
- rate limit + quota ต่อ tenant
- ป้องกัน: request ซ้ำ/retry ไม่คิดเงินซ้ำ

### Phase 6 — AI / Storage / Compute (CONNECT + BUILD)
- AI: ผูก `worker_usage_events` กับ tenant/transaction; เติม cost ledger ให้มี actual cost
- Storage: GB-month จาก `storage_resources`
- Compute: ต้องมี resource ลงทะเบียนก่อน (ปัจจุบัน 0)
- ทุกกรณี: ถ้าไม่มีต้นทุนจริง → `UNKNOWN` ไม่ใช่ 0

### Phase 7 — องค์กร / ERP / E-commerce (BLOCKED)
- ต้องมี organization model + membership + plan/seat
- ต้องมี connector ที่ live + สัญญา
- ยังไม่ควรเริ่มจนกว่า Phase 1–3 ผ่าน

---

## 3. ลำดับที่แนะนำ (พร้อมเหตุผลจากหลักฐาน)

| ลำดับ | งาน | เหตุผล |
|---|---|---|
| 1 | Fee policy + one service definition | ไม่มีราคา/ผู้จ่าย = ทุกอย่าง BLOCKED |
| 2 | Fee contract + charge + recognition schema | ไม่มีที่เก็บ = วัดรายได้ไม่ได้ |
| 3 | Tenant binding on usage | ปัจจุบัน usage ไม่มี tenant |
| 4 | Wire fee to transaction + invoice | transaction/document พร้อมที่สุด |
| 5 | Reconciliation reader | ต้องพิสูจน์ว่าไม่นับซ้ำ |
| 6 | API metering | มี token auth แต่ไม่มี request log |
| 7 | AI/Storage/Compute | meter มีบางส่วน แต่ต้นทุนจริงยัง 0 |
| 8 | Org subscription / ERP | ติด schema และสัญญา |

---

## 4. จุดเริ่มต้นที่เล็กที่สุดที่วัดรายได้จากธุรกรรมจริง 1 รายการได้ครบ

**เป้าหมาย:** ธุรกรรมจริง 1 รายการ → ค่าบริการ 1 รายการ → ใบแจ้งหนี้ 1 ใบ → รับเงิน → รับรู้รายได้ → ตรวจสอบย้อนกลับได้

### 4.1 สิ่งที่ต้องมี (ขั้นต่ำสุด)
1. **Fee contract 1 แถว** — บริการเดียว, ผู้จ่ายชัด, อัตราเดียว, วันมีผล
2. **Fee charge 1 แถว** — ผูก `customer_order_id` + `contract_id`, UNIQUE, เก็บ `amount`, `currency`, `tax`
3. **Invoice line** — บรรทัดค่าบริการบนใบแจ้งหนี้เดิม (ไม่สร้างใบใหม่/ไม่สร้าง AR คู่ขนาน)
4. **Recognition row** — รับรู้เมื่อ invoice issued (หรือเมื่อส่งมอบตามนโยบาย)
5. **Payment allocation** — ใช้ `payment_allocations` เดิมในการรับเงิน
6. **Revenue reader 1 ตัว** — `SUM(recognitions)` แยก service/tenant/เดือน
7. **Audit** — ทุกการออก/กลับรายการ charge มี `audit_logs`

### 4.2 เส้นทางข้อมูล
```
customer_order (transaction)
  → fee_contract (อัตราตามสัญญา)
  → fee_charge (unique per order+contract)
  → invoice line (ค่าบริการ)
  → invoice issued
  → revenue_recognition (รับรู้)
  → payment_allocations (เงินรับ)
  → revenue reader (รายงาน)
```

### 4.3 Test ขั้นต่ำที่ต้องผ่าน
| Test | เกณฑ์ |
|---|---|
| T1 charge ซ้ำ | event/คำสั่งเดิม → charge เดิม ไม่เพิ่ม |
| T2 GMV≠revenue | reader ไม่อ่าน `invoices.total_amount` เป็นรายได้ |
| T3 cash≠revenue | รับเงินบางส่วนไม่ทำให้ recognition เพิ่ม |
| T4 tenant isolation | query ข้ามบริษัทไม่ได้ |
| T5 reversal | void invoice → reversal row ไม่ลบประวัติ |
| T6 reconciliation | `SUM(charges)` = `SUM(invoice fee lines)` |
| T7 unknown | ไม่มีอัตรา/สัญญา → `UNPRICED` ไม่ใช่ 0 |

### 4.4 สิ่งที่ยัง **ห้ามทำ** ในขั้นนี้
- ห้ามสร้าง Finance Writer/Ledger คู่ขนาน
- ห้ามให้ AI กำหนดราคา/อนุมัติ
- ห้ามนับ GMV หรือเงินสดเป็นรายได้
- ห้าม apply migration production โดยไม่มีเจ้าของอนุมัติ

### 4.5 เกณฑ์สำเร็จ
> ธุรกรรมจริง 1 รายการต้องตอบได้ว่า: ใครจ่าย, จ่ายเท่าไร, ใบไหน, รับเงินหรือยัง, รับรู้เมื่อไร, และตัวเลขในรายงานย้อนกลับไปหา `fee_charge_id` เดียวได้

---

## 5. สถานะรวม

| ระยะ | สถานะ |
|---|---|
| Phase 0 | **BLOCKED** — รอเจ้าของตัดสินนโยบาย |
| Phase 1 | BUILD — ยังไม่มี schema |
| Phase 2 | CONNECT — transaction/document พร้อม แต่ยังไม่มี fee |
| Phase 3 | CONNECT — payment allocation พร้อม |
| Phase 4 | CONNECT — document/verification พร้อม |
| Phase 5 | BUILD — ไม่มี request log |
| Phase 6 | CONNECT/BUILD — meter บางส่วน, cost = 0 |
| Phase 7 | BLOCKED — ไม่มี org model/สัญญา |

> ไม่มีตัวเลขรายได้/กำไรคาดการณ์ในเอกสารนี้ — เพราะยังไม่มีข้อมูลราคา ต้นทุน หรือ conversion ที่พิสูจน์ได้
