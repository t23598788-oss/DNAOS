# BUSINESS REAL SCENARIOS — trace กับระบบจริง (DNA OS)

> ทุก scenario ใช้ **ของจริงเท่านั้น**: ตาราง/engine/route ที่มีใน `main` วันนี้ · ถ้าขั้นใดยังไม่มี owner จะเขียน `ขาด:` ตรง ๆ ไม่แต่ง
> อ่านคู่กับ `BUSINESS_OPERATING_MODEL.md` (model) และ `BUSINESS_EXECUTION_PLAN.md` (ลำดับงาน)
> รูปแบบ: INPUT → DATABASE → ENGINE → DECISION → DOCUMENT → LOGISTICS → PAYMENT → STOCK → FINANCE → AUDIT

---
## S1 — ทรายจากบ่อ → ส่งหน้างาน (ลูกค้าถามทาง LINE)
- **INPUT**: LINE "ขอทรายหยาบ 100 คิว ส่งบ้านเป็ดพรุ่งนี้" + pin หน้างาน
- **DATABASE**: `line_events` (ข้อความ) → `line_profiles`/`company_line_links` (ใคร) → `business_events` (`event_type='ขอราคา'`, `material_text='ทรายหยาบ'`, `quantity=100`, `quantity_unit='คิว'`, `destination='บ้านเป็ด'`, `status='new'`)
- **ENGINE**: `material-resolver` → `material_types` (ทรายละเอียด/ทรายหยาบ) → `classifyMaterialTypes` ไม่เดาเมื่อกำกวม
- **DECISION**: ถ้ากำกวม → `awaiting_info` + `line_outbound_drafts` ถามลูกค้า (คนกดส่ง) · ถ้าชัด → `ready_to_quote`
- **DOCUMENT**: ยังไม่มี writer อัตโนมัติ — `quotation` ต้องสร้างผ่าน `/admin/documents` (DocumentBuilder) → `document-write.ts` + `document_versions` · **ขาด: ready_to_quote → quotation writer**
- **LOGISTICS**: `customer_sites` GPS (ถ้ามี) + `pit_profiles` GPS → `engines/distance.ts` → `jobs.distance_km` · **ขาด: feasibility gate <3 ชม.**
- **PAYMENT**: ยังไม่มีการจ่ายในขั้นนี้
- **STOCK**: ไม่มีตาราง (ทรายขายตรงจากบ่อ) — ไม่ต้องมี stock
- **FINANCE**: ยังไม่เกิดรายได้ (quotation ยังไม่ใช่รายได้)
- **AUDIT**: `line_events` + `business_events.context` + `document_versions` (เมื่อออกใบ)
- **ความจริง**: วัสดุ/แหล่ง/ราคาอ้าง DB จริงทั้งเส้น ✅ · ยังขาด connection 2 จุด (writer + feasibility)

## S2 — หินจากโรงโม่ → ส่งหน้างาน (มีราคาในแหล่งแล้ว)
- **INPUT**: LINE "ขอหินคลุก 60 ตัน" · ลูกค้าเป็นบริษัทที่มีใน `companies` แล้ว
- **DATABASE**: `business_events` (`material_text='หินคลุก'`, `quantity_unit='ตัน'`) + `partner_id` ผูกบริษัทจริง
- **ENGINE**: `material-resolver` → `material_types` (หินคลุก) · `quote-price.ts` อ่าน `pit_materials.price` ของแหล่งที่ `is_open`
- **DECISION**: มีราคา + แหล่งเปิด → ตอบราคาได้ (`quoted`) · ไม่มีราคา → ชี้ให้ตั้งราคาที่ `/admin/pits`
- **DOCUMENT**: quotation (canonical, version v1) → ส่งทาง LINE (`send-document`)
- **LOGISTICS**: `vehicle-selector` + `capacity` (60 ตัน = กี่เที่ยวตาม `vehicle_types.load_capacity`) → `jobs`
- **PAYMENT**: เมื่อลูกค้าส่งสลิป → `receipt_documents` → confirm → `payment_allocations`
- **STOCK**: — (ส่งตรงจากโรงโม่)
- **FINANCE**: รายได้เกิดเมื่อออก invoice เท่านั้น (`document_canonical`) + VAT output
- **AUDIT**: `audit_logs` (document.issued) + `business_events.status` transition
- **ความจริง**: ราคามาจาก `pit_materials` จริงเท่านั้น (AI ไม่คิดราคา) ✅

## S3 — Ready-mix concrete 280 ksc 35 คิว
- **INPUT**: LINE "คอนกรีต 280 ksc 35 คิว ส่งพรุ่งนี้ 9:00"
- **DATABASE**: `business_events` (`material_text='คอนกรีต 280 ksc'`) → `material_types` มี "คอนกรีตสำเร็จรูป" แต่ **ไม่มี storey/ksc ในสคีมา**
- **ENGINE**: `material-resolver` (match ได้) · `quote-price.ts` (ต้องมีราคาใน `pit_materials` ของแพลนท์)
- **DECISION**: ข้อมูลสเปก (ksc/slump) ต้องอยู่ใน `context` jsonb หรือ note ของเอกสาร — **ขาด: spec field (material_specs ถูก defer)**
- **DOCUMENT**: quotation + เงื่อนไขส่ง (เวลา/รถโม่) → `standalone_documents` + version
- **LOGISTICS**: แพลนท์ต้องเป็น `facility_types=CONCRETE_PLANT` (มี taxonomy แล้ว) · ต้องส่งเป็นรอบเวลา → **ขาด: delivery window/slot**
- **PAYMENT / STOCK / FINANCE**: เหมือน S2 (ส่งตรง; รายได้เมื่อ invoice)
- **AUDIT**: `material_source_evidence` เมื่อพบแพลนท์ใหม่ผ่าน discovery
- **ความจริง**: taxonomy แพลนท์มีแล้ว ✅ · สเปกสินค้า/สล็อตเวลา ยังไม่มีเจ้าของ → **ห้ามสร้างจนพิสูจน์ความจำเป็นจริง**

## S4 — ซื้อเข้า stock ก่อนขาย
- **INPUT**: owner ตัดสินใจตุนหินคลุก 500 ตัน
- **DATABASE**: `partner_payable_requests` (AP) + `company_expenses` + PO (doc_type) · **ไม่มีตาราง stock ให้บันทึกรับเข้า**
- **ENGINE**: ไม่มี engine รับเข้า (ไม่มี stock)
- **DECISION**: ต้องเป็นการตัดสินใจ owner (ซื้อตุน)
- **DOCUMENT**: PO (canonical) + ใบเสร็จผู้ขาย (`company_expenses`)
- **LOGISTICS**: `jobs` (ขนจากแหล่งเข้าลาน) — แต่ **`jobs` ไม่มี FK ไปไหน**
- **STOCK**: **ไม่มีเจ้าของ** → ขั้นนี้ยังทำในระบบไม่ได้
- **FINANCE**: expense + VAT input ✅ (ไม่ผ่าน ledger)
- **AUDIT**: `company_expenses` + PO version
- **ความจริง**: scenario นี้ **ต้องมี stock** → **DEFERRED** จน owner ยืนยันธุรกิจถือสต็อกเอง (ห้ามสร้าง schema เลยตอนนี้)

## S5 — ขายจาก stock
- **INPUT**: ลูกค้าสั่งหินคลุกที่ตุนไว้
- **DATABASE/ENGINE/DECISION**: เหมือน S2 แต่ต้องกันสต็อก (available/committed/reserved)
- **STOCK**: **ไม่มีเจ้าของ** → ตอบไม่ได้ว่ามีของพอไหม
- **THAT MEANS**: ห้ามขายจาก stock ในระบบตอนนี้ (ต้องขายแบบส่งตรงจากแหล่ง S1/S2 หรือเพิ่ม stock แบบ minimal ภายหลัง)
- **FINANCE / AUDIT**: เหมือน S2

## S6 — Back-to-back (ไม่เข้า stock)
- **INPUT**: ลูกค้าสั่ง → ซื้อจากแหล่ง → ส่งตรงหน้างาน
- **DATABASE**: `customer_orders` (canonical chain ครบ) + PO (doc_type) + `pit_price_requests` (ขอราคาแหล่ง)
- **ENGINE**: `quote-price` (ราคาแหล่ง) → `pricing` (บวกขนส่ง/น้ำมัน/markup) → quotation
- **DECISION**: เลือกแหล่งจากราคาจริง + ระยะทางจริง (`distance`)
- **DOCUMENT**: quotation → (ลูกค้าตกลง) → DO + invoice · PO ไปแหล่ง
- **LOGISTICS**: `jobs` ผูกแหล่ง→หน้างาน (**ขาด: FK ไป order**)
- **PAYMENT**: ลูกค้าจ่ายเข้า (allocation) · บริษัทจ่ายแหล่ง (PV — ไม่มี ledger)
- **STOCK**: ไม่ต้องใช้ ✅ (นี่คือโมเดลที่ตรงกับธุรกิจวันนี้ที่สุด)
- **FINANCE**: margin = รายได้ − (ราคาแหล่ง + ขนส่ง) — **ขาด: ไม่มีที่คำนวณ/เก็บ margin จริง**
- **AUDIT**: เอกสารทั้ง 2 ฝั่งมี version/evidence

## S7 — Supplier ส่งตรงให้ลูกค้า (บริษัทไม่แตะของ)
- **INPUT**: ตกลงให้แหล่งส่งเองถึงหน้างาน
- **DATABASE**: order (canonical) + PO + `pit_profiles` (LINE ของแหล่ง)
- **ENGINE**: `distance` (คิดค่าขนส่งที่จะเรียกจากแหล่ง) · `capacity` (รถของแหล่ง)
- **DECISION**: ใครรับผิดชอบค่าขนส่ง — วันนี้ระบุเป็นข้อความใน PO
- **DOCUMENT**: PO (ผู้ส่ง/ผู้รับ/เวลา) + DO (จากแหล่ง) + invoice ลูกค้า
- **LOGISTICS**: `jobs` (ระบุว่าเป็นรถของแหล่ง) — **ขาด: ผูกผู้ขนส่ง/รถ supplier**
- **PAYMENT**: ลูกค้าจ่ายบริษัท → allocation · บริษัทจ่ายแหล่ง → AP/PV
- **STOCK**: ไม่ต้องใช้ ✅
- **FINANCE**: รายได้ = invoice · ต้นทุน = expense (ไม่ผ่าน ledger)
- **AUDIT**: เอกสาร + `line_events` (ยืนยันของแหล่ง)
- **ความจริง**: ทำได้วันนี้แบบ manual; ขาดการผูก PO↔order↔job

## S8 — บริษัทรถเอง
- **INPUT**: งานที่มีรถบริษัทว่าง
- **DATABASE**: `jobs` + `driver_profiles` (vehicle_type_id, plate, line_user_id) + `vehicle_types` (capacity, fuel) + `driver_equipment_permissions` + `equipment_assets`
- **ENGINE**: `vehicle-selector` · `capacity` (กี่เที่ยว) · `fuel.ts` + `fuel_price_log`
- **DECISION**: มอบหมายรถ/คนขับ (owner อนุมัติ)
- **DOCUMENT**: DO + invoice
- **LOGISTICS**: depart/arrive ผ่าน LINE + `equipment_telemetry_pings` (**GPS รถจริง**) — **ขาด: dispatch state machine (WAITING_SOURCE→READY_TO_LOAD→EN_ROUTE→ARRIVED)**
- **PAYMENT**: รับจากลูกค้า → allocation
- **STOCK**: —
- **FINANCE**: ต้นทุนรถ (น้ำมัน/ค่าเที่ยว) คำนวณได้ แต่ไม่ได้ลงเป็น expense อัตโนมัติ
- **AUDIT**: telemetry pings + `maintenance_tickets` (รถเสีย)
- **ความจริง**: hardware/GPS มีจริง (`equipment_assets.imei/sim`) แต่ยังไม่ถูกใช้ควบคุม dispatch

## S9 — รถคู่ค้าขน (subcontract)
- **INPUT**: ใช้รถคู่ค้า
- **DATABASE**: `jobs` + `companies` (คู่ค้าเป็นผู้ขนส่ง) + `driver_profiles`
- **ENGINE**: `vehicle-selector`/`capacity` (จำกัดด้วยรถคู่ค้า)
- **DECISION**: ตกลงราคาค่าขน (ไม่มีตาราง rate → ต้องอยู่ในเอกสาร)
- **DOCUMENT**: PO/สัญญาจ้างขน + DO + invoice
- **LOGISTICS**: `jobs` (ระบุผู้ขนส่ง) — **ขาด: FK ผู้ขนส่ง + ค่าขนจริง**
- **PAYMENT**: จ่ายค่าขน → AP (`partner_payable_requests`) แล้ว PV
- **STOCK**: —
- **FINANCE**: **ขาด: link ต้นทุน↔job↔order**
- **AUDIT**: AP record + เอกสาร

## S10 — Partial delivery (ส่งไม่ครบ)
- **INPUT**: สั่ง 100 คิว ส่งได้ 80 คิว
- **DATABASE**: `jobs.delivered_quantity=80` vs `required_quantity=100` (คอลัมน์มีจริง) + หลักฐาน → `receipt_documents(document_type='site_photo')`
- **ENGINE**: ไม่มี (ไม่มี reconciliation delivered vs invoiced)
- **DECISION**: ออก invoice 80 หรือรอส่งครบ — owner ตัดสิน
- **DOCUMENT**: invoice ตรงกับของที่ส่งจริง (คนกำหนดจำนวนในใบ)
- **LOGISTICS**: `jobs` ค้าง `PENDING_REVIEW` (มีจริงในข้อมูล)
- **PAYMENT**: ลูกค้าจ่ายตามใบที่ออก
- **STOCK**: —
- **FINANCE**: รายได้/VAT ตามใบจริง ✅
- **AUDIT**: หลักฐานรูป + ประวัติสถานะงาน
- **ขาด**: ไม่มี CN · ไม่มี auto-link delivered qty → invoice line

## S11 — Partial payment
- **INPUT**: invoice 100,000 ลูกค้าโอน 60,000
- **DATABASE**: `receipt_documents` (60,000) → `payment_allocations {receipt_document_id, invoice_id, kind='principal', amount=60,000}`
- **ENGINE**: `payment-write.ts` → refresh projection → `invoice_payment_summary` = paid 60,000 / outstanding 40,000 / `PARTIALLY_PAID`
- **DECISION**: ใช้ allocation เท่านั้น (ไม่ใช้ `payment_verified` เป็นเงิน)
- **DOCUMENT**: receipt (canonical, อ้าง allocation)
- **LOGISTICS**: —
- **PAYMENT**: ✅ partial + many payments → one invoice
- **STOCK**: —
- **FINANCE**: revenue คงที่ · receivable ลดจริง
- **AUDIT**: `audit_logs(payment.allocated)` + แถว allocation (ย้อนกลับได้)
- **ความจริง**: ทำงานจริง (2 allocation live) · ขาด UI จัดสรรเงินด้วยมือ

## S12 — Cancellation / Return
- **INPUT**: ยกเลิกหลังออก quotation · หรือคืนของหลังส่ง
- **DATABASE**: `customer_orders.status='CANCELLED'` (enum จริง) · เอกสารเป็น VOID (`document_versions.status='void'`)
- **ENGINE**: `state-machine.ts` (ตรวจ transition) · `document-write.voidDocument` (**ห้ามลบ**)
- **DECISION**: ถ้าออก invoice แล้วต้องมี CN — **CN ยัง MISSING**
- **DOCUMENT**: quotation/invoice → VOID (version ใหม่)
- **LOGISTICS**: ยกเลิก `jobs` (`SUSPENDED` มีจริง) + แจ้งรถ/แหล่ง
- **PAYMENT**: ถ้ารับเงินแล้วต้องคืน (ยังไม่มี refund flow — ทำผ่าน void + adjustment)
- **STOCK**: — (ถ้ามี stock ต้องรับคืน — ยังไม่มี)
- **FINANCE**: VOID ถูกตัดจากรายได้อัตโนมัติ ✅ (พิสูจน์แล้วใน finance test)
- **AUDIT**: `audit_logs(document.voided)` + version chain (ย้อนดูได้ว่าเคยออกอะไร)
- **ขาด**: CN/refund flow

## S13 — Exception: สลิปซ้ำ / จ่ายเกิน (เงินจริง)
- **INPUT**: สลิปเดิมส่ง 2 ครั้ง · จ่ายเกินยอด (เคสเทย่า −2,833.14)
- **DATABASE**: `receipt_documents` (แถวเดิม) + guard กัน allocation ซ้ำใน `payment-write.ts` · `company_debt_current` แสดงค่าจริง (ไม่ clamp)
- **ENGINE**: `payment-write` (guard) · `debt-write` (ledger→projection)
- **DECISION**: จ่ายเกิน = เครดิตจริงของลูกค้า → owner ตัดสิน (คืน/หักใบถัดไป) ผ่าน `manual_adjustment`
- **DOCUMENT**: ถ้าคืนเงินต้องมีเอกสารคืน (**ขาด CN**)
- **PAYMENT**: allocation แยก `principal`/`interest`/`penalty` (enum จริง)
- **FINANCE**: ledger = snapshot ตรงกัน 11/11 บริษัท ✅
- **AUDIT**: `debt_events` (append-only) — **ห้ามลบเพื่อกลบความจริง**
- **ความจริง**: กันสลิปซ้ำได้ ✅ · ยังไม่มีขั้นตอนคืนเงินอย่างเป็นทางการ

## S14 — Discovery: พบแหล่งใหม่จาก Google (ขั้นตอนจริง)
- **INPUT**: owner ค้น "บ่อทราย ขอนแก่น" รัศมี 20 กม.
- **DATABASE**: `facility_types` (10) + `material_source_evidence` (candidate + `raw_*` + `identity_key` + `match_status`) + `pit_profiles` (เฉพาะเมื่อ match/สร้าง)
- **ENGINE**: `material-source-discovery.ts` → `searchGooglePlacesTextSearch` (**ต้องมี `GOOGLE_MAPS_API_KEY`**) → `matchCandidateToCanonical` → `classifyMaterialTypes` + `classifyFacilityType` (deterministic)
- **DECISION**: `matched_existing_pit` / `new_pit_created` / `needs_review` (ธุรกิจอื่นในรัศมี → ไม่ auto-link) + **คนยืนยัน**
- **DOCUMENT**: — (ไม่ใช่เอกสารการเงิน)
- **LOGISTICS**: `pit_profiles` GPS ถูกใช้ต่อใน distance/quantity
- **FINANCE**: ผลทางอ้อม (ได้ราคา/แหล่งจริงเพิ่ม)
- **AUDIT**: `material_source_evidence` เก็บ `raw_place_payload` + reason
- **ความจริง**: schema + deterministic test พร้อม (24/0) แต่ **ยังไม่เคยรันกับ Google จริง** → `BUILT_NOT_WIRED`

---
## สรุปสถานะราย scenario (ตามหลักฐาน)
| # | Scenario | ทำได้วันนี้ | ต้องมีอะไรเพิ่ม (ขั้นต่ำ) |
|---|---|---|---|
| S1 | ทรายจากบ่อ | ได้ถึง quotation (manual) | writer `ready_to_quote→quotation` + feasibility gate |
| S2 | หินจากโรงโม่ | ✅ (ราคาจาก `pit_materials`) | — |
| S3 | Ready-mix | บางส่วน | spec/ksc + delivery window (รอพิสูจน์ความจำเป็น) |
| S4 | ซื้อเข้า stock | ❌ | **stock (DEFERRED — รอ owner ยืนยัน)** |
| S5 | ขายจาก stock | ❌ | stock |
| S6 | Back-to-back | เกือบครบ | margin/ต้นทุนผูกงาน |
| S7 | Supplier ส่งตรง | manual | link PO↔order↔job |
| S8 | รถบริษัท | manual | dispatch state machine |
| S9 | รถคู่ค้า | manual | FK ผู้ขนส่ง + ค่าขน |
| S10 | Partial delivery | manual | reconcile delivered→invoice (+CN) |
| S11 | Partial payment | ✅ | UI allocation |
| S12 | Cancel/Return | บางส่วน | CN/refund |
| S13 | สลิปซ้ำ/จ่ายเกิน | ✅ (guard+ledger) | ขั้นตอนคืนเงินทางการ |
| S14 | Google discovery | deterministic เท่านั้น | `GOOGLE_MAPS_API_KEY` + live proof |

**ข้อสรุปเชิงธุรกิจ**: ห่วงโซ่ที่ **เดินได้จริงวันนี้** คือ S2/S6/S11/S13 (ส่งตรง–รับเงิน–ปิดหนี้) และ S1/S3/S7/S8/S9/S10/S12 เดินได้แบบ **manual + canonical เอกสาร** ส่วน S4/S5 (stock) **ยังไม่ควรเปิด** จน owner ยืนยัน เพราะธุรกิจปัจจุบันขายแบบส่งตรงจากแหล่งเป็นหลัก


