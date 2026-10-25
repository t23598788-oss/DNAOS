# DNA OS — 100M REVERSE REVENUE MODEL
**เป้าหมายเจ้าของกิจการ:** `ANNUAL_TARGET = 100,000,000 THB` (ปีแรก)
**สถานะ:** เป้าหมาย ไม่ใช่พยากรณ์ · ตัวเลขที่ต้องใช้คำนวณยังเป็น `UNKNOWN / DATA REQUIRED`
**วันที่:** 2026-10-25

---

## 1. การแบ่งเป้าหมายตามเวลา (คำนวณได้จริง)

| งวด | เป้าหมาย (THB) | สูตร |
|---|---|---|
| ปี | **100,000,000.00** | กำหนด |
| เดือน | **8,333,333.33** | T / 12 |
| สัปดาห์ | **1,923,076.92** | T / 52 |
| วัน (365) | **273,972.60** | T / 365 |
| วันทำการ (260) | **384,615.38** | T / 260 |

> ตัวเลขเหล่านี้เป็น **เลขคณิตของเป้าหมาย** ไม่ได้บอกว่าทำได้จริง

---

## 2. โมเดลรายได้ที่เป็นไปได้ (ยังไม่เลือกรุ่น — เจ้าของต้องตัดสิน)

### Model A — ค่าธรรมเนียมเป็น % ของ GMV
```
Revenue_platform = GMV × f
GMV* = T / f
N_tx* = GMV* / AOV = T / (f × AOV)
```
- `f` = อัตราค่าธรรมเนียมตามสัญญา → **UNKNOWN**
- `AOV` = มูลค่าธุรกรรมเฉลี่ย → **UNKNOWN**
- `N_tx*` = จำนวนธุรกรรมที่ต้องเกิด → **UNKNOWN**

### Model B — ค่าธรรมเนียมคงที่ต่อธุรกรรม
```
N_tx* = T / R_tx
```
- `R_tx` = ค่าบริการต่อธุรกรรม → **UNKNOWN**

### Model C — Subscription ต่อองค์กร
```
Paying_orgs* = T / (ARPA_monthly × 12)
Seats*       = Paying_orgs* × seats_per_org
```
- `ARPA_monthly`, `seats_per_org` → **UNKNOWN**
- ยังไม่มี `organizations`/`org_members` ใน schema → โมเดลนี้ **BLOCKED**

### Model D — Usage-based (API / AI / storage / compute)
```
Units* = T / P_unit
Tokens* = Units* × units_per_token_bucket   (または per-unit basis)
Events* = N_tx* × e
Compute_hours* = Events* × c
```
- `P_unit`, `units_per_*`, `e` (events/tx), `c` (compute/event) → **UNKNOWN**
- ยังไม่มี billable unit / tenant attribution → **BLOCKED**

### Model E — ผสม (มีโอกาสจริงที่สุดในทางโครงสร้าง แต่ยังไม่มีน้ำหนัก)
```
Revenue = Σ_i (GMV_i × f_i) + Σ_j (N_tx_j × R_j) + Σ_k (Units_k × P_k)
T = Σ_i Revenue_i   โดย Σ weight_i = 1
```
- weight ต่อบริการ = **การตัดสินของเจ้าของ** ไม่ใช่ค่าที่ AI ตั้ง

---

## 3. ตารางสิ่งที่ต้องคำนวณ vs สถานะข้อมูล

| ตัวชี้วัด | สูตร | ข้อมูลที่มี | สถานะ |
|---|---|---|---|
| เป้าหมาย/เดือน-สัปดาห์-วัน | T/period | T | ✅ คำนวณได้ |
| จำนวนธุรกรรม/ปี | T / R_tx | ไม่มี R_tx | ❌ UNKNOWN |
| GMV ที่ต้องเกิด | T / f | ไม่มี f | ❌ UNKNOWN |
| จำนวนผู้ใช้ที่ต้องทำธุรกรรม | N_tx / q_user | ไม่มี N_tx, q_user | ❌ UNKNOWN |
| จำนวนพาร์ตเนอร์ | N_tx / q_partner | ไม่มี | ❌ UNKNOWN |
| Processing events | N_tx × e | ไม่มี e | ❌ UNKNOWN |
| Compute capacity | events × c | compute registry = 0 | ❌ UNKNOWN |
| ต้นทุน/ปี | Σ direct + shared | cost ledger = 0 | ❌ UNKNOWN |
| เงินทุนหมุนเวียน | (C/365) × DSO + (C/365) × stock_days | ไม่มี C, DSO | ❌ UNKNOWN |
| ส่วนแบ่งรายบริการ | T × w_i | ไม่มี w_i | ❌ UNKNOWN |

---

## 4. เงื่อนไขที่ทำให้ตัวเลขเป็นจริงไม่ได้ (ข้อจำกัดเชิงโครงสร้าง)

1. **ไม่มีราคาตามสัญญา** — ไม่มี `fee_contracts`/`fee_charges` ในระบบ (`revenue-metering-audit-test` B)
2. **ไม่มีหน่วยบริการที่เรียกเก็บได้** — usage meter ไม่มี tenant/transaction (`test E`)
3. **ไม่มีบัญชีรายได้** — accounting domain = `not_covered`; ไม่มี revenue recognition
4. **ไม่มีต้นทุนต่อหน่วย** — AI cost ledger 0 entries; compute 0 resources
5. **ไม่มีข้อมูลผู้ใช้จริงในรอบนี้** — Registered/Verified/Active/Transacting/Paying ทั้งหมด = `DATA REQUIRED` (ห้ามใช้ LINE friends หรือจำนวนแถว company แทน)
6. **ไม่มีประวัติ conversion/retention** — จึงประมาณจำนวนผู้ใช้ที่ต้องใช้ไม่ได้

> ดังนั้นการตอบว่า "ต้องมีกี่ธุรกรรม/กี่ผู้ใช้" **ตอนนี้ตอบเป็นตัวเลขไม่ได้อย่างซื่อสัตย์** — ตอบได้เฉพาะสมการและรายการข้อมูลที่ต้องเก็บก่อน

---

## 5. ลำดับข้อมูลที่ต้องได้ก่อนคำนวณ (Data Required)

| ลำดับ | ข้อมูล | ที่มาที่เป็นไปได้ | ใช้กับ |
|---|---|---|---|
| D1 | ข้อตกลงค่าบริการ (ใครจ่าย/ฐานใด/อัตรา/ภาษี) | เอกสารสัญญาเจ้าของ | ทุกโมเดล |
| D2 | จำนวนธุรกรรมจริงต่อเดือน + มูลค่าเฉลี่ย | `customer_orders`, `invoices` (ต้อง query production) | A/B |
| D3 | จำนวนผู้ใช้ที่ทำธุรกรรมซ้ำ (distinct) | `customer_company_id`, `connect_external_identities` | ทุกโมเดล |
| D4 | ต้นทุนจริงต่อธุรกรรม | `company_expenses`, `payment_allocations`, `worker_usage_events` + invoice | profit |
| D5 | Conversion/retention | ต้องสร้างจากประวัติธุรกรรมย้อนหลัง | user model |
| D6 | Capacity ต่อ event | benchmark/usage จริง | compute |
| D7 | DSO / payment terms | สัญญา/ใบแจ้งหนี้ | working capital |

---

## 6. ตัวอย่างการใช้สูตร (สัญลักษณ์เท่านั้น — ไม่มีราคาที่เสนอ)

```
ให้ T = 100,000,000
ให้ R_tx = ?           → N_tx = 100,000,000 / R_tx
ให้ f = ? , AOV = ?    → GMV = 100,000,000 / f ; N_tx = GMV / AOV
ให้ ARPA = ?           → Paying_orgs = 100,000,000 / (ARPA × 12)
ให้ P_unit = ?         → Units = 100,000,000 / P_unit
```

**ห้ามตีความว่า `R_tx`, `f`, `ARPA`, `P_unit` คือราคาที่แนะนำ** — เป็นตัวแปรที่ยังไม่มีค่า

---

## 7. เกณฑ์ตัดสินว่าโมเดล "พร้อมใช้"

| เกณฑ์ | ต้องมี |
|---|---|
| มีสัญญา/ราคา | `fee_contracts` + เอกสารอนุมัติเจ้าของ |
| วัดหน่วยได้ | usage event ที่มี tenant + transaction + trace |
| เรียกเก็บได้ | fee charge → ใบแจ้งหนี้/ใบเสร็จ |
| รับเงินได้ | payment allocation ที่กระทบยอดกับ charge |
| รับรู้รายได้ | revenue recognition ที่ไม่นับ GMV/เงินสดซ้ำ |
| ตรวจสอบได้ | reconciliation กับ Canonical Finance + audit |

**สถานะปัจจุบัน: ผ่าน 0/6 ข้อ** → 100M ยังเป็นเป้าหมายที่ยังไม่มีการพิสูจน์ความเป็นไปได้จากข้อมูลจริง

---

## 8. Baseline จริงจาก Production (read-only, 2026-10-25)

| ตัวชี้วัด | ค่าจริง | เทียบกับเป้าหมาย |
|---|---|---|
| GMV ที่ออกเอกสาร (canonical live) | **102,493.01 THB** | **0.1025%** ของ 100M |
| เงินรับที่จัดสรร | **49,257.80 THB** | เป็นเงินของธุรกิจปฏิบัติการ ไม่ใช่รายได้ DNA OS |
| รายได้ DNA OS ที่รับรู้ | **0 THB** | 0% |
| บริษัทที่ทำธุรกรรม | **3** | — |
| บริษัทที่จ่ายเงิน | **2** | — |
| ใบแจ้งหนี้ live | **3** (VOID 40) | — |
| `fee_contracts` / `fee_charges` / `revenue_recognitions` | **ไม่มี (HTTP 404)** | — |

### สิ่งที่ตัวเลขนี้บอก (และไม่บอก)
- **บอกได้:** ระบบมีธุรกรรมจริงในหลักหน่วย-สิบ, มีลูกค้าจ่ายเงิน 2 ราย, และยังไม่มีรายได้แพลตฟอร์ม
- **บอกไม่ได้:** ต้องมีธุรกรรม/ผู้ใช้กี่รายจึงจะถึง 100M — เพราะยังไม่มี `R_tx`, `f`, `AOV`, `ARPA`
- **อัตราส่วนจริง:** ถ้าสมมติฐานคือ fee-based ทุก 100 บาท GMV ต้องมีอัตรา `f` ที่ชัดเจนก่อนจึงแปลงเป็นรายได้ได้ — ตอนนี้ `f = UNKNOWN`

> ห้ามใช้ 102,493.01 ไปคูณหรือ extrapolate เป็นพยากรณ์รายปี — เป็นยอดสะสมของธุรกรรมที่มีอยู่ ไม่ใช่อัตราการเติบโต
