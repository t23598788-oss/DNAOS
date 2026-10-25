# TAX / DOCUMENT — GATE DESIGN (จุดบังคับก่อนออกเอกสารหรือบันทึกภาษี)
**วันที่:** 2026-10-25 · **สถานะ:** ดีไซน์เท่านั้น — **ยังไม่มีการแก้โค้ด/DB/UI ในรอบนี้**
**อ้างอิง audit:** `TAX_CURRENT_STATE_AUDIT.md` (finding F1–F16)

---

## 0. หลักการ 4 ข้อที่ใช้ตัดสินทุกจุดบังคับ

1. **Fail-closed, ไม่ใช่ fail-open** — gate ไม่ผ่าน = ไม่เขียนอะไรเลย (เหมือน `resolveOrderForDocument` ที่คืน error แทนสร้าง half chain)
2. **ปฏิเสธที่จุดเดียว** — ทุก gate อยู่ใน `engines/canonical/document-write.ts` / `expense-write.ts` เท่านั้น ไม่กระจายไปที่ route/UI (writer เป็น authority เดียว)
3. **สองชั้นเสมอ: gate ก่อนเขียน (กัน) + verifier หลังเขียน (พิสูจน์)** — ใช้ `businessAcceptanceRuntime` ที่มีอยู่ ไม่สร้างระบบตรวจใหม่
4. **ไม่รู้ = รอตรวจ ไม่ใช่เดา** — ทุก field ที่ขาดถูกบันทึกเป็น `pending_review` พร้อมระบุว่าขาดอะไร ห้ามเติมค่า default เพื่อให้ผ่าน

---

## 1. สถานะของเอกสาร/รายการ (state machine ใหม่)

### 1.1 สถานะเอกสาร (เพิ่มจากของเดิม ไม่ทับ)
```
DRAFT ──gate ครบ?──► PENDING_REVIEW ──ตรวจครบ+มีอำนาจ──► ISSUED ──► (VOID | REPLACED)
   │                        │
   └──gate ครบ?─────────────┘  (แก้ข้อมูลแล้วประเมินใหม่)
```
- `PENDING_REVIEW` = สถานะใหม่ที่ **ต้องมี** (ปัจจุบันมีแค่ DRAFT/SENT/VOID และ `data_completeness=FULL` เสมอ — F13)
- เอกสาร `PENDING_REVIEW` **พิมพ์/ส่งไม่ได้** และ **ไม่ปรากฏในรายงานภาษี**

### 1.2 สถานะทางภาษี (แยกจากสถานะเอกสาร — สำคัญ)
| ฟิลด์ | ค่า | ความหมาย |
|---|---|---|
| `tax_document_kind` | `none` / `full_tax_invoice` / `abbreviated_tax_invoice` / `debit_note` / `credit_note` / `receipt` / `wht_certificate` | ชนิดเอกสารตามกฎหมาย (ปัจจุบันไม่มีเลย — F3) |
| `tax_status` | `not_tax_document` / `pending_elements` / `issued_valid` / `void_replaced` | สถานะผลทางภาษี |
| `claim_state` (ฝั่งภาษีซื้อ/WHT) | `pending_review` / `accepted` / `excluded` / `voided` | สิทธิ์ในการถูกนำเข้าศูนย์ภาษี |

**กฎตายตัว:** `tax_document_kind != 'none'` + `tax_status = 'issued_valid'` ต้องผ่าน G3 ทั้งหมด และ snapshot ต้องมีองค์ประกอบครบ — ไม่มีข้อยกเว้นสำหรับ admin/super_admin

---

## 2. จุดบังคับ (Gates) — ผูกกับ 6 เงื่อนไข

### G1 — คู่สัญญาครบ 4 ฝ่าย + snapshot นิ่ง (เงื่อนไข 1)
**ทำอะไร:** ก่อนเขียนเอกสาร บังคับให้ระบุและ freeze ณ วันออก
| ฝ่าย | ต้องมี | ที่มาจาก |
|---|---|---|
| ผู้ขาย/ผู้ออก | `issuer_company_id` + ชื่อนิติบุคคล + เลขภาษี + ที่อยู่ + รหัสสาขา | `companies` (type=CORE) + `company_tax_profiles` |
| ผู้ซื้อ | `buyer_name`, `buyer_tax_id` (เมื่อเป็นใบกำกับภาษี), `buyer_address`, `buyer_branch_code` | `companies` วันออก → **copy เข้าเอกสาร** |
| ผู้รับเงินจริง | `payee_bank_name/number/name` + บัญชีนั้นต้องเป็นของ `issuer_company_id` | `company_bank_accounts` (ใหม่) |
| เจ้าของรายการ | `record_owner_profile_id` (profile จริง ไม่ใช่อีเมล) | session (`getAuthedUser().id`) |

**ไม่ผ่านเมื่อ:** ขาดฝ่ายใดฝ่ายหนึ่ง หรือบัญชีรับเงินไม่ผูกกับกิจการผู้ออก
**ผล:** `TAX_PARTIES_INCOMPLETE` → เอกสารถูกสร้างเป็น `PENDING_REVIEW` (ถ้ามาจาก draft) หรือปฏิเสธ (ถ้าขอออกทันที)
**ตำแหน่ง:** `createDocument()` ก่อนเรียก `db.rpc("confirm_invoice")`; snapshot ใส่ใน `buildVersionSnapshot()` (มีอยู่แล้ว) + คอลัมน์แยกเพื่อ query

---

### G2 — อำนาจแทนต้องมีหนังสือมอบหมายที่มีขอบเขต+วันมีผล (เงื่อนไข 2)
**ทำอะไร:** ทุกการกระทำที่ "ทำแทนเจ้าของ" ต้อง resolve ได้ว่ามีสิทธิ์ ณ วันนั้น ในนามกิจการนั้น ในวงเงินนั้น
```
มี authority_grant ที่: grantee = actor · company_id = issuer · scope ครอบ action
                     · valid_from <= today <= valid_to · amount_limit >= ยอดเอกสาร
                     · revoked_at IS NULL · มี evidence (ไฟล์หนังสือมอบหมาย / สัญญา)
```
**ไม่ผ่านเมื่อ:** ไม่มี grant / หมดอายุ / เกินวงเงิน / scope ไม่ครอบ / ถูกถอน
**ผล:** `AUTHORITY_MISSING` หรือ `AUTHORITY_EXPIRED` → **ปฏิเสธเสมอ** (ไม่ใช่ pending — เพราะเป็นการใช้อำนาจที่ไม่มีอยู่)
**ตำแหน่ง:** gate ใน `issueDocument()` (จุดที่เอกสารมีผลทางกฎหมาย) และใน `updateDocumentDraft()` เมื่อเปลี่ยนผู้ออก/ผู้ซื้อ
**ยกเว้น:** การกระทำในนามตนเอง (`actor == owner ของ issuer`) ไม่ต้องมี grant — ตัดสินจาก `company_ownership` ไม่ใช่จาก role

---

### G3 — ตรวจสถานะ VAT + องค์ประกอบตามกฎหมาย (เงื่อนไข 3)
**ทำอะไร:** ถ้า `tax_document_kind != 'none'` ต้องผ่านทุกข้อ:

| ตรวจ | กติกา |
|---|---|
| ผู้ออกจดทะเบียน VAT | `company_tax_profiles` ณ วันออก มี `vat_registered = true` และ `vat_registered_from <= issue_date` (และ `vat_registered_until` ไม่ผ่านไปแล้ว) |
| ผู้ซื้อแจ้งเลขภาษี | `buyer_tax_id` ไม่ว่าง + format 13 หลัก + checksum ผ่าน (ผู้ซื้อนิติบุคคล) |
| องค์ประกอบใบกำกับ | เลขเอกสาร, วันออก, ชื่อ/ที่อยู่/เลขภาษี/สาขา ผู้ขาย **และ** ผู้ซื้อ, รายการ+ปริมาณ+ราคาต่อหน่วย, มูลค่าก่อน VAT, อัตรา VAT, ยอด VAT, ยอดรวม |
| อัตรา VAT | ต้องเท่ากับอัตราที่มีผล ณ วันออก (ไม่ hardcode 7 — F5) |
| ชนิดเอกสาร/คำเตือน | `tax_document_kind` ตรงกับเทมเพลต; เอกสารที่ไม่ใช่ใบกำกับต้องพิมพ์ข้อความ "ไม่ใช่ใบกำกับภาษี" |
| ห้ามผู้ออกเป็น DNA OS | template ต้องไม่ fallback ชื่อผู้ออก (F3: `template.ts:137`) — ไม่มีชื่อนิติบุคคล = ไม่ผ่าน |

**ไม่ผ่านเมื่อ:** ข้อใดข้อหนึ่งขาด
**ผล:** `TAX_ELEMENTS_INCOMPLETE` + `tax_status='pending_elements'` → เอกสาร **ออกไม่ได้** (พิมพ์/ส่ง/report ไม่ได้) แต่ยังเก็บเป็น draft ได้ และคืนรายการสิ่งที่ขาดให้ผู้ใช้แก้
**ตำแหน่ง:** `issueDocument()` เป็นหลัก (จุดมีผล) + pre-check ใน `createDocument()` เพื่อไม่ให้สร้างเอกสารที่รู้อยู่แล้วว่าไม่มีทางผ่าน

---

### G4 — แยกกิจการ ไม่โอนสิทธิ์ข้าม (เงื่อนไข 4)
**ทำอะไร:** บังคับ 3 ชั้น

| ชั้น | กติกา |
|---|---|
| **ข้อมูล** | เอกสาร/ค่าใช้จ่าย/ภาษี ทุกแถวต้องมี `issuer_company_id` (ผู้ขาย) และ `counterparty_company_id` (ผู้ซื้อ/ผู้ขายฝ่ายตรงข้าม) — ห้าม NULL สำหรับเอกสารที่มีผลภาษี |
| **เขียน** | `createDocument` ปฏิเสธถ้า `actor.company_scope` ไม่มี `issuer_company_id` (เงื่อนไข F9) |
| **อ่าน/รายงาน** | ทุก query รายงานต้องมี `issuer_company_id = :company` เสมอ; ห้าม aggregate ข้าม issuer ในคำสั่งเดียว (ดู G7) |

**ห้ามเด็ดขาด:** นำภาษีซื้อของกิจการ A ไปหักภาษีขายของกิจการ B; นำเครดิต/ส่วนลดข้ามกิจการ; ใช้บัญชีรับเงินของอีกกิจการ
**ผลเมื่อฝ่าฝืน:** `CROSS_ENTITY_FORBIDDEN` → ปฏิเสธ + บันทึก audit ระดับ warn (เป็นความพยายาม ไม่ใช่ธุรกรรมปกติ)

---

### G5 — ทางเขียนเดียว + หลักฐานที่ตรวจสอบได้ (เงื่อนไข 5)
**ทำอะไร:** ปิดช่องที่ยังเหลืออยู่ (F14/F15) โดยไม่รื้อของเดิม

| ชั้น | มาตรการ |
|---|---|
| **Code** | ขยาย census test เดิม (`scripts/document-authority-census.test.ts` / `check-ghosts.sh`) ให้ fail ถ้ามี `.from("invoices")` / `.from("company_expenses")` แบบ write นอก `engines/canonical/*` |
| **DB** | คง RLS deny-all; เพิ่ม CHECK constraint ตาม G3 (เอกสารที่ `tax_status='issued_valid'` ต้องมี issuer/buyer/tax_id/เลขเอกสารไม่ว่าง) → ต่อให้มีโค้ดหลุดก็เขียนสถานะนั้นไม่ได้ |
| **Audit** | `recordCanonicalAudit` ต้องเก็บ `actor_user_id` (uuid จริง) + `ip/user_agent` + `evidence` เป็น field ของตัวเอง; เพิ่ม `prev_hash`/`row_hash` (sha256 ต่อเนื่องจากแถวก่อน) ให้ audit เป็น hash chain |
| **เลขเอกสาร** | `document_number_series` + RPC จองเลข atomic ต่อ (issuer, kind, ปี) — ไม่ให้ caller กำหนดเลขเองเมื่อเป็นเอกสารภาษี (F15) |
| **Version** | snapshot ต้องมี `tax` block (issuer/buyer/kind/elements/vat_rate/period) และ verifier ตรวจว่า snapshot == ค่าที่ออกจริง |

**ผล:** เอกสารที่ออกแล้วแก้ไม่ได้ (มีอยู่แล้ว) + **พิสูจน์ได้ว่าไม่ถูกแก้** (ใหม่)

---

### G6 — ข้อมูลไม่ชัด = รอตรวจ ไม่เข้าระบบภาษี (เงื่อนไข 6)
**ทำอะไร:** แยก "บันทึกได้" ออกจาก "ใช้สิทธิ์ภาษีได้"

```
ข้อมูลเข้ามา → บันทึกเป็นหลักฐาน (ทำได้ตามนโยบายเดิม)
             → ประเมินองค์ประกอบ → claim_state = pending_review | accepted
             → เฉพาะ accepted เท่านั้นที่ถูกอ่านโดยรายงาน/ภ.พ.30/ศูนย์ภาษี
```

**กติกา `pending_review` (ต้องมีเหตุผลระบุ ไม่ใช่แค่ธง):**
- ขาดเลขภาษีผู้ขาย/ผู้ซื้อ, ขาดเลขใบกำกับ, ยอด VAT ไม่สัมพันธ์กับยอดรวม, วันที่อยู่นอกช่วงจดทะเบียน VAT, หลักฐานเป็นภาพที่ OCR ไม่ยืนยัน, ผู้ขายซ้ำ/เลขใบกำกับซ้ำ, ไม่มีผู้รับเงินจริง
- ต้องเก็บ `pending_reasons: text[]` + `reviewed_by`, `reviewed_at`, `review_decision_reason`
- **ห้าม auto-accept** แม้ confidence OCR สูง (บทเรียน: นโยบาย auto-record ของ `20260727000002` ใช้กับ "การบันทึก" ไม่ใช่ "สิทธิ์ภาษี" — F12)

**ผลต่อรายงาน:** รายงานทุกใบต้องแสดง 3 ก้อนแยก: `accepted`, `pending_review (จำนวน+มูลค่า)`, `excluded` — และยอด accepted ต้องเท่ากับยอดที่ส่งเข้ารายงานจริง (verifier บังคับ)

---

## 3. ตาราง mapping เงื่อนไข → gate → จุดในโค้ด → หลักฐานที่เกิด

| เงื่อนไข | Gate | จุดบังคับในโค้ด | ข้อมูลที่ต้องมี | หลักฐานที่เขียนเมื่อผ่าน |
|---|---|---|---|---|
| 1 ผู้ซื้อ/ผู้ขาย/ผู้รับเงิน/เจ้าของ | G1 | `createDocument()` + `buildVersionSnapshot()` | `company_tax_profiles`, `company_bank_accounts`, session profile | `document_versions.snapshot.parties` + `audit_logs(document.created)` + `record_owner_profile_id` |
| 2 อำนาจแทน+ขอบเขต+วันมีผล | G2 | `issueDocument()` | `authority_grants` + ไฟล์มอบหมาย | `audit_logs(authority.consumed)` ระบุ `grant_id`, `scope`, `valid_to`, `evidence_artifact_id` |
| 3 VAT + องค์ประกอบใบกำกับ | G3 | `issueDocument()` (+ pre-check ใน `createDocument`) | `company_tax_profiles` ณ วันออก, buyer tax id, series no | snapshot `tax` block + `document_number_allocations` + `audit_logs(tax_document.validated)` |
| 4 แยกกิจการ | G4 + G7 | writer gate + report boundary | `issuer_company_id` ทุกแถว, `profile_company_scopes` | `audit_logs(cross_entity.denied)` เมื่อพยายามฝ่า; รายงานแยก issuer |
| 5 Writer เดียว + chain | G5 | census + DB CHECK + audit hash | `prev_hash`, series, artifact sha256 | hash chain ต่อเนื่อง + `document_artifacts.sha256` + verifier 8 ตัว |
| 6 ไม่ชัด = รอตรวจ | G6 + G7 | `claim_state` + report filter | `pending_reasons` | `tax_register_entries(claim_state='pending_review')` + verifier ยอด accepted |

---

## 4. โมเดลข้อมูลขั้นต่ำที่ต้องเพิ่ม (ก่อนเขียนโค้ด)

> หลัก: **เพิ่มตาราง/คอลัมน์ที่จำเป็นเท่านั้น** และใช้ของเดิมเป็นฐาน (`companies`, `document_versions`, `audit_logs`, pattern `scoped_grants`)

### 4.1 `company_tax_profiles` (สถานะภาษีของกิจการ — versioned)
```
company_id        uuid  FK companies (ต้องเป็น type='CORE')
valid_from        date  not null
valid_to          date  null           -- null = ปัจจุบัน
vat_registered    bool  not null
vat_registered_from date null
vat_registered_until date null
legal_name        text  not null
legal_address     text  not null
branch_code       text  not null  default '00000'
wht_payer         bool  not null default false
evidence          jsonb not null       -- ภ.พ.20/หนังสือรับรอง/ภาพเอกสาร + sha256
```
constraint: ห้ามช่วงวันทับซ้อนต่อ `company_id` (exclusion constraint)

### 4.2 `company_bank_accounts` (ผู้รับเงินจริง)
```
company_id, bank_name, account_no, account_name, is_primary, verified_at, verified_evidence jsonb, closed_at
```
ใช้แทน key `payment-bank-*` ใน `app_configs` (เก็บของเดิมไว้อ่านอย่างเดียว)

### 4.3 คอลัมน์บน `invoices` / `standalone_documents` (snapshot ณ วันออก)
```
issuer_company_id        uuid not null  (FK companies)
tax_document_kind        text not null default 'none'
tax_status               text not null default 'not_tax_document'
tax_point_date           date null
buyer_name, buyer_tax_id, buyer_address, buyer_branch_code   text
issuer_name, issuer_tax_id, issuer_address, issuer_branch_code text
payee_bank_name, payee_account_no, payee_account_name         text
record_owner_profile_id  uuid null
pending_reasons          text[] null
```
**ห้าม** ใช้ FK ไปอ่านชื่อผู้ซื้อสดตอนพิมพ์ (F6) — พิมพ์จาก snapshot เท่านั้น

### 4.4 `authority_grants` (หนังสือมอบหมาย — ตามแบบ `scoped_grants`)
```
grantor_profile_id, grantee_profile_id,
company_id,
scope           text  check in ('issue_document','sign_tax_invoice','issue_wht_certificate','receive_payment','submit_tax_report','void_document')
amount_limit    numeric null
valid_from      date not null, valid_to date not null      -- ห้าม null: อำนาจต้องมีวันสิ้นสุด
evidence_artifact_id uuid  -- ไฟล์หนังสือมอบหมาย (sha256)
grant_agreement_id   uuid null -- ผูกสัญญา/ข้อตกลงต้นทาง ถ้ามี
revoked_at, revoked_reason, granted_by, created_at
```
DENY by default: ไม่มีแถวที่ยังมีผล = ทำแทนไม่ได้ (แบบเดียวกับ `scoped_grants`)

### 4.5 `document_number_series` + `document_number_allocations`
```
series:  issuer_company_id, tax_document_kind, prefix, year, next_no, unique(issuer, kind, year)
alloc:   series_id, allocated_no, document_id, allocated_at, allocated_by   (unique per series+no)
```
RPC จองเลข atomic (แบบ `confirm_invoice` ที่มีอยู่) — ห้าม caller ส่งเลขเองเมื่อเป็นเอกสารภาษี (F15)

### 4.6 `tax_register_entries` (ศูนย์ภาษี — ที่เดียวที่รายงานอ่าน)
```
id, company_id, period (YYYY-MM),
entry_kind  check in ('output_vat','input_vat','wht_payable','wht_receivable'),
source_kind check in ('document','expense'),
source_id   uuid,
base_amount, tax_amount, currency,
claim_state check in ('pending_review','accepted','excluded','voided'),
pending_reasons text[], accepted_by, accepted_at, decision_reason,
evidence_refs jsonb   -- version_id / artifact sha256 / receipt_document_id
```
**รายงานทุกชนิดอ่านจากตารางนี้เท่านั้น** — ห้ามอ่าน `document_canonical`/`company_expenses` ตรง ๆ ในรายงานภาษี (ปิดช่องเงื่อนไข 6)

### 4.7 ขยาย `recordCompanyExpense` input (ปิด F11)
เพิ่ม: `buyer_company_id` (กิจการเจ้าของค่าใช้จ่าย), `tax_invoice_no`, `vendor_tax_id`, `vendor_address`, `amount_pre_vat`, `vat_amount`, `wht_amount`, `paid_from_account_id`, `evidence_artifact_id`
→ ทาง `/api/internal/connect/expense` ต้องรับ field เหล่านี้ด้วย (ตอนนี้รับไม่ได้เลย) **และ** ประเมิน `claim_state` ภายใน writer ไม่ใช่ที่ caller

---

## 5. Verifier หลังเขียน (ต่อจาก `businessAcceptanceRuntime`)

เพิ่มใน `VERIFIERS` (read-only, ไม่แก้ business truth):

| verifier | พิสูจน์อะไร |
|---|---|
| `tax_elements_complete` | เอกสาร `issued_valid` ทุกใบมีครบทุกองค์ประกอบใน snapshot |
| `seller_vat_active_at_issue` | `tax_point_date` อยู่ในช่วง `vat_registered_from/until` ของ issuer |
| `buyer_snapshot_equals_source_at_issue_date` | snapshot ผู้ซื้อตรงกับต้นทาง ณ วันออก (หรือต้นทางเปลี่ยนภายหลัง = ต้องมีหลักฐานการเปลี่ยน) |
| `document_number_gapless_per_series` | เลขที่จองแล้วไม่ขาด/ไม่ซ้ำภายในชุด (issuer, kind, ปี) |
| `no_cross_entity_mix` | ไม่มี entry ที่ `source.company_id != entry.company_id` |
| `report_totals_equal_accepted_register` | ยอดรายงาน = ยอด `claim_state='accepted'` เท่านั้น (บังคับเงื่อนไข 6) |
| `audit_hash_chain_intact` | `row_hash` ต่อเนื่องทุกแถว ไม่มีแถวถูกแก้/ลบ |
| `pending_never_reported` | ไม่มี entry `pending_review` หลุดเข้าผลรายงาน |

---

## 6. จุดวางในโค้ด (ระบุให้ตรง ไม่สร้างไฟล์ซ้ำ)

| ไฟล์ | สิ่งที่เพิ่ม | ห้ามทำ |
|---|---|---|
| `engines/canonical/document-write.ts` | `evaluateDocumentGates()` เรียกใน `createDocument`/`issueDocument`; ขยาย `WriteDocumentInput` ด้วย parties/tax fields; `buildVersionSnapshot` เพิ่ม `tax`+`parties` block | ห้ามคำนวณ VAT ใหม่ (ใช้ `calculateDocumentTotals`) |
| `engines/canonical/expense-write.ts` | รับ field ภาษี + คืน `claim_state`/`pending_reasons` | ห้าม auto-accept |
| `engines/canonical/audit.ts` | เก็บ `actor_user_id`, `ip`, `user_agent`, `evidence` แยก, `prev_hash`/`row_hash` | ห้ามเปลี่ยนรูปแบบ `action` ที่มีอยู่ |
| `engines/tax.ts` | รับ `issuer` + `tax_point_date` เป็น parameter; ลบ default `vat_enabled = true` | ห้ามอ่าน `vat-rate` แบบ global ในเส้นทางเอกสารภาษี |
| `core/auth/requireAuth.ts` + `session.ts` | คืน `company_scope: string[]` จากตาราง scope | ห้ามให้ role เดียวข้ามกิจการ |
| `app/api/admin/documents/route.ts` | ส่ง `issuer_company_id` + parties แทน `loadCompanySettings()` เป็นผู้ขาย | ห้าม fallback เลขเอกสารด้วย `Date.now()` สำหรับเอกสารภาษี |
| `app/api/internal/connect/expense/route.ts` | เปิด field ภาษีใน payload | ห้ามรับ `claim_state` จาก caller |
| `app/api/admin/finance-summary/route.ts` | แยกยอดต่อ issuer + แยกก้อน pending | ห้ามรวมข้ามกิจการ |
| `engines/documents/types.ts` + `template.ts` | เพิ่มชนิดเอกสารภาษี + พิมพ์องค์ประกอบครบ + ข้อความ "ไม่ใช่ใบกำกับภาษี" | ห้าม fallback ผู้ออกเป็น "DNA OS" |
| `app/api/admin/ide/_lib/businessAcceptanceRuntime.ts` | เพิ่ม verifier 8 ตัวข้างบน | ห้ามให้ verifier เขียนข้อมูล |

---

## 7. Mapping กับงาน B2B ที่มีอยู่ (ไม่ทำซ้ำ)

| ของเดิม | ใช้ต่อ |
|---|---|
| `B2B_WRITER_INTEGRITY_AUDIT.md` | รายการ writer ที่ bypass — ใช้เป็น baseline ของ census test (G5) |
| `B2B_MANAGED_SERVICE_ARCHITECTURE.md` | โครง "บริการจัดการแทน" — authority_grants (G2) คือชั้นที่ยังขาดในสถาปัตยกรรมนั้น |
| `B2B_IMPLEMENTATION_MATRIX.md` | ใช้จัดลำดับ phase ด้านล่างให้ไม่ชนกับงานค้าง |

---

## 8. ลำดับลงมือ (แต่ละเฟสปิดเงื่อนไขได้จริง)

| เฟส | งาน | ปิดเงื่อนไข | เกณฑ์ผ่าน |
|---|---|---|---|
| **P0 (ตัดสินใจ)** | ยืนยันกิจการผู้ออก + วันจดทะเบียน VAT + ผู้มีอำนาจลงนาม + รูปแบบหนังสือมอบหมาย | 2,3,4 ( groundwork) | เจ้าของเซ็นรับชอบข้อมูลตั้งต้น |
| **P1** | `company_tax_profiles`, `company_bank_accounts`, `issuer_company_id` + snapshot parties; ปิด fallback "DNA OS" | 1,4 | เอกสารใหม่ทุกใบมีผู้ออก/ผู้ซื้อ/ผู้รับเงิน snapshot ครบ |
| **P2** | `authority_grants` + gate ใน `issueDocument` + `profile_company_scopes` | 2,4 | ออกเอกสารแทนได้เฉพาะเมื่อมี grant ที่ยังมีผลและไม่เกินวงเงิน |
| **P3** | `tax_document_kind`/`tax_status` + G3 + series atomic + เทมเพลตใบกำกับ | 3,5 | ออกใบกำกับได้เฉพาะกิจการที่จด VAT และองค์ประกอบครบ; เลขไม่ขาด |
| **P4** | `tax_register_entries` + claim_state + ภาษีซื้อ field ใน writer + report boundary | 6 | รายงานอ่านเฉพาะ `accepted`; pending แสดงแยกและไม่หลุด |
| **P5** | audit hash chain + verifier 8 ตัว + census test | 5 | verifier เขียวทุกตัว; census fail ถ้ามี writer ใหม่ |

---

## 9. สิ่งที่ **ยังไม่ทำ** ในรอบนี้ (และเหตุผล)

- ไม่แก้ schema / ไม่เขียน migration (ต้องรอ P0 ข้อมูลกิจการจริง — ถ้าใส่โครงก่อน เจ้าของจะได้ตารางที่เติมข้อมูลไม่ได้)
- ไม่แก้ `engines/tax.ts` / `document-write.ts` (การแก้ writer ก่อนมี profile/สิทธิ์ = ระบบออกเอกสารไม่ได้ชั่วคราว)
- ไม่สร้างรายงานภาษี (จะสร้างบน `tax_register_entries` เท่านั้น ไม่ใช่บน view เดิม)

## 10. คำถามที่ต้องให้เจ้าของตัดสิน (blocking P0)

1. กิจการที่ออกเอกสารมีกี่แห่ง แต่ละแห่งเลขทะเบียนนิติบุคคล/เลขภาษี/รหัสสาขา อะไร และเริ่มจด VAT วันใด
2. ใครมีอำนาจลงนามออกใบกำกับภาษี (ชื่อ-นามสกุล/ตำแหน่ง) และให้ใครทำแทนได้ วงเงินเท่าไร ถึงเมื่อไร มีหนังสือมอบหมายเป็นไฟล์อะไร
3. เลขใบกำกับภาษีจะใช้ prefix/รูปแบบใด และนับใหม่เมื่อใด (ปีปฏิทิน/ปีบัญชี)
4. เอกสารที่ออกไปแล้วในอดีต จะติดสถานะ `pending_elements` ย้อนหลัง หรือปล่อยเป็น `LEGACY_PARTIAL` และห้ามใช้ในรายงาน
5. ปลายทางรายงาน: กระดาษ/PDF/ยื่น e-Tax — ตัวนี้กำหนด schema ของ `tax_register_entries` ใน P4
6. หนังสือรับรองหัก ณ ที่จ่าย (WHT) ต้องออกจากระบบด้วยหรือออกนอกระบบ
