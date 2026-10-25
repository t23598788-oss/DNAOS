# DOCUMENT & TAX GATE MATRIX (B2B)
**วันที่:** 2026-10-25 · **สถานะ:** ตรวจของจริง + matrix — **ไม่มี migration ถูก apply, ไม่มีการออกเอกสารจริงในรอบนี้**
**อ้างอิง:** `TAX_CURRENT_STATE_AUDIT.md` (F1–F16) · `TAX_DOCUMENT_GATE_DESIGN.md` (G1–G6) · `B2B_TRANSACTION_LIFECYCLE.md`

> 🟢 PROVEN · 🟡 โค้ดจริง · 🔴 MISSING/FAIL · 🔵 PROPOSED

---

## 01 OBJECTIVE

ตอบคำถามเดียว: **ก่อนออกเอกสาร (หรือบันทึกภาษี) ในธุรกรรม B2B ระบบบังคับอะไรได้จริงวันนี้ และอะไรยังบังคับไม่ได้**
พร้อมกำหนดว่าเอกสาร 2 ใบในธุรกรรมเดียว (ของผู้ขาย และของ DNA OS) ต้องแยกกันอย่างไร

**เกณฑ์ผ่าน**
1. ออกเอกสารในนามผู้ขายจริงได้ และ DNA OS ปรากฏเฉพาะผู้ให้บริการระบบ
2. ใบผู้ขายกับใบ DNA OS เป็นคนละเอกสารภายใต้ธุรกรรมเดียว
3. ข้อมูลภาษี/สิทธิ์ไม่ครบ → ได้เฉพาะ Draft/Pending Review
4. ทุกการออกมี audit + version ที่ตรวจได้

**ผลรวม: 🔴 FAIL (3/10 gates ผ่าน)** — โครงเขียนเอกสารแข็งแรง แต่ gate ตัวตน/ภาษี/อำนาจยังไม่มี

---

## 02 MATRIX หลัก — gate × สถานะจริง

| # | Gate | ข้อกำหนด | ของจริงวันนี้ | หลักฐาน | ผล |
|---|---|---|---|---|---|
| G1a | ผู้ออกเอกสาร (ผู้ขาย) | ต้องระบุ issuer ในข้อมูล | ไม่มีคอลัมน์ issuer; ผู้ขายมาจาก config global | TAX F1, F2 (`invoices`; `core/config/company-settings.ts`) | 🔴 |
| G1b | snapshot คู่สัญญา | ชื่อ/เลขภาษี/ที่อยู่/สาขา ผู้ซื้อ+ผู้ขาย ณ วันออก | ไม่มี; พิมพ์จาก FK สด | TAX F6 (`buildVersionSnapshot` ไม่มี parties) | 🔴 |
| G1c | ผู้รับเงินจริง | บัญชีต้องผูกกับ issuer | config global `payment-bank-*`; `receipt_documents` แยกจากเอกสาร | TAX F7 | 🔴 |
| G1d | เจ้าของรายการ | profile จริง | audit actor เป็น email, `actor_user_id=null` | TAX F8 (`audit.ts`) | 🔴 |
| G2 | อำนาจทำแทน | grant + ขอบเขต + วันมีผล + วงเงิน | ไม่มีโมเดลอำนาจ; `pending_authorizations` ข้อความอิสระ | TAX F10; `full_schema` L1329 | 🔴 |
| G3a | สถานะ VAT ผู้ออก | ต้องจดทะเบียน ณ วันออก | ไม่มี field ที่ไหนเลย | TAX F4 (`companies`) | 🔴 |
| G3b | ชนิดเอกสารตามกฎหมาย | มี tax invoice/debit/credit/WHT | `DocType` ไม่มี | TAX F3 (`engines/documents/types.ts`) | 🔴 |
| G3c | องค์ประกอบใบกำกับ | ครบทุกองค์ประกอบ + ห้าม fallback ผู้ออก | ไม่ครบ; fallback "DNA OS" | `engines/documents/template.ts:137` | 🔴 |
| G3d | อัตรา VAT | ตามอัตราที่มีผล ไม่ hardcode | `vat_rate: input.vatEnabled ? 7 : 0` | `document-write.ts#computeCanonicalTotals` | 🔴 |
| G4 | แยกกิจการ | ไม่โอนสิทธิ์/ไม่รวมยอดข้าม | ไม่มี issuer, ไม่มี company scope | TAX F9, F16 | 🔴 |
| G5a | writer เดียว | ทุกเส้นทางผ่าน canonical | เอกสาร ✔ · ราคา/คำตอบผู้ขาย ✘ | `document-authority-census.test` ผ่าน 58 ข้อ แต่ `supplier-quote-reply.ts` เขียน `pit_materials` ตรง | 🟡 ครึ่ง |
| G5b | atomic | header+items+version ครั้งเดียว | `confirm_invoice` RPC (invoice) ✔ · standalone ยัง TS หลายขั้น (มี compensating void) | `20260923000004`; `document-write.ts` | 🟡 ครึ่ง |
| G5c | version + ห้ามลบ | append-only + void | ✔ `document_versions` + `voidDocument` | `20260922000001:88–103` | 🟢 |
| G5d | audit ตรวจสอบได้ | actor/trace/hash | actor null, หลักฐานยัดใน `new_value`, ไม่มี hash | TAX F14 | 🔴 |
| G5e | เลขเอกสาร | ชุดเลขต่อ issuer/kind/ปี ไม่ขาด | unique global ✔ แต่ caller กำหนดเลขเอง + fallback `Date.now()` | TAX F15 | 🔴 |
| G6 | ข้อมูลไม่ครบ = รอตรวจ | ต้องมีสถานะ pending, ห้ามเข้า report | `data_completeness="FULL"` เสมอ; ไม่มี pending | TAX F13 | 🔴 |

**สรุป: ผ่านชัดเจน = G5c (version/no-delete) · ผ่านครึ่ง = G5a, G5b · ที่เหลือไม่ผ่าน**

---

## 03 เอกสาร 2 ใบในธุรกรรมเดียว — matrix ที่ต้องได้

| ด้าน | ใบ A (ผู้ขาย) | ใบ B (DNA OS) |
|---|---|---|
| issuer | บริษัท/บุคคลผู้ขาย (เฮียอุทัย) | บริษัท ดีเอ็นเอ โอเอส จำกัด |
| counterparty | ผู้ซื้อจริง | ผู้จ่ายค่าบริการ (ผู้ซื้อ/ผู้ขายตามสัญญา) |
| รายการ | ค่าวัสดุ (+ขนส่งถ้าเป็นคู่สัญญาจริง) | ค่าประมวลผล/ค่าบริการระบบ |
| VAT | ตามสถานะผู้ขาย | ตามสถานะ DNA OS |
| บัญชีรับเงิน | บัญชีที่ผู้ขายยืนยัน | บัญชี DNA OS |
| เอกสารอ้างอิง | `customer_order_id` เดียวกัน | `customer_order_id` เดียวกัน + `fee_charge_id` |
| รายงาน | รายได้ผู้ขาย | รายได้ DNA OS (ห้ามปน) |
| ห้าม | ใส่ชื่อ DNA OS เป็นผู้ขาย | ใส่ค่าวัสดุเป็นรายการในใบ B |

**สถานะจริง:** ทำไม่ได้ทั้งสองฝั่งเพราะไม่มี `issuer_company_id` (G1a) — และใบ B ยังไม่มีที่มาของยอด (ไม่มี fee model, `PROCESSING_FEE_CONTRACT.md`)

---

## 04 กฎ "Draft/Pending Review เท่านั้น" — ตรวจพฤติกรรมจริง

| เส้นทาง | พฤติกรรมวันนี้ | ผล |
|---|---|---|
| `POST /api/admin/documents` (สร้าง) | ตั้ง `invoice_status='DRAFT'` / standalone `'active'` — **ไม่มี gate ใด ๆ** | 🟡 สร้างเป็น draft ได้ แต่ไม่มีอะไรกันการออก |
| `POST /api/admin/documents/[id]/confirm` (ออก) | เปลี่ยน `DRAFT → SENT` ทันทีถ้ามี line items | 🔴 **ออกได้โดยไม่มีองค์ประกอบภาษี/ผู้ออก/อำนาจ** |
| `updateDocumentDraft` | แก้ได้จนกว่าจะ VOID | 🟡 ไม่ผูกกับ gate |
| `voidDocument` | VOID + version (ไม่ลบ) | 🟢 ถูกต้อง |
| standalone document | ไม่มี atomic path (TS หลายขั้น + compensating void) | 🟡 ยอมรับได้แต่ต้องรายงาน |

→ ข้อกำหนด STEP 05 ("ถ้าข้อมูลไม่ครบ ให้สร้างได้เฉพาะ Draft/Pending Review ห้ามออกใบกำกับจริง") **ยังไม่ถูกบังคับ** เพราะไม่มีทั้ง gate และสถานะ pending

---

## 05 Mapping กับ 6 เงื่อนไขของเจ้าของ (จากรอบ TAX)

| เงื่อนไข | gate ที่ปิด | สถานะ B2B |
|---|---|---|
| 1 ผู้ซื้อ/ผู้ขาย/ผู้รับเงิน/เจ้าของ | G1a–G1d | 🔴 |
| 2 อำนาจ+ขอบเขต+วันมีผล | G2 | 🔴 |
| 3 VAT + องค์ประกอบใบกำกับ | G3a–G3d | 🔴 |
| 4 แยกกิจการ | G4 | 🔴 |
| 5 writer เดียว + evidence chain | G5a–G5e | 🟡 2/5 |
| 6 ไม่ชัด = รอตรวจ | G6 | 🔴 |

---

## 06 MIGRATION PROPOSAL (🔵 ยังไม่ apply — ต้องอนุมัติ)

รายการเดียวกับ `TAX_DOCUMENT_GATE_DESIGN.md` §4 (ไม่สร้างซ้ำ):
`company_tax_profiles` · `company_bank_accounts` · คอลัมน์ issuer/parties/tax_status บน `invoices`+`standalone_documents` · `authority_grants` · `document_number_series`/`allocations` · `tax_register_entries` · ขยาย field ภาษีของ `recordCompanyExpense`

**เพิ่มเฉพาะ B2B (จาก lifecycle/fee):**
- `customer_orders` ไม่ต้องเพิ่มคอลัมน์ผู้ขาย — ผู้ขายมาจากเอกสาร (`issuer_company_id`) ไม่ใช่จาก order (หลีกเลี่ยงการตีความว่าผู้ขาย = ลูกค้า)
- `fee_charges.invoice_id` อ้างเอกสาร B (ตาม `PROCESSING_FEE_CONTRACT.md` §4.2)
- `seller_responses` (ตาม `SELLER_LINE_AUTOMATION.md` §7) เพื่อเป็นหลักฐาน "ยืนยันการขาย" ก่อนออกเอกสาร

**ลำดับที่ปลอดภัย:** P1 (issuer+parties) → P2 (authority) → P3 (VAT/kind/series) → P4 (register/claim) — ห้ามข้าม P2 ไป P3 เพราะการออกใบกำกับโดยไม่มีอำนาจคือความเสี่ยงสูงสุด

---

## 07 Test cases (จาก STEP 07 — เฉพาะเอกสาร/ภาษี)

| # | กรณี | เกณฑ์ | รันได้วันนี้ | ผล |
|---|---|---|---|---|
| D1 | เอกสารผู้ขายไม่แสดง DNA OS เป็นผู้ขาย | ไม่มี fallback | 🟡 อ่านโค้ดได้ | 🔴 FAIL (`template.ts:137`) |
| D2 | ค่าวัสดุไม่เข้า revenue DNA OS | แยก issuer | 🔴 ต้องมี issuer | 🔴 BLOCKED |
| D3 | ใบผู้ขาย + ใบ DNA OS = คนละใบ ธุรกรรมเดียว | 2 เอกสาร 2 issuer | 🔴 | 🔴 BLOCKED |
| D4 | ไม่มีสิทธิ์ผู้ขาย → fail-closed | ปฏิเสธ | 🔴 ไม่มี grant | 🔴 BLOCKED |
| D5 | ข้อมูลภาษีไม่ครบ → Pending Review | ไม่ได้ issued | 🔴 ไม่มีสถานะ | 🔴 FAIL |
| D6 | audit ล้ม → ไม่มีการเขียนบางส่วน | rollback | 🟡 invoice = atomic RPC ✔ | 🟡 PARTIAL |
| D7 | ออกแล้วแก้ไม่ได้ | VOID เท่านั้น | 🟢 | ✅ PASS |
| D8 | version เก็บ snapshot ครบ | มี money ladder | 🟢 (เงิน) / 🔴 (ภาษี) | 🟡 PARTIAL |
| D9 | เลขเอกสารไม่ซ้ำ | unique | 🟢 global unique | ✅ PASS |
| D10 | เลขเอกสารไม่ขาดต่อชุด | series | 🔴 | 🔴 BLOCKED |
| D11 | รายงานแยกกิจการ | issuer filter | 🔴 | 🔴 BLOCKED |
| D12 | pending ไม่หลุดเข้า report | filter | 🔴 | 🔴 BLOCKED |

---

## 08 สิ่งที่ต้องตัดสินใจ

1. ใครคือผู้ออกเอกสารตัวจริงในเคสเฮียอุทัย — `companies baf76c98…` (ปัจจุบัน type `CUSTOMER`) หรือต้องสร้างบทบาท seller
2. DNA OS จะออกใบกำกับค่าบริการเองหรือให้สำนักงานบัญชีออก (กระทบ G3 ของใบ B)
3. เอกสารเก่าที่ออกไปแล้วจะติด `pending_elements` ย้อนหลังหรือคง `LEGACY_PARTIAL`
4. รูปแบบเลขเอกสารของแต่ละ issuer
5. จะให้ใครมีสิทธิ์กด "ออก" เอกสาร (ต้องมี authority grant ก่อนหรือไม่)
