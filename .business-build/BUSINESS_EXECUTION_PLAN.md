# BUSINESS EXECUTION PLAN — dependency-ordered (DNA OS)

> มาจาก `registry/BUSINESS_CAPABILITY_MATRIX.json` (47 capabilities) + live audit 2026-09-22
> กติกา: **REUSE FIRST** · ห้ามสร้าง table ใหม่ก่อนพิสูจน์ว่าไม่มี owner · ห้าม mock/fake · ทุกงานต้องมี **live proof** ก่อนบอก WORKING
> `registry/TASK_QUEUE.json` ยังเป็น source of truth ของ "งานที่กำลังทำ" — แผนนี้ให้ **ลำดับ + dependency + เกณฑ์พิสูจน์** (ไม่สร้างคิวซ้ำ)
> ลำดับ: FOUNDATION → MASTER DATA → REQUEST → MATERIAL → SOURCE → GPS → PRICE → QUOTE → ORDER → PROCUREMENT → STOCK → DISPATCH → DELIVERY → DOCUMENT → PAYMENT → FINANCE → REPORTING

## STAGE 1 — FOUNDATION
| ID | Dependency | Existing owner | Reuse path | Missing connection | Files affected | DB affected | Runtime affected | Test | Live proof | Status | Risk | Ready |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| BOM-001 | — | `core/auth/*` | ของเดิม | role→capability matrix | — | `profiles/identities` (อ่าน) | approval checks | `owner-verification:test` | login + approve 1 ครั้ง | PARTIAL | matrix ผิดกระทบ approval ทั้งระบบ | ✅ |
| BOM-002 | — | `engines/canonical/*` | นำเข้า main แล้ว (`465f4fb`) | Deno/LINE writers ยังเขียนตรง | `supabase/functions/line-webhook-v2/*` | `receipt_documents`,`business_events` | LINE ingest | `canonical:test/write/finance` | ยืนยันสลิปจริง 1 ใบผ่าน canonical-only | WORKING (core)/PARTIAL (edge) | Deno import Next ไม่ได้ | ⚠️ ต้องออกแบบ transport |
| BOM-003 | — | Connect/Credential system | `connectors` + credential ref | LINE token ยังอยู่ใน `line_channels.channel_access_token` | `gateway/connectors.ts` | `line_channels` | LINE send | `connect-core:test` | พิสูจน์ token ผ่าน credential ref | PARTIAL | หมุน token ผิด → LINE ล่ม | ✅ |

## STAGE 2 — MASTER DATA
| ID | Dependency | Existing owner | Reuse path | Missing connection | Files affected | DB affected | Runtime affected | Test | Live proof | Status | Risk | Ready |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| BOM-010 | BOM-001 | `companies`(+`line_profiles`,`company_line_links`) | ของเดิม | dedup ด้วยเลขผู้เสียภาษี | `app/api/admin/partners/*` | `companies` | partner UI | harness ใหม่ (read-only) | สแกน 86 บริษัทหาตัวซ้ำจริง | PARTIAL | merge ผิด = รวมหนี้ผิด | ✅ read-only ก่อน |
| BOM-011 | BOM-010 | `customer_sites` + `geocoding.ts` | ของเดิม | บังคับ GPS ก่อน quote | `app/admin/sites`,`documents` | `customer_sites` | quote gate | gate test | เพิ่ม site จริง 1 แห่งพร้อม GPS | PARTIAL | เข้มเกินชะลอการขาย | ✅ |

## STAGE 3–5 — REQUEST → MATERIAL → SOURCE
| ID | Dependency | Existing owner | Reuse path | Missing connection | Files affected | DB affected | Runtime affected | Test | Live proof | Status | Risk | Ready |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| BOM-020 | BOM-011 | `business_events` + LINE webhook | ของเดิม | event→quotation writer | `engines/canonical/document-write.ts` | `business_events`→`standalone_documents` | LINE→quote | harness | event จริง → quotation จริง | PARTIAL | ออกใบผิดจากข้อมูลไม่ครบ | 🟡 ต้องมี validation |
| BOM-021 | BOM-020 | `material-resolver.ts` + `material_types` | ของเดิม | unit/density ไม่ถูกบันทึก | `document-write`,`invoice_items.unit` | `material_types` | pricing | material test (มี) | resolve วัสดุจริงจาก LINE จริง | WORKING | — | ✅ |
| BOM-022 | BOM-021 | `pit_profiles`,`pit_materials` | ของเดิม | `place_name` ว่าง 89/96 | `admin/pits` | `pit_profiles` | discovery/distance | discovery test 24/0 | live Google run | BUILT_NOT_WIRED | โควตา API | ⏸ รอคีย์ |

## STAGE 6–8 — GPS → PRICE → QUOTE
| ID | Dependency | Existing owner | Reuse path | Missing connection | Files affected | DB affected | Runtime affected | Test | Live proof | Status | Risk | Ready |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| BOM-030 | BOM-011,022 | `engines/distance.ts` | ของเดิม | real routing (haversine เท่านั้น) | `engines/distance.ts` | — | quote/job | มีแล้ว | เทียบระยะจริงกับเส้นทางที่รู้ | PARTIAL | ระยะคลาด → ราคาผิด | ✅ |
| BOM-031 | BOM-030 | **ไม่มี owner** | — | **feasibility gate (<3 ชม.+ระยะทาง)** | engine ใหม่ 1 ไฟล์ + gate ใน `transaction-write` | ไม่มี (business rule) | ก่อนยืนยันออเดอร์ | rule test | บล็อกงานที่ส่งไม่ได้จริง 1 เคส | **MISSING** | เข้มเกิน = ปฏิเสธงานที่ทำได้ | 🟡 รอเกณฑ์ owner |
| BOM-032 | BOM-030,021 | `pricing.ts`,`cost.ts`,`fuel.ts`,`capacity.ts`,`vehicle-selector.ts`,`quote-price.ts`,`tax.ts` | ของเดิมทั้งหมด | ไม่มีที่เก็บ margin + ไม่มี UI ladder | API+UI อ่าน ladder | config/`fuel_price_log` | ราคาขาย | ladder test | ราคาจริง 1 งานอธิบายได้ทุกบรรทัด | PARTIAL | ขายขาดทุน | 🟡 รอเกณฑ์ margin |

## STAGE 9–10 — ORDER → PROCUREMENT
| ID | Dependency | Existing owner | Reuse path | Missing connection | Files affected | DB affected | Runtime affected | Test | Live proof | Status | Risk | Ready |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| BOM-040 | BOM-032 | `engines/canonical/transaction-write.ts` | canonical | chain ไม่ auto-fill จาก event/quote | `admin/transactions`,`transaction-write` | `customer_orders`,`projects`,`document_groups` | order สมบูรณ์ | `canonical:write:test` | สร้าง order จริงจาก quote จริง | WORKING (create)/PARTIAL (auto-fill) | half-chain → ปฏิเสธถูกต้อง | ✅ |
| BOM-041 | BOM-040 | `pit_price_requests` + PO doc_type + `partner_payable_requests` | ของเดิม | PO ไม่ผูก order | `pits/[pitId]/request-quote`,`documents` | `pit_price_requests`,`partner_payable_requests` | ขอราคา/PO | ขอราคาจริง 1 ครั้ง | แหล่งจริงตอบราคาผ่าน LINE | BUILT_NOT_WIRED (0 rows) | ราคาผันผวน | ✅ เริ่มได้ |
| BOM-042 | BOM-041 | **ไม่มี AP ledger** | `partner_payable_requests` (บางส่วน) | ไม่มี ledger ผูก PO–PV–expense | ต้องออกแบบหลังอนุมัติ | ตารางใหม่ (ภายหลัง) | จ่ายซัพพลายเออร์ | — | รอบ AP จริง 1 รอบ | **MISSING** | ภาษี/เจ้าหนี้ผิด | ⛔ รออนุมัติโมเดล |

## STAGE 11 — STOCK (DEFERRED — ห้ามเริ่ม)
| ID | Dependency | Existing owner | Reuse path | Missing connection | Files affected | DB affected | Runtime affected | Test | Live proof | Status | Risk | Ready |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| BOM-050 | BOM-040 | **ไม่มีเจ้าของ** (0002/0003 ถูก defer ถูกต้อง) | `jobs.delivered_quantity`, `company_expenses.quantity` | ทั้งโดเมน (movement จาก event) | — (อนุมัติก่อน) | — | — | — | — | **DEFERRED** | สร้างก่อนจำเป็น = หนี้สถาปัตยกรรม | ⛔ รอ owner ยืนยัน |

## STAGE 12–14 — DISPATCH → DELIVERY → DOCUMENT
| ID | Dependency | Existing owner | Reuse path | Missing connection | Files affected | DB affected | Runtime affected | Test | Live proof | Status | Risk | Ready |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| BOM-060 | BOM-040 | `jobs` (18 แถว) | ของเดิม **ไม่สร้างตารางใหม่** | **ไม่มี FK เลย/ไม่มี customer_order_id** + ไม่มี dispatch state | `app/api/admin/jobs`, `jobs` | `jobs` + relation ไป `customer_orders` | ขนส่ง | link test | ผูก job จริง 1 ใบกับ order จริง | PARTIAL | ผูกผิด = งาน/เงินผิด | 🟡 รออนุมัติวิธีผูก |
| BOM-061 | BOM-060 | `jobs.job_status` (OPEN/IN_PROGRESS/COMPLETED/SUSPENDED/PENDING_REVIEW) | ของเดิม **ห้ามเพิ่ม enum โดยไม่จำเป็น** | mapping ขั้น dispatch | `jobs`, notification | `jobs` | dispatch board | state test | เดิน state บนงานจริง | MISSING | เพิ่มสถานะเกินจำเป็น | 🟡 |
| BOM-062 | BOM-061 | `receipt_documents` (role A) + `artifact-write.ts` | ของเดิม | ไม่มี POD record/ลายเซ็น | `admin/upload`, `receipt_documents.document_type` | `receipt_documents` (+`media_sha256`) | หลักฐานส่งของ | media test | รูปจริง 1 ไฟล์ + GPS + ผู้รับ | PARTIAL | รูปผูกผิดงาน | ✅ |
| BOM-063 | BOM-062,040 | `document-write.ts` + doc_type (DO/INV) | canonical | ไม่ auto จาก job/delivery; ไม่มี CN | `engines/canonical/document-write.ts` | `standalone_documents`,`invoices` | ออกเอกสาร | canonical test | ออก DO+INV จากงานจริง | PARTIAL | ออกก่อนส่งของ | 🟡 |

## STAGE 15–16 — PAYMENT → FINANCE
| ID | Dependency | Existing owner | Reuse path | Missing connection | Files affected | DB affected | Runtime affected | Test | Live proof | Status | Risk | Ready |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| BOM-070 | BOM-063 | `receipt_documents` + `payment_allocations` (`payment-write.ts`) | canonical | 468 สลิปรอยืนยัน + ไม่มี UI allocation | `admin/receipts` | `receipt_documents`,`payment_allocations` | รับเงิน | `canonical:finance:test` | ยืนยันสลิปจริง 1 ใบ + จัดสรรจริง | PARTIAL | จัดสรรผิด = หนี้ผิด | ✅ (ครั้งละใบ, มี audit) |
| BOM-071 | BOM-070 | `bank-email-sync`,`bank-statement-reconcile` | ของเดิม | 115/115 ยังไม่ match | edge functions + UI | `bank_statement_transactions` | กระทบยอด | match test | จับคู่ bank line จริง 1 คู่ | BUILT_NOT_WIRED | จับคู่ผิด | ✅ |
| BOM-072 | BOM-070 | `finance-summary` + canonical views | canonical (บน main) | AP ยังไม่ผ่าน ledger | `admin/finance-summary` | views | รายงานการเงิน | `canonical:finance:test` 48/0 | เทียบยอดกับ SQL ดิบ | WORKING | — | ✅ |

## STAGE 17 — REPORTING
| ID | Dependency | Existing owner | Reuse path | Missing connection | Files affected | DB affected | Runtime affected | Test | Live proof | Status | Risk | Ready |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| BOM-080 | BOM-072,063,061 | หน้า admin ที่มีอยู่ | อ่าน canonical views | ไม่มี ops board เดียว (order รอส่ง/กำลังส่ง/AP/exception) | `services/canonical/*` + 1 หน้า | views เท่านั้น | dashboard | parity test | เทียบ dashboard กับ SQL | PARTIAL | ตัวเลขไม่ตรง = เสียความเชื่อมั่น | ✅ (อ่านเท่านั้น) |

---
## SMALLEST COMPLETE BUSINESS SLICE (เริ่มที่นี่)
**เส้น: LINE request → company/contact → material → GPS → source → distance → price → quotation → transaction → document → payment → finance**
| ขั้น | งาน | ID | สถานะวันนี้ |
|---|---|---|---|
| 1 | LINE → `business_events` | BOM-020 | ✅ มีจริง (172 events) |
| 2 | material resolve | BOM-021 | ✅ WORKING |
| 3 | GPS ปลายทาง | BOM-011 | ⚠️ ต้องบังคับก่อน quote |
| 4 | source + ราคาจริง + ladder | BOM-022/032 | ⚠️ ราคา 41 แถว · ยังไม่เปิด UI ladder |
| 5 | distance | BOM-030 | ✅ |
| 6 | quotation (canonical) | BOM-020/063 | ⚠️ ยังไม่ auto จาก event |
| 7 | transaction (chain ครบ) | BOM-040 | ✅ บังคับ chain ครบแล้ว |
| 8 | document (DO/INV) | BOM-063 | ✅ canonical |
| 9 | payment allocation | BOM-070 | ✅ guard + audit |
| 10 | finance | BOM-072 | ✅ canonical views |
**เกณฑ์ผ่าน slice แรก**: ทำ 1 เคสจริงครบ 10 ขั้น โดยไม่มีขั้นใดต้องเดา/กรอกซ้ำ และตัวเลขการเงินตรงกับ SQL ดิบ 100%
**จากนั้น**: BOM-041 (procurement) → BOM-060/061 (dispatch) → BOM-062 (delivery evidence) → และพิจารณา BOM-050 (stock) เมื่อ owner ยืนยัน

## OWNER GATE — ห้ามเริ่มจนได้คำยืนยัน
| # | งาน | เหตุผล |
|---|---|---|
| 1 | BOM-050 stock/inventory/warehouse | ยังไม่มีเจ้าของ และธุรกิจวันนี้ขายส่งตรงจากแหล่ง (S1/S2/S6) |
| 2 | BOM-042 AP ledger | ต้องตกลงโมเดลเจ้าหนี้/ภาษีก่อน กันแหล่งความจริงซ้ำ |
| 3 | BOM-031 feasibility rule | ต้องได้เกณฑ์จริงจาก owner (<3 ชม. + ระยะทางเท่าไร) |
| 4 | product spec/slot ส่งของ (S3 ready-mix) | ต้องพิสูจน์ความจำเป็นจริงก่อนเพิ่ม field |
| 5 | Google Maps live proof | ต้องมี `GOOGLE_MAPS_API_KEY` จริง |

## ลำดับ “ทำจริงถัดไป” ที่แนะนำ (สั้น · ตรวจสอบได้)
1. **BOM-070 (ยืนยันสลิปจริง 1 ใบ)** — ใช้บันทึกจริงที่มีอยู่ ไม่สร้างข้อมูลใหม่ · ได้ live proof ของ PAYMENT stage
2. **BOM-020 (writer `ready_to_quote` → quotation)** — ทำให้ REQUEST ต่อ QUOTE ได้จริงบน event จริง
3. **BOM-060 (ผูก `jobs`→`customer_orders`)** — ปิด connection gap ที่ใหญ่สุดของ logistics (ใช้ relation ไม่สร้างตารางใหม่)
4. **BOM-080 (ops board)** — ทำให้ผู้บริหารเห็น order รอส่ง/กำลังส่ง/เจ้าหนี้ จาก canonical views เท่านั้น
5. ระหว่างนี้ถ้า owner ยืนยัน stock → ค่อยเปิด BOM-050 แบบ **minimal movement จาก event** เท่านั้น


