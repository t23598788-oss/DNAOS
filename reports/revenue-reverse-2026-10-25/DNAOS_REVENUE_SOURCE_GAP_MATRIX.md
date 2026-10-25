# DNA OS — REVENUE SOURCE GAP MATRIX
**วันที่:** 2026-10-25 · **กฎ:** ทุกรายการที่ไม่มีสัญญา/ราคา = `UNPRICED` · ไม่มีบริการใช้งานจริง = `NOT LIVE` · ห้ามนับมูลค่าสินค้า/ค่าขนส่งของผู้ประกอบการเป็นรายได้ DNA OS

## สรุปสถานะ 10 แหล่งรายได้

| # | แหล่งรายได้ | ความสามารถ | ราคา | รายได้ที่รับรู้ | เงินรับ | สถานะ readiness |
|---|---|---|---|---|---|---|
| 1 | ค่าประมวลผลธุรกรรมซื้อขาย B2B | มี (`transaction-write`) | **UNPRICED** | 0 (ไม่มีตาราง) | 0 | **BUILD** |
| 2 | ค่าประสานงาน/จับคู่ทรัพยากร | มีบางส่วน (`match_queue`) | **UNPRICED** | 0 | 0 | **BUILD** |
| 3 | ค่าประมวลผลขนส่ง/รถร่วม | มีบางส่วน (`match_queue`, `resource_transactions`) | **UNPRICED** | 0 | 0 | **BUILD** |
| 4 | ค่าประมวลผลเอกสารธุรกิจ | มี (`document-write` LIVE) | **UNPRICED** | 0 | 0 | **CONNECT** |
| 5 | ค่าตรวจสอบ/กระทบยอดเอกสาร | มี (`payment-write`, OCR) | **UNPRICED** | 0 | 0 | **CONNECT** |
| 6 | ค่าบริการระบบองค์กร (subscription) | **ไม่มี org/plan** | **UNPRICED** | 0 | 0 | **BLOCKED** |
| 7 | ค่าประมวลผล API สำหรับแพลตฟอร์มภายนอก | มี API + token | **UNPRICED** | 0 | 0 | **BUILD** |
| 8 | ค่าประมวลผล AI ตามขอบเขตบริการ | มี meter (`worker_usage_events`) | **UNPRICED** | 0 | 0 | **CONNECT/BUILD** |
| 9 | ค่าจัดเก็บข้อมูล/Compute | มี storage บางส่วน; compute = 0 | **UNPRICED** | 0 | 0 | **BUILD** |
| 10 | ค่าบริการเชื่อม ERP/E-commerce | มี connector framework | **UNPRICED** | 0 | 0 | **BLOCKED** |

**READY = 0 · CONNECT = 3 · BUILD = 5 · BLOCKED = 2**

---

## รายละเอียดรายแหล่ง

### 1) ค่าประมวลผลธุรกรรมซื้อขาย B2B — BUILD
| หัวข้อ | หลักฐาน / สถานะ |
|---|---|
| Existing source | `engines/canonical/transaction-write.ts` · `customer_orders` · `business_events` |
| ผู้มีสิทธิ์เรียกเก็บ | DNA OS (ผู้ให้บริการแพลตฟอร์ม) — ต้องมีสัญญา |
| ผู้มีหน้าที่ชำระ | ผู้ซื้อ/ผู้ขายตามข้อตกลง — **ยังไม่ระบุ** |
| เงื่อนไขเกิดรายได้ | ธุรกรรมสำเร็จ (ไม่ใช่ตอนเปิดใบเสนอราคา) |
| จำนวนหน่วย | 1 ธุรกรรม หรือ % ของมูลค่า — **ไม่ได้กำหนด** |
| ราคาตามสัญญา | **UNPRICED** |
| ต้นทุนตรง | `COST_UNALLOCATED` |
| รายได้ที่รับรู้ | ไม่มีตาราง/ยอด = 0 |
| เงินรับจริง | ไม่มี charge → 0 |
| ภาษี/เอกสาร | ต้องออกใบแจ้งหนี้ค่าบริการ + VAT 7% — ยังไม่มีเส้นทาง |
| Missing schema | `fee_contracts`, `fee_charges`, `revenue_recognitions` |
| Missing code | fee resolver → charge creation → invoice line → recognition |
| Test ที่ต้องมี | charge ซ้ำไม่เพิ่ม, GMV ไม่ถูกนับเป็นรายได้, charge→invoice→allocation ตรงกัน |

### 2) ค่าประสานงาน/จับคู่ทรัพยากร — BUILD
| หัวข้อ | หลักฐาน / สถานะ |
|---|---|
| Existing source | `match_queue` `20260709000003:40` · `engines/material-resolver.ts` |
| เงื่อนไขเกิดรายได้ | จับคู่สำเร็จและผู้ใช้ยืนยัน |
| จำนวนหน่วย | ครั้งที่จับคู่/คำขอ — **ไม่ได้กำหนด** |
| ราคา | **UNPRICED** |
| ต้นทุนตรง | `COST_UNALLOCATED` |
| ข้อจำกัด | `match_queue` ไม่มี event log, ไม่มี tenant, ไม่มีสถานะคิดเงิน |
| Missing | matching outcome event + fee unit + tenant |

### 3) ค่าประมวลผลขนส่ง/รถร่วม — BUILD
| หัวข้อ | หลักฐาน / สถานะ |
|---|---|
| Existing source | `match_queue`, `resource_transactions` (`logistics_trips`) `20260620000000:107`, `jobs` |
| เงื่อนไขเกิดรายได้ | เที่ยวขนส่งยืนยัน/ส่งมอบสำเร็จ |
| จำนวนหน่วย | เที่ยว / คัน / กิโลเมตร — **ไม่ได้กำหนด** |
| ราคา | **UNPRICED** |
| ข้อจำกัด | ยังไม่มีระบบจองรถ/ยืนยันรับงานที่กันเวลาทับซ้อน (WAVE 3 รายงาน BLOCKED) |
| ห้าม | ห้ามนำค่าขนส่งของผู้ประกอบการเป็นรายได้ DNA OS |

### 4) ค่าประมวลผลเอกสารธุรกิจ — CONNECT
| หัวข้อ | หลักฐาน / สถานะ |
|---|---|
| Existing source | `engines/canonical/document-write.ts` · `document_versions` · `document_artifacts` |
| เงื่อนไขเกิดรายได้ | เอกสารออกสำเร็จ (issued) |
| จำนวนหน่วย | ฉบับ/เวอร์ชัน — **ไม่ได้กำหนด** |
| ราคา | **UNPRICED** |
| สิ่งที่ขาด | document issued event → billable usage row (tenant, doc id, trace) |
| ข้อดี | เอกสารมีเลขอ้างอิงและ version อยู่แล้ว → เชื่อม meter ได้ตรงที่สุด |

### 5) ค่าตรวจสอบ/กระทบยอดเอกสาร — CONNECT
| หัวข้อ | หลักฐาน / สถานะ |
|---|---|
| Existing source | `payment-write.ts`, `receipt-confirm-flow.ts`, OCR (`ai_tasks`, `receipt_documents`) |
| เงื่อนไขเกิดรายได้ | ตรวจ/กระทบยอดสำเร็จ |
| จำนวนหน่วย | ฉบับ/ครั้ง — **ไม่ได้กำหนด** |
| ราคา | **UNPRICED** |
| ข้อจำกัด | การยืนยันเงินเป็นศูนย์กลางแล้ว แต่ไม่มี charge; ต้องแยกค่าตรวจสอบออกจากมูลค่าเงินที่รับ |

### 6) ค่าบริการระบบองค์กร — BLOCKED
| หัวข้อ | หลักฐาน / สถานะ |
|---|---|
| Existing source | ไม่มี — ไม่มี `organizations`, `org_members`, plan/seat |
| ราคา | **UNPRICED** |
| ข้อจำกัด | Tenant ผูกได้เฉพาะ `companies` บนเอกสาร; user ไม่มี org membership |
| ต้องมีก่อน | M2 org model + owner ตัดสิน plan/seat/ARPA |
| ห้าม | ห้ามใช้ `ADMIN_TIER` หรือจำนวน company rows แทนจำนวนผู้ใช้ที่จ่ายเงิน |

### 7) ค่าประมวลผล API สำหรับแพลตฟอร์มภายนอก — BUILD
| หัวข้อ | หลักฐาน / สถานะ |
|---|---|
| Existing source | `app/api/v1/query/route.ts` · `api_tokens` `20260705000006:7` |
| เงื่อนไขเกิดรายได้ | คำขอ API ที่สำเร็จ |
| จำนวนหน่วย | request / 1,000 requests — **ไม่ได้กำหนด** |
| ราคา | **UNPRICED** |
| ข้อจำกัด | `api_tokens` เก็บแค่ `last_used_at`; ไม่มี request log, ไม่มี scope การคิดเงิน |
| Missing | `api_usage_events` (token_id, endpoint, status, latency, occurred_at) + unique request id |

### 8) ค่าประมวลผล AI ตามขอบเขตบริการ — CONNECT/BUILD
| หัวข้อ | หลักฐาน / สถานะ |
|---|---|
| Existing source | `worker_usage_events` `20260810000002:13` · `usageMeterRuntime.ts:68` |
| เงื่อนไขเกิดรายได้ | AI call สำเร็จตามบริการ |
| จำนวนหน่วย | token / call / งาน — **ไม่ได้กำหนด** |
| ราคา | **UNPRICED** |
| ต้นทุน | meter มี token/latency แต่ `COST_LEDGER` = 0 entries → ต้นทุนจริง **UNKNOWN** |
| Missing | tenant_id, service_type, transaction_id, unit price, charge |

### 9) ค่าจัดเก็บข้อมูล/Compute — BUILD
| หัวข้อ | หลักฐาน / สถานะ |
|---|---|
| Existing source | `storage_resources`/`storage_evidence` `20260804000004`; `COMPUTE_RESOURCE_REGISTRY` = 0 |
| เงื่อนไขเกิดรายได้ | GB-month / GPU-hour / CPU-hour |
| จำนวนหน่วย | **ไม่ได้กำหนด** |
| ราคา | **UNPRICED** |
| ข้อจำกัด | ไม่มี compute ที่ลงทะเบียน, ไม่มี usage ต่อ tenant, Supabase free tier ไม่มีใบแจ้งหนี้ต่อหน่วย |

### 10) ค่าบริการเชื่อม ERP/E-commerce — BLOCKED
| หัวข้อ | หลักฐาน / สถานะ |
|---|---|
| Existing source | `engines/connectors/*`, `connect_external_accounts`, OAuth tables |
| เงื่อนไขเกิดรายได้ | การเชื่อมต่อ/ซิงก์ที่ใช้งานจริง |
| ราคา | **UNPRICED** |
| ข้อจำกัด | ไม่มี connector ERP/e-commerce ที่ live, ไม่มี org/สัญญา/ขอบเขตบริการ |
| ต้องมีก่อน | connector ที่ผ่าน TESTED, org model, ข้อตกลงค่าบริการ |

---

## ตาราง Gap Matrix แบบย่อ (ตามรูปแบบที่กำหนด)

| Revenue Goal | Required Capability | Existing Source | Existing Data | Missing Evidence | Missing Schema/API | Required Code | Test | Business Value | Status |
|---|---|---|---|---|---|---|---|---|---|
| ค่าธรรมเนียม B2B | fee engine + charge | `pricing.ts`, `transaction-write.ts` | ไม่มี charge | ราคา/สัญญา | `fee_contracts`, `fee_charges` | charge service + reader | GMV≠revenue, dup charge | รายได้หลักต่อ tx | BUILD |
| ค่าจับคู่ | matching outcome | `match_queue` | queue rows (ไม่ทราบจำนวน) | outcome log | `usage_events` | meter matching | dup/no-tenant | รายได้ต่อคำขอ | BUILD |
| ค่าขนส่ง/รถร่วม | booking + meter | `resource_transactions` | unit cost/price | การจองที่กันชน | booking schema | meter per trip | race/dup | รายได้ต่อเที่ยว | BUILD |
| ค่าเอกสาร | issued event → charge | `document-write` | version/artifact | ราคา | `fee_charges` | hook issued | once per issue | ง่ายที่สุด | CONNECT |
| ค่าตรวจ/กระทบยอด | verification event | `payment-write` | allocations | ราคา | `fee_charges` | meter verification | double count guard | รายได้ต่อฉบับ | CONNECT |
| Subscription องค์กร | org + plan | ไม่มี | ไม่มี | ทั้งหมด | org/plan tables | billing service | seat isolation | รายได้ประจำ | BLOCKED |
| API ภายนอก | request meter | `api_tokens` | last_used_at | request log | `api_usage_events` | middleware meter | dup request id | รายได้ตามใช้ | BUILD |
| AI ตามขอบเขต | usage → charge | `worker_usage_events` | tokens/latency | tenant/cost/price | `fee_charges` | join + charge | token unknown handling | pass-through | CONNECT |
| Storage/Compute | GB-hour meter | storage tables | scan/evidence | compute rows | usage table | meter | double count | infra margin | BUILD |
| ERP/E-commerce | connector + contract | connector framework | account rows | live connector | contract/plan | connector | integration test | high-value B2B | BLOCKED |

> **ห้ามตีความว่า "Business Value" คือตัวเลขเงิน** — เป็นเพียงคุณค่าทางธุรกิจเชิงคุณภาพ
