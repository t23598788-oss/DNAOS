# TAX / DOCUMENT — CURRENT STATE AUDIT
**วันที่:** 2026-10-25 · **โหมด:** read-only (อ่านโค้ด + schema ที่ dump ไว้) · **ไม่มีการแก้โค้ด / DB / UI ในรอบนี้**
**ขอบเขต:** เส้นทางออกเอกสาร (`engines/canonical/document-write.ts`), เส้นทางบันทึกค่าใช้จ่าย (`engines/canonical/expense-write.ts`), โมเดลภาษี (`engines/tax.ts`), identity/สิทธิ์ (`core/auth/*`), และ schema จริง (`supabase/local-migration/full_schema.sql`)

---

## 0. สรุปคำตัดสินรายเงื่อนไข

| # | เงื่อนไขของเจ้าของ | สถานะปัจจุบัน | หลักฐานหลัก |
|---|---|---|---|
| 1 | ระบุผู้ซื้อ ผู้ขาย ผู้รับเงินจริง เจ้าของรายการ | **ไม่ผ่าน** | ไม่มีคอลัมน์ผู้ออกเอกสาร; ผู้ขายมาจาก config global; ผู้รับเงินไม่ผูกกับเอกสาร; ไม่มีเจ้าของรายการ |
| 2 | อำนาจแทนผูกกับข้อตกลง/หนังสือมอบหมาย + ขอบเขต + วันมีผล | **ไม่ผ่าน** | `pending_authorizations` เป็นข้อความอิสระ; `scoped_grants` เป็นสิทธิ์เครื่องมือ ไม่ใช่อำนาจทางภาษี |
| 3 | ตรวจสถานะ VAT + องค์ประกอบตามกฎหมายก่อนออกใบกำกับภาษี | **ไม่ผ่าน** | ไม่มีที่เก็บสถานะจดทะเบียน VAT; ไม่มีชนิดเอกสาร "ใบกำกับภาษี"; VAT hardcode 7% |
| 4 | แยกบัญชีต้นทุน/รายรับ/รายจ่าย/ภาษีซื้อ/ภาษีขายต่อกิจการ | **ไม่ผ่าน** | เอกสารไม่มีเจ้าของกิจการ; operator ไม่ถูกจำกัดขอบเขตกิจการ; รายงานรวมทุกแถว |
| 5 | ผ่าน Canonical Writer เดิม + Audit/Evidence Chain ตรวจสอบได้ | **ผ่านบางส่วน** | writer เดียว + atomic RPC + version chain ✔ แต่ audit แก้ได้/actor ว่าง/ไม่มี hash และไม่มี DB constraint กันการเขียนข้าม |
| 6 | ข้อมูลไม่ชัด → สถานะรอตรวจ ไม่เข้ารายงานภาษีอัตโนมัติ | **ไม่ผ่าน** | `data_completeness` ถูกตั้ง `"FULL"` เสมอ; ไม่มีสถานะรอตรวจ; ค่าใช้จ่ายถูกบันทึกอัตโนมัติ; รายงานอ่านทุกแถว |

> หมายเหตุความแม่นยำ: ระบบนี้ **ยังไม่มีรายงานภาษี** เลย (grep แล้วไม่พบ ภ.พ.30 / vat_report / input_vat / output_vat) ดังนั้นเงื่อนไข 6 ยังไม่ถูกละเมิดด้วยการส่งข้อมูลผิดเข้าแบบฟอร์ม — แต่โครงที่รายงานจะถูกสร้างต่อยอดในอนาคต (view `document_canonical` + `company_expenses`) ไม่มีด่านใด ๆ เลยกั้นไว้

---

## 1. สิ่งที่ระบบเดิมทำได้จริงและต้องไม่รื้อ (พื้นฐานที่ใช้ต่อ)

| ความสามารถ | ที่อยู่ | ใช้ต่อในดีไซน์อย่างไร |
|---|---|---|
| Writer เดียวสำหรับเอกสาร | `engines/canonical/document-write.ts` (`createDocument` / `updateDocumentDraft` / `issueDocument` / `voidDocument`) | ทุก gate ใหม่ต้องอยู่ **ข้างใน** ฟังก์ชันเหล่านี้ ไม่สร้าง writer ที่สอง |
| Atomic write ระดับ Postgres | `supabase/migrations/20260923000004_canonical_document_atomic_v1_1.sql` (`confirm_invoice`) | เพิ่ม gate แบบ "ปฏิเสธทั้งก้อน" ได้โดยไม่ต้องเขียน transaction ใหม่ |
| Version chain ผูกค่าเดิม | `document_versions` (snapshot + `previous_version_id` + unique (doc, version_no)) | ที่เก็บ snapshot องค์ประกอบทางภาษี ณ วันออก — append-only อยู่แล้ว |
| Money ladder เดียว | `engines/documents/document-editor.ts#calculateDocumentTotals` | ห้ามคำนวณ VAT ซ้ำที่อื่น (ตาม invariant v1.1) |
| Audit row ทุกการเขียน | `engines/canonical/audit.ts#recordCanonicalAudit` | ต่อยอดเป็น evidence chain (ต้องแก้ช่องว่างข้อ 5) |
| Acceptance verifier (read-only หลังเขียน) | `app/api/admin/ide/_lib/businessAcceptanceRuntime.ts` → ฉีดเข้า `executeBusinessJob` | จุดวาง verifier ทางภาษี โดยไม่แตะ business truth |
| รูปแบบ "ให้สิทธิ์มีขอบเขต+วันหมดอายุ+ถอนได้" | `supabase/migrations/20260926000001_tool_scope_and_commands.sql` (`scoped_grants`) | ต้นแบบของตารางอำนาจมอบหมาย (ข้อ 2) |
| RLS deny-all + service role เท่านั้น | `supabase/migrations/20260709000001_enable_rls_public_tables.sql` | ฐานของการกันเขียนข้าม writer |
| Job envelope + idempotency key | `engines/jobs/business-job-adapter.ts` | กันออกใบกำกับซ้ำเมื่อ retry (สำคัญมากกับเลขเอกสาร) |
| ของเดิมที่ห้ามแตะ | `receipt_documents` (พยานการรับเงิน), `payment_allocations` (เงินจริง), `internal-credit-evidence` | ใช้เป็น evidence source ของ "ผู้รับเงินจริง" |

---

## 2. ช่องว่างเชิงโครงสร้าง (findings)

### F1 — ไม่มี "ผู้ออกเอกสาร" ในโมเดลข้อมูลเลย
`invoices` และ `standalone_documents` มีแต่ `customer_company_id` (ผู้ซื้อ) ไม่มีคอลัมน์ผู้ออก/ผู้ขาย
- `supabase/local-migration/full_schema.sql` → `invoices` (id, invoice_no, invoice_status, customer_company_id, …)
- `supabase/migrations/20260922000001_canonical_foundation_v1_1.sql` เพิ่ม discount/vat_mode/gross/wht/net/data_completeness — **ไม่มี** issuer
- **ผล:** เอกสารทุกใบของทุกกิจการแยกกันไม่ได้ที่ระดับข้อมูล (เงื่อนไข 4 ตกตั้งแต่ชั้น schema)

### F2 — ตัวตนผู้ขายเป็น config global ก้อนเดียว
`core/config/company-settings.ts` เก็บ `company-name`, `company-tax-id`, `payment-bank-*`, `vat-rate` เป็น key-value ใน `app_configs`
- `app/api/admin/documents/route.ts#POST` เรียก `loadCompanySettings()` ครั้งเดียวแล้วใช้กับทุกเอกสาร
- **ผล:** เปลี่ยนชื่อ/เลขภาษีที่ config = เอกสารเก่าทั้งหมดยังอ้างค่าเดิมไม่ได้ (ไม่มี snapshot ผู้ขาย) และกิจการที่สองออกเอกสารไม่ได้เลย

### F3 — ไม่รู้จัก "ใบกำกับภาษี" ในชนิดเอกสาร
`engines/documents/types.ts#DocType` มี `invoice` (ใบแจ้งหนี้) และ `receipt` (ใบรับเงิน) — ไม่มีใบกำกับภาษี/ใบกำกับภาษีอย่างย่อ/ใบเพิ่มหนี้/ใบลดหนี้/หนังสือรับรองหัก ณ ที่จ่าย
- `engines/documents/template.ts` พิมพ์แค่ ชื่อ + เลขผู้เสียภาษี ของผู้ขาย, ชื่อ/โทร/ที่อยู่ผู้ซื้อ — ไม่มีเลขภาษีผู้ซื้อ ไม่มีสาขา ไม่มีคำเตือนประเภทเอกสาร
- `engines/documents/template.ts:137` — ถ้าไม่มีชื่อบริษัทใน config จะ fallback พิมพ์ **"DNA OS"** เป็นผู้ออกเอกสาร
- **ผล:** เอกสารที่ระบบออกยังไม่ใช่องค์ประกอบตามกฎหมาย และมีความเสี่ยงอ้าง DNA OS เป็นผู้ขาย/ผู้ออก

### F4 — ไม่มีที่เก็บสถานะผู้ประกอบการ VAT
`companies` มี `name, tax_id, address, phone, email, bank_name, bank_account_no, type (CORE|CUSTOMER|SUPPLIER|FLEET), status, is_individual` — **ไม่มี** `vat_registered`, วันมีผล/สิ้นสุด, รหัสสาขา
- `CompanyType.CORE` มีใน schema แต่ grep ทั้งโปรเจกต์ไม่พบการใช้งาน → เป็น hook ที่ว่างอยู่ (ใช้เป็นที่ยึดกิจการได้โดยไม่สร้าง master ใหม่)
- **ผล:** ระบบแยกไม่ออกว่าใบไหน "ต้องมี VAT" และใบไหน "ห้ามมี VAT"

### F5 — VAT ถูกคำนวณจากการตั้งค่า ไม่จากการจดทะเบียน
- `engines/tax.ts#calcTax`: `vatEnabled = input.vat_enabled ?? true` และอัตราจาก config `vat-rate`
- `engines/canonical/document-write.ts#computeCanonicalTotals`: `vat_rate: input.vatEnabled ? 7 : 0`
- `invoices.vat_rate` default `0.07`
- **ผล:** ผู้ขายที่ไม่ได้จดทะเบียน VAT ยังออกเอกสารมี VAT ได้ ถ้า caller เปิด flag; และอัตรา 7 ถูก hardcode แม้ config เปลี่ยน

### F6 — ข้อมูลผู้ซื้อไม่มี snapshot ทางกฎหมาย
`invoices` มี `recipient_address` (text อิสระ, nullable) และ FK ไป `companies` — ชื่อ/ที่อยู่/เลขภาษีผู้ซื้อถูกอ่านสดจากตาราง `companies` ตอนแสดงผล
- `document_versions.snapshot` เก็บเฉพาะ financial/items/reference (ดู `buildVersionSnapshot`)
- **ผล:** แก้ข้อมูลลูกค้าภายหลัง = เอกสารที่ออกแล้วเปลี่ยนหน้าตาตาม (ขัดหลัก "ออกแล้วต้องนิ่ง") และตรวจย้อนหลังไม่ได้ว่าวันออกเอกสารผู้ซื้อมีเลขภาษีอะไร

### F7 — "ผู้รับเงินจริง" ไม่ผูกกับเอกสาร
บัญชีรับเงินอยู่ใน config global (`payment-bank-name/number/name`); `receipt_documents` มี `receiving_bank / receiving_account_number / receiving_account_name / payment_verified` จริง แต่ไม่ได้เชื่อมกับเอกสารที่ออกหรือกับกิจการ
- **ผล:** ตรวจไม่ได้ว่าเงินของใบนี้เข้าบัญชีของกิจการใด และเป็นการรับเงินโดยผู้มีอำนาจหรือไม่

### F8 — ไม่มี "เจ้าของรายการ"
`profiles` = (id, email, role) เท่านั้น; `audit_logs.actor_user_id` ถูกเขียนเป็น `null` ตลอด (`recordCanonicalAudit` hardcode) และ actor เก็บเป็น email string
- `app/api/admin/documents/route.ts#POST` ส่ง `actor: auth.email`
- **ผล:** "เจ้าของรายการที่ตรวจสอบได้" ไม่มีจริง — ยืนยันย้อนหลังได้แค่อีเมลในข้อความ audit

### F9 — สิทธิ์ไม่มีขอบเขตกิจการ
`core/auth/session.ts` ให้ `role` เดียว (super_admin/admin/employee/partner/customer/ai_service); `ADMIN_TIER` ออกเอกสารได้ทุกใบ; `profiles` ไม่มี `company_id`
- **ผล:** operator ของกิจการ A ออกเอกสารในนามกิจการ B ได้ ถ้ามีกิจการที่สอง (เงื่อนไข 4 ตกที่ชั้นสิทธิ์)

### F10 — อำนาจมอบหมายยังไม่มีโมเดล
`pending_authorizations` (full_schema L1329) = `company_id, claimant_line_user_id, request_description (text), responsible_line_user_id, status(pending|approved|denied|expired), resolved_at`
- ไม่มีขอบเขตการกระทำ, ไม่มีวงเงิน, ไม่มีวันมีผล/สิ้นสุด, ไม่มีไฟล์หนังสือมอบหมาย, ไม่อ้างเอกสารหลักฐาน
- **ผล:** "approved" ครั้งเดียว = อ้างได้ไม่จำกัดขอบเขตและไม่มีวันหมดอายุ (เงื่อนไข 2 ตก)

### F11 — ค่าใช้จ่าย/ภาษีซื้อ: คอลัมน์มี แต่ไม่มีใครเขียนได้
`20260731000004_company_expenses_detail_fields.sql` เพิ่ม `tax_invoice_no, vendor_tax_id, amount_pre_vat, vat_amount, buyer_name, quantity, unit_price`
- `engines/canonical/expense-write.ts#recordCompanyExpense` เขียนเฉพาะ document_type/amount/vendor_name/expense_date/receipt_document_id/submitted_by_*
- `app/api/internal/connect/expense/route.ts` (ทางเดียวที่เรียก writer) รับ payload เฉพาะ field ชุดนั้น — ส่งเลขภาษีผู้ขาย/เลขใบกำกับ/ยอดก่อน VAT เข้ามาไม่ได้
- `app/api/admin/finance-summary/route.ts` กลับ **อ่าน** `amount_pre_vat + vat_amount` เป็น "VAT in" → ค่าที่อ่านได้จึงเป็น null ตลอด
- **ผล:** ภาษีซื้อจากหลักฐานจริงเป็นไปไม่ได้ในทางเทคนิค (ไม่ใช่แค่ยังไม่ทำ)

### F12 — นโยบายบันทึกอัตโนมัติชนกับเงื่อนไข 6
`20260727000002_company_expenses.sql` ระบุชัด: เอกสารจากคนภายในที่ verify แล้ว **บันทึกอัตโนมัติ ไม่ต้องเข้าคิวรอตรวจ** (เจตนาเจ้าของ)
- **ผล:** ต้องแยกสองชั้น: "บันทึกค่าใช้จ่าย" (อัตโนมัติได้ ตามนโยบายเดิม) กับ "รับเป็นภาษีซื้อ" (ต้องมีองค์ประกอบครบ + รอตรวจ) — ดีไซน์ต้องไม่รื้อนโยบายเดิม

### F13 — `data_completeness` ถูกตั้ง `"FULL"` เสมอ
`engines/canonical/document-write.ts#columnPayload` → `data_completeness: "FULL"`; RPC `confirm_invoice` default `'FULL'`
- ค่าที่มีจริงใน CHECK มีแค่ `FULL | LEGACY_PARTIAL` — **ไม่มี** สถานะ "รอตรวจ"
- **ผล:** ไม่มีที่ให้ข้อมูลไม่ครบไปพัก (เงื่อนไข 6 ตกเชิงโครงสร้าง)

### F14 — Audit/Evidence chain ยังไม่ tamper-evident
`audit_logs` = (id, actor_user_id, company_id, entity_type, entity_id, action, field, old_value text, new_value text, ip_address, user_agent, created_at)
- `recordCanonicalAudit` ใส่ evidence ลงไปใน `new_value` เป็น JSON string, ปล่อย `actor_user_id`, `ip_address`, `user_agent` เป็น null, ไม่มี hash/prev_hash, ไม่มี trigger กัน update/delete
- **ข้อดีที่มีอยู่:** evidence มี id จริง (version_id, items count, atomic name) และ `document_artifacts.sha256` มี unique constraint
- **ผล:** ตรวจย้อนได้เชิงตรรกะ แต่พิสูจน์การไม่ถูกแก้ไม่ได้ (เงื่อนไข 5 = ผ่านบางส่วน)

### F15 — เลขเอกสาร: unique แต่ไม่มีชุดเลข/ลำดับต่อกิจการ
- `invoices_invoice_no_key` (unique) และ `standalone_documents_document_no_key` (unique) มีจริงใน production
- แต่ `app/api/admin/documents/route.ts#POST` ให้ caller ส่งเลขมาเอง หรือ fallback `PREFIX-YYYYMMDD-<ms 3 หลัก>` (`Date.now().slice(-3)`)
- ไม่มีชุดเลขแยกผู้ออก/แยกชนิด/แยกปี, ไม่มีการจองเลขแบบ atomic, ไม่มีรายงานเลขขาด
- **ผล:** เมื่อมีหลายกิจการหรือออกเอกสารถี่ เลขจะชน (unique reject) หรือไม่ต่อเนื่อง — เป็นข้อบกพร่องของใบกำกับภาษีโดยตรง

### F16 — บันทึกเงินสด/รายงานรวมทุกอย่างไม่มีมิติกิจการ
`document_canonical` view (20260922000003) รวม invoice + standalone โดยไม่มี issuer; `finance-summary` รวมทุกแถวเป็นก้อนเดียว
- **ผล:** ตัวเลขรายได้/ภาษีขายของแต่ละกิจการแยกไม่ได้ จนกว่าจะมี `issuer_company_id`

---

## 3. ระดับความเสี่ยง (จัดลำดับก่อนลงมือ)

| ระดับ | รายการ | เหตุผล |
|---|---|---|
| **สูง — ห้ามออกใบกำกับภาษีก่อนแก้** | F1, F4, F5, F13, F15 | ออกเอกสารผิดองค์ประกอบ/ผิดผู้ออก = ความรับผิดทางภาษีและแก้ย้อนหลังไม่ได้ |
| **สูง — กระทบความน่าเชื่อถือหลักฐาน** | F8, F14 | อ้างอำนาจ/เจ้าของรายการไม่ได้เมื่อถูกตรวจ |
| **กลาง — กระทบการขยายหลายกิจการ** | F2, F9, F16 | ยังไม่เจ็บถ้ามีกิจการเดียว แต่จะเจ็บทันทีที่กิจการที่สองออกเอกสาร |
| **กลาง — กระทบภาษีซื้อ** | F11, F12 | ภาษีซื้อคำนวณไม่ได้จนกว่าจะมี writer field + สถานะรับสิทธิ์ |
| **ต่ำแต่ต้องปิดก่อนส่งมอบ** | F6, F7 | snapshot ผู้ซื้อ/ผู้รับเงิน (เอกสารออกแล้วต้องนิ่ง) |

---

## 4. ข้อสรุปของ audit

1. **เส้นทางเขียนดีอยู่แล้ว** — มี writer เดียว, atomic, version chain, audit row: เงื่อนไข 5 ผ่านครึ่งหลังแล้ว เหลือเรื่องความคงทนของหลักฐาน (F14)
2. **โมเดลข้อมูลยังไม่มี "กิจการ" เป็นเจ้าของเอกสาร** — F1/F9/F16 เป็นรากเดียวกัน: ต้องเพิ่มมิติกิจการที่ระดับ schema + สิทธิ์ ไม่ใช่แค่แก้หน้าจอ
3. **องค์ประกอบทางกฎหมายไม่มีที่อยู่** — F3/F4/F6: ชนิดเอกสาร, สถานะ VAT, snapshot คู่สัญญา
4. **ภาษีซื้อเป็นไปไม่ได้ในทางเทคนิค** — F11: ไม่ใช่ปัญหา UI แต่เป็นช่อง payload ของ writer
5. **ไม่มีที่พักของข้อมูลไม่ครบ** — F13: ต้องขยายสถานะก่อนสร้างรายงานใด ๆ (เงื่อนไข 6)

→ ดีไซน์จุดบังคับที่ตอบทั้ง 6 เงื่อนไข: `TAX_DOCUMENT_GATE_DESIGN.md` (ไฟล์เดียวกันโฟลเดอร์นี้)
