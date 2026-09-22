# BUSINESS OPERATING MODEL — DNA OS (end-to-end)

> Status: **PLANNING ARTIFACT (owner review required before any new schema)**
> Machine source of truth: `registry/BUSINESS_CAPABILITY_MATRIX.json` (47 capabilities × 30 columns)
> Companion docs: `BUSINESS_EXECUTION_PLAN.md`, `BUSINESS_REAL_SCENARIOS.md`
> Grounding: live DB (92 tables) + real code on `main` (`465f4fb`, `5b22d0f`) — every "Existing" value below
> points at a real table/file/route. Nothing in this model was invented.
> **No mock, no seed, no demo.** No new business schema is proposed until the owner approves this model.

## 0. HOW TO READ THE STATUS VOCABULARY
| Status | Meaning (proof standard) |
|---|---|
| `WORKING` | มี runtime/live evidence จริง (test harness + ข้อมูลจริง) |
| `PARTIAL` | มี owner/ตาราง/โค้ดจริง แต่ flow ไม่ครบ (ขาด connection หรือยังใช้ manual) |
| `BUILT_NOT_WIRED` | โค้ด/ตารางมีแล้ว แต่ **ยังไม่เคยรันกับข้อมูลจริง** (เช่น 0 rows / ไม่มีคีย์) |
| `MISSING` | ไม่มี owner จริงในระบบ (ต้องพิสูจน์ก่อนสร้าง) |
| `LEGACY` | ของเดิมที่ยังถูกเรียกใช้ แต่ความหมาย/สูตรขัดกับ canonical |
| `DEFERRED` | ตรวจแล้วว่ายังไม่จำเป็นต่อ flow วันนี้ — ห้ามนำเข้า |

**ห้ามใช้คำว่า COMPLETE** จนกว่าจะมี live proof ตาม DoD

## 1. LIVE BUSINESS REALITY (ข้อมูลจริง ณ 2026-09-22)
| ข้อมูล | จำนวนจริง | สถานะเชิงธุรกิจ |
|---|---|---|
| companies | 86 | master data ใช้งาน |
| customer_sites | 5 | **น้อยมาก** เทียบ 86 บริษัท → งานส่วนใหญ่ไม่มี GPS ปลายทาง |
| projects / document_groups / customer_orders | 3 / 2 / 2 | pipeline เริ่มมี แต่ยังเล็ก |
| invoices (items 34) / standalone_documents (items 0) | 15 (VOID 9) / 7 | canonical ทำงานจริง (เอกสารทดสอบปิดด้วย VOID) |
| receipt_documents | 495 (confirmed 2 · ai_read 468) | **สลิปส่วนใหญ่ยังไม่ถูกยืนยัน** |
| payment_allocations | 2 (39,257.80) | การจัดสรรทำงานจริงแต่ยังบาง |
| debt_events / debt_snapshots | 18 / 11 | ledger = snapshot ตรงกัน (1,583,657.01) · เทย่า −2,833.14 |
| company_expenses | 149 (VAT เพียง 1) | ฝั่งซื้อมีข้อมูล แต่ VAT input ยังบางมาก |
| partner_payable_requests | มี owner (AP) | ยังไม่ผูก PO/ใบเสร็จ |
| pit_profiles / pit_materials / material_types | 96 / 41 / 11 | แหล่ง+ราคามีจริง 96 พิกัดครบ · ราคา 41 แถว |
| material_source_evidence / facility_types | 0 / 10 | discovery พร้อม schema แต่ **ยังไม่เคยรันกับ Google จริง** |
| jobs | 18 (OPEN 5 · IN_PROGRESS 6 · COMPLETED 1 · SUSPENDED 3 · PENDING_REVIEW 3) | **transport job มีจริง แต่ไม่มี FK ใดเลย** |
| bank_statement_transactions | 115 (matched 0) | ยังไม่กระทบยอดกับสลิป |
| businesses_events (LINE requests) | 172 | ใบขอจริง 101 รอวันชำระ · 16 quoted · 8 confirmed · 2 ready_to_quote |
| stock/inventory/warehouse tables | **0** | ทั้งโดเมนยังไม่ถูกสร้าง (ถูก defer โดย A1) |

## 2. ENTITY / FLOW MAP (ของจริง)
```
[ลูกค้า LINE/โทร/เว็บ]
   └─ line_events / line_profiles ──► business_events (event_type ไทย, material_text, quantity, destination, status)
                                         │              (AI extract เท่านั้น)
                                         ▼
                            engines/material-resolver.ts ──► material_types (11)
                                         ▼
                    pit_materials (41 ราคา) ── engines/quote-price.ts ──► ราคาวัสดุจากแหล่งจริง
                                         ▼
              engines/{price,cost,fuel,capacity,vehicle-selector,distance}.ts ──► ราคา+ระยะทาง+รถ+น้ำมัน
                                         ▼
        quotation (standalone_documents document_type=quotation) ── canonical document-write (version chain)
                                         ▼  ลูกค้าตกลง
        customer_orders ─ projects ─ document_groups ─ customer_sites   (canonical transaction chain)
                                         ▼
        jobs (delivery/transport; OPEN→IN_PROGRESS→COMPLETED) + driver_profiles/vehicle_types/equipment_*
                                         ▼
        DO / invoice / receipt (canonical)  ◄── jobs ไม่มี FK จึงยังไม่ผูกกันจริง
                                         ▼
   receipt_documents (สลิป/LINE) ──payment_allocations──► invoices | debt_events
                                         ▼                        ▼
                            debt_snapshots (projection)     bank_statement_transactions (ยังไม่ match)
                                         ▼
              document_canonical / invoice_payment_summary / company_debt_current  ──► finance-summary
```

## 3. DOMAIN-BY-DOMAIN OPERATING MODEL (ยึดของจริง · รายละเอียด 30 คอลัมน์อยู่ใน JSON)

### A. CUSTOMER / PARTNER MASTER DATA — `PARTIAL`
- Owner: `companies` (+`company_line_links`, `line_profiles`) · classification ใช้ `companies.partner_type_id/partner_type_label/type` ของเดิม (**ไม่สร้าง taxonomy ใหม่**)
- ทางเข้า: LINE (auto reconcile), admin UI (`/admin/partners`, `/admin/relationships`), พนักงานบันทึกเอง
- **Missing**: dedup ตามเลขผู้เสียภาษี, role→capability matrix ให้ approval ทำงาน

### B. INBOUND CHAT / REQUEST — `PARTIAL`
- Owner: `business_events` (172) + `line_events`, `line_outbound_drafts`, `line_customer_memory`
- Writer: LINE webhook v2 (Deno) + `event-followup`; admin: `line-customers/[lineUserId]/{ask,reply,build-event}`
- AI: extract เท่านั้น (`material_text`, `quantity`, `quantity_unit`, `destination`, `schedule_text`, `contact_*`) — ห้ามสร้างราคา/วัสดุเอง
- State จริง: `new`(32) → `awaiting_info`(5) → `ready_to_quote`(2) → `quoted`(16) → `confirmed`(8) → `job_created`(2) + `awaiting_payment_date`(101)/`awaiting_payment`(1)/`sent`(3)/`superseded`(2)
- **Missing**: `ready_to_quote` ไม่ถูกแปลงเป็น quotation อัตโนมัติ · ไม่มี SLA/escalation

### C. MATERIAL — `PARTIAL`
- Owner: `material_types` (11) + `density_ton_per_cbm` ที่มีอยู่แล้ว · resolver = `engines/material-resolver.ts` (ไม่เดาเมื่อกำกวม)
- **Missing**: unit master/alias/variant (0002 ถูก defer ถูกต้อง) — หน่วยวันนี้เป็นข้อความอิสระ

### D. SOURCE / SUPPLIER / FACILITY — `WORKING` (ข้อมูล) + `BUILT_NOT_WIRED` (discovery)
- Owner: `pit_profiles` (96 · GPS 96/96) + `pit_materials` (41 ราคา) · ใหม่: `material_source_evidence` (0) + `facility_types` (10)
- Google Places = สร้าง candidate → evidence เท่านั้น; canonical source ต้องผ่านคน
- **Missing**: `GOOGLE_MAPS_API_KEY` (ยังไม่มี live proof) · `place_name` ว่าง 89/96

### E. GPS / DISTANCE / FEASIBILITY — `PARTIAL` + `MISSING` (rule)
- `customer_sites` GPS + `pit_profiles` GPS + `engines/distance.ts` (haversine) + `jobs.distance_km`
- **Missing (สำคัญ)**: ยังไม่มี business rule กัน "รับงานที่ส่งไม่ได้" (<3 ชม. + ระยะทางเป็นไปไม่ได้) — ต้องเป็น gate ก่อนยืนยันออเดอร์ · ยังไม่มี real routing

### F. PRICING LADDER — `PARTIAL`
- Engine จริง: `pricing.ts` · `cost.ts` (fuel) · `fuel.ts` + `fuel_price_log` · `capacity.ts` · `vehicle-selector.ts` · `quote-price.ts` (ราคาจาก `pit_materials`) · `tax.ts`
- Ladder: material + transport + fuel + trips/vehicle + handling + markup + VAT + WHT = customer price
- **Missing**: ไม่มีที่เก็บ margin/markup rule และไม่มี UI/route แสดง ladder ครบเส้น

### G/H. QUOTATION → ORDER — `PARTIAL` / `WORKING`
- Quotation owner: `standalone_documents(doc_type=quotation)` + version chain (canonical writer)
- Order owner: `customer_orders` + `projects` + `document_groups` + `customer_sites` ผ่าน `transaction-write.ts` (**ปฏิเสธ half-chain**)
- State จริง: `CustomerOrderStatus` = DRAFT,SUBMITTED,PRICING,QUOTED,CONFIRMED,CANCELLED,PROCUREMENT,DISPATCHING,PARTIALLY_DELIVERED,DELIVERED,INVOICED,PAID (**ไม่มี CLOSED/READY — ห้ามเพิ่ม enum โดยไม่จำเป็น**)
- **Missing**: chain ไม่ถูกเติมอัตโนมัติจาก business_event/โควเทชัน (คนกรอกเอง)

### I. PROCUREMENT — `PARTIAL` + `MISSING` (AP ledger)
- มี: `pit_price_requests` (ขอราคาจากแหล่งทาง LINE · 0 แถว), PO = doc_type, `partner_payable_requests` (AP owner จริง)
- **Missing**: PO ไม่ผูกกับ order/customer (ไม่มี FK/ตาราง PO) · ไม่มี payable ledger → จ่ายซ้ำ/จ่ายผิดตรวจยาก

### J/K. STOCK & WAREHOUSE — `MISSING` / `DEFERRED`
- 0 ตาราง stock/inventory/warehouse · `facility_types` มีแล้วเพื่อ classify ได้ทั้งแหล่งและ (อนาคต) ที่เก็บของ
- **ห้ามสร้าง** จน owner ยืนยันว่าถือสต็อกเองจริง; ถ้าต้องใช้ ให้เริ่มจาก **movement จาก event** แบบ minimal

### L/M/N. TRANSPORT / DISPATCH / DELIVERY EVIDENCE — `PARTIAL` / `MISSING`
- Owner: `jobs` (job_status จริง: OPEN 5 · IN_PROGRESS 6 · PENDING_REVIEW 3 · SUSPENDED 3 · COMPLETED 1) + `driver_profiles`, `vehicle_types`, `equipment_assets`(+`equipment_telemetry_pings`), `driver_equipment_permissions`, `maintenance_tickets`
- **Missing ใหญ่**: `jobs` **ไม่มี FK เลย และไม่มี `customer_order_id`** → งานขนส่งไม่ผูกกับออเดอร์/เอกสาร/การเงิน
- Dispatch ยังไม่มี state machine (WAITING_SOURCE→READY_TO_LOAD→EN_ROUTE→ARRIVED) · ไม่มี POD record (ใช้ `receipt_documents` ประเภท `site_photo` ได้บางส่วน) · delivered qty ไม่กระทบ invoice line

### O. DOCUMENT LIFECYCLE — `WORKING` (core) / `PARTIAL` (triggers)
ดูตาราง §4 — ทุกเอกสารผ่าน canonical writer + version; **ห้ามลบ** ใช้ VOID

### P. PAYMENT IN — `PARTIAL`
- `receipt_documents` (495) → confirm → `payment_allocations` → invoice/debt · bank: `bank-email-sync`/`bank-statement-reconcile` (**115/115 ยังไม่ match**)
- **Missing**: 468 สลิปรอยืนยัน · ไม่มี UI จัดสรรเงินเอง · Deno writer ยังไม่ผ่าน canonical

### Q. PAYMENT OUT — `MISSING` (ledger) / `PARTIAL` (doc)
- `company_expenses` (149 · VAT เพียง 1) + `partner_payable_requests` + PV = DocumentBuilder
- **Missing**: ไม่มี AP ledger/journal → PV, expense, PO, payment ไม่ผูกกัน

### R/S/T. FINANCE / DEBT / REPORTING — `WORKING` / `PARTIAL`
- Finance: canonical views + `finance-summary` → revenue 89,283.01 · VAT input 8,411.21+588.79 · allocations 39,257.80 · debt 1,583,657.01
- Debt: ledger→snapshot ตรงกัน 11/11 · credit −2,833.14 คงค่าจริง (ไม่ clamp) · **debt-notice ยังใช้สูตรดอกเบี้ย legacy**
## 4. DOCUMENT TRIGGERS (เกิดเมื่อไร — ผ่าน canonical เท่านั้น)
| เอกสาร | Trigger จริง | Owner วันนี้ | สถานะ |
|---|---|---|---|
| Quotation | ราคา+เงื่อนไขครบ และส่งให้ลูกค้า | `standalone_documents(document_type=quotation)` + version | PARTIAL (ไม่มี expiry job; ไม่ auto จาก `ready_to_quote`) |
| Purchase Order | เลือก supplier แล้ว | `standalone_documents(document_type=purchase_order)` | PARTIAL (ไม่มีตาราง/FK PO → ไม่ผูกออเดอร์) |
| Delivery Order | มีการส่งมอบจริง | `standalone_documents(document_type=delivery_order)` | PARTIAL (ไม่ auto จาก `jobs`) |
| Invoice / Tax Invoice | ถึงเงื่อนไขเรียกเก็บ | `invoices` + `invoice_items` + version | WORKING (canonical writer, VAT/WHT ครบ) |
| Receipt | รับเงินจริง (มี allocation) | doc_type=receipt + `payment_allocations` | PARTIAL (ยังไม่ auto จาก allocation) |
| Payment Voucher | บริษัทจ่ายเงินจริง | doc_type=purchase/payment_voucher | PARTIAL (ไม่มี payable ledger) |
| Credit / Debit Note | คืนของ/ปรับยอด | — | **MISSING** |
| Debt Notice | เข้า collection | doc_type=debt_notice + `engines/documents/debt-notice-draft.ts` | PARTIAL (สูตรดอกเบี้ยยัง legacy) |

## 5. STOCK TRIGGERS (ยังไม่มีเจ้าของ — DEFERRED ตาม A1)
ทุกการเปลี่ยนสต็อกต้องมาจาก **event**: purchase receipt (+) · sale issue (−) · transfer (−/+) · return (+) · damage/loss (−) · adjustment (± พร้อมเหตุผล) · reservation
ความจริงวันนี้: **0 ตาราง stock/inventory/warehouse** และไม่มี consumer → **ห้ามสร้างจน owner ยืนยันว่าธุรกิจถือสต็อกเอง**
สิ่งที่ใช้แทนได้ตอนนี้: `jobs.delivered_quantity`/`actual_quantity` (ปริมาณส่งจริง) และ `company_expenses.quantity/unit` (ซื้อเข้า)

## 6. FINANCIAL EFFECT MAP (ใครได้ผลกระทบเมื่อเกิดอะไร)
| เหตุการณ์ | Financial effect จริง | ผ่าน canonical? |
|---|---|---|
| ออก quotation | ไม่มี (ยังไม่ใช่รายได้) | ✅ document-write |
| ยืนยันออเดอร์ | pipeline (ยังไม่ใช่รายได้) | ✅ transaction-write |
| ออก invoice | รายได้ + VAT output + WHT + net payable | ✅ (VOID ถูกตัดออก) |
| รับเงิน (slip confirmed) | `payment_allocations` → ลด receivable | ✅ payment-write |
| ปิดหนี้ | `debt_events` → `debt_snapshots` | ✅ debt-write |
| จ่ายซัพพลายเออร์ | expense + VAT input + WHT payable | ⚠️ ไม่ผ่าน ledger (ยังไม่มี) |
| ส่งของ | ยังไม่มี stock effect | — (ไม่มี stock) |
| ยกเลิก/void | version status VOID (ไม่ลบแถว) | ✅ |

## 7. AI ROLE MAP (บังคับใช้จริง)
**AI CAN (ทำได้)**: extract ข้อความ LINE · classify เอกสาร/รูป · match วัสดุกับ `material_types` (ไม่เดาเมื่อกำกวม) · แนะนำแหล่งจาก GPS/ราคาจริง · draft คำตอบ/ใบเสนอราคา/notice · detect anomaly (สลิปซ้ำ/ยอดไม่ตรง) · summarize · rank candidates (Google Places)
**AI CANNOT (ห้ามเด็ดขาด)**: สร้างวัสดุ/แหล่ง/ราคา/GPS/การจ่าย ที่ไม่มีใน DB · ยืนยันการชำระเงิน · ลบข้อมูลธุรกิจ · ออกเอกสารการเงินเองโดยไม่มี business state ที่อนุญาต · เปลี่ยน stock โดยไม่มี event · แก้ ledger (debt_events/payment_allocations)
**Enforcement วันนี้**: `material-resolver` (ไม่เดา) · `quote-price` (อ่านราคาจริงเท่านั้น) · canonical write services (validate + audit) · `document-write` (ปฏิเสธการลบ → void) — **ยังไม่มี policy กลางเป็นไฟล์** (gap ที่ต้องปิดในแผน)

## 8. HUMAN APPROVAL MAP (จุดที่ต้องมีคนอนุมัติ)
| งาน | ผู้อนุมัติ | มีจริงวันนี้ |
|---|---|---|
| เพิ่ม/ยืนยันแหล่งวัสดุใหม่ | owner | ✅ (discovery → evidence → คนยืนยัน) |
| เกิน/ลดราคาเกินเกณฑ์, discount เกิน threshold | owner | ❌ ยังไม่มี threshold rule |
| Purchase Order | owner | ⚠️ ผ่านการออกเอกสาร (ไม่มี gate เฉพาะ) |
| จ่ายเงินซัพพลายเออร์ | owner | ⚠️ ไม่มี approval chain (มีแค่ PB record) |
| Void เอกสารการเงินที่ออกแล้ว | owner | ✅ (canonical → version VOID) |
| ปรับ stock ด้วยมือ | owner | — (ยังไม่มี stock) |
| งานทำลายข้อมูล/destructive op | owner | ✅ `destructive_action_log` + `owner-command` |
| ต่อ credential/บัญชี | owner | ✅ `OWNER_REQUIRED` + proposal decide |
| ปิดหนี้/ยอมรับส่วนลดดอกเบี้ย | owner | ✅ ผ่าน debt event + allocation |

## 9. AUTOMATION MAP
**ควร auto**: extraction ใน LINE · GPS จากข้อความ · material resolution · กรองแหล่งตามระยะ · distance · price lookup จากข้อมูลจริง · ร่างใบเสนอราคา · สร้าง stock movement จาก event (เมื่อมี stock) · สร้างเอกสารจาก state transition · projection (paid/outstanding/debt snapshot) · notification (draft+ส่งในเงื่อนไขที่อนุมัติแล้ว) · daily summary
**ห้าม auto**: ออกราคาขายเอง · ยืนยันการจ่ายเงิน · ยืนยันแหล่งใหม่ · ส่ง PO · จ่ายเงินออก · ปรับ stock · ยกเลิก/void เอกสารการเงิน · เปลี่ยน ledger

## 10. EXCEPTION MODEL (ตรวจจริงแล้ว · ต้องมี detect/state/owner/recovery/audit)
| กรณี | ตรวจพบได้ไหมวันนี้ | Recovery ที่ถูกต้อง |
|---|---|---|
| ไม่มี GPS ปลายทาง | ✅ (customer_sites ว่าง) | ติด `awaiting_info` + ขอ pin (ต้องบังคับก่อน quote) |
| วัสดุกำกวม | ✅ resolver คืน ambiguous | ถามลูกค้า |
| ไม่มีราคาในแหล่ง | ✅ quote-price ไม่ตอบ | ตั้งราคาที่ /admin/pits หรือขอราคาผ่าน `pit_price_requests` |
| ไม่มีแหล่ง/แหล่งปิด | ✅ `is_open` | เลือกแหล่งอื่น/แจ้ง owner |
| รถเข้าไม่ได้ | ⚠️ มี `large_vehicle_accessible` แต่ไม่ถูกใช้ตัดสิน | ใช้ก่อนมอบหมายรถ |
| เวลาส่งเป็นไปไม่ได้ | ❌ **ไม่มี rule** | ต้องมี feasibility gate |
| ซัพพลายเออร์เปลี่ยนราคา | ❌ | ต้องมี price version/evidence |
| ของไม่พอ/ต้องซื้อ | ⚠️ ไม่มี stock | ตัดสินใจซื้อ (PO) — ยังไม่มี stock ให้เช็ค |
| สต็อกติดลบ | — | ไม่มี stock |
| รถเสีย | ⚠️ `maintenance_tickets` | reschedule + notify |
| ลูกค้าเปลี่ยนจำนวน | ⚠️ | version เอกสารใหม่ (ห้ามทับ) |
| ส่งไม่ครบ | ⚠️ `jobs.delivered_quantity` | ปรับ invoice line/CN (CN ยัง MISSING) |
| ออก invoice ผิด | ✅ | void + version ใหม่ |
| สลิปซ้ำ | ✅ unique(source,place_id) + allocation guard | reject |
| จ่ายเกิน/จ่ายขาด | ✅ (credit −2,833.14) | allocation แยก principal/interest (ห้าม clamp) |
| ยกเลิก order / คืนสินค้า | ⚠️ มี CANCELLED | ต้องมี CN/refund flow |
| VAT/WHT ผิด | ✅ | void + ออกใหม่ (เก็บ version) |
| LINE/Google ล่ม | ⚠️ | retry queue + ค้างที่ awaiting_info/needs_review |

## 11. GAP MAP (แยกประเภทตามที่กำหนด)
**CONNECTION GAP** — `jobs`↔`customer_orders` (ไม่มี FK เลย) · business_event↔quotation (ไม่มี writer) · slip Deno writer ↔ canonical · bank line ↔ slip (115/115) · PO ↔ order · expense ↔ payment/PO
**DATA GAP** — customer_sites 5 แถว · place_name 89/96 ว่าง · สลิป 468 รอยืนยัน · VAT input 1/149 · material unit/density ที่ใช้จริงไม่ถูกบันทึกในเอกสาร
**UI GAP** — ops board เดียว (order รอส่ง/กำลังส่ง/AP/exception) · allocation UI · pricing ladder breakdown · POD capture · stock (เมื่อมี)
**WRITE PATH GAP** — LINE/Deno family ยังเขียน DB ตรง · ไม่มี writer ของ `ready_to_quote→quotation` · ไม่มี PO writer ที่ผูก order
**READ PATH GAP** — reports ส่วนใหญ่ยังอ่านตารางดิบ · ไม่มี dispatch/timeline view
**BUSINESS RULE GAP** — feasibility <3 ชม. · discount/margin threshold · tax-id dedup · price change/version · CN/refund
**RUNTIME GAP** — ยังไม่มี live proof ของ discovery (คีย์) · bank matching · AP cycle · stock
**EXTERNAL CONNECTOR GAP** — Google Maps key · bank email/statement · fuel price provider · (ถ้าต้อง real routing) Directions API

## 12. DEFINITION OF DONE ของ phase นี้ (สรุป)
✅ ทุก domain A–X ถูก map (47 capabilities × 30 คอลัมน์ ใน `registry/BUSINESS_CAPABILITY_MATRIX.json`)
✅ ระบุ existing source ทุกแถว (ตาราง/engine/route/UI จริง) ✅ ป้องกัน duplicate architecture (ระบุ owner เดิมทุกข้อ)
✅ AI role / approval / automation / document trigger / financial effect / stock trigger / GPS flow / exception flow ชัด
✅ 12+ scenarios trace ได้ (`BUSINESS_REAL_SCENARIOS.md`) ✅ แผนเรียง dependency (`BUSINESS_EXECUTION_PLAN.md`)
⛔ **ยังไม่อนุญาตสร้าง stock/warehouse/schema ใหญ่** จน owner ตรวจ operating model นี้


