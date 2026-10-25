# DNA OS — RESOURCE USAGE METERING AUDIT
**วันที่:** 2026-10-25 · **ขอบเขต:** source + schema + registry (ไม่ query production)
**สรุป:** DNA OS มี **evidence ของ event** หลายประเภท แต่ **ยังไม่มี billable usage meter ที่ผูก Tenant → Service → Transaction → Trace ได้ครบ** — ตัวเลขที่ต้องใช้คิดเงินจึงเป็น `DATA REQUIRED` ทั้งหมด

---

## 1. ลำดับที่ระบบต้องมี (เกณฑ์ตรวจ)

```
Tenant ID → Service Type → Transaction ID → Usage Event → Trace ID → Timestamp
```

| องค์ประกอบ | มีจริงหรือไม่ | หลักฐาน |
|---|---|---|
| Tenant ID | **บางส่วน** | `customer_company_id` มีใน `invoices`/`customer_orders`; ไม่มีในตาราง usage/event |
| Service Type | **ไม่มี registry** | ไม่มี `service_types`; `worker_usage_events.service` เป็นค่า capability ของ AI เท่านั้น |
| Transaction ID | **บางส่วน** | `customer_order_id` มีใน invoice; usage events ไม่มี |
| Usage Event | **มีหลายแบบ แต่ไม่เป็นมาตรฐานเดียว** | ดู §2 |
| Trace ID | **บางส่วน** | `worker_usage_events.request_id`; ไม่มี trace กลาง |
| Timestamp | **มี** | ทุกตารางมี `created_at`/`occurred_at` |

> **ผล:** ต่อให้มีราคาในอนาคต ก็ยัง **ออกใบเรียกเก็บราย tenant ไม่ได้** จากข้อมูลปัจจุบัน เพราะขาด 3 ใน 6 องค์ประกอบ

---

## 2. สัญญาณการใช้งาน 15 ประเภท

| # | ประเภท | ตาราง/ฟิลด์ที่มีจริง | ผูก Tenant? | ผูก Transaction? | Trace | กันซ้ำ | Billable unit? | สถานะ |
|---|---|---|---|---|---|---|---|---|
| 1 | ข้อความเข้า | `line_events` (`line_user_id`, `line_message_id`, `created_at`) `20260709000002:6` | ❌ | ❌ | message id | `line_message_id` (ไม่ unique ชัดเจน) | ❌ | EVIDENCE_ONLY |
| 2 | ข้อความออก | `line_events.direction='out'` + `line_outbound_drafts` | ❌ | ❌ | ❌ | ❌ | ❌ | EVIDENCE_ONLY |
| 3 | Webhook events | `integration_gateway_events` (`event_id UNIQUE`) `20260805000002:12` | ❌ | ❌ | `event_id` | ✅ UNIQUE | ❌ | EVIDENCE_ONLY |
| 4 | Business intent | `business_events` (`event_code`, `status`, `partner_id`) | บางส่วน (`partner_id`) | ❌ | `event_code` | ✅ UNIQUE | ❌ | EVIDENCE_ONLY |
| 5 | Resource matching | `match_queue` `20260709000003:40` | ❌ | ❌ | ❌ | ❌ | ❌ | PARTIAL |
| 6 | Transaction execution | `customer_orders` (`customer_company_id`, UNIQUE `order_no`) | ✅ | ✅ ตัวมันเอง | order_no | ✅ | ❌ | EVIDENCE_ONLY |
| 7 | Document processing | `document_versions`, `document_artifacts` `20260922000001` | ผ่าน parent doc | ผ่าน invoice/order | version id | version_no | ❌ | EVIDENCE_ONLY |
| 8 | OCR | `ai_tasks` (`kind`, `status`, `processed_at`) + `receipt_documents` | ❌ | ❌ | task id | ❌ | ❌ | EVIDENCE_ONLY |
| 9 | AI inference | `worker_usage_events` (`request_id`, `provider`, `model`, tokens, `latency_ms`) `20260810000002:13` | ❌ | ❌ | request_id | ❌ (insert ทุกครั้ง) | ❌ | METERED_NOT_BILLABLE |
| 10 | Tool execution | `device_commands` + `scoped_grants` `20260926000001` | ❌ | ❌ | command id | ❌ | ❌ | EVIDENCE_ONLY |
| 11 | API requests | `api_tokens.last_used_at` เท่านั้น `20260705000006:14` | ❌ (`user_email`) | ❌ | ❌ | ❌ | ❌ | **MISSING** |
| 12 | DB reads/writes | ไม่มี usage log ต่อ tenant | ❌ | ❌ | ❌ | — | ❌ | MISSING |
| 13 | Storage | `storage_resources`, `storage_evidence`, `storage_scan_runs` `20260804000004` | ❌ | ❌ | scan id | partial | ❌ | EVIDENCE_ONLY |
| 14 | CPU/GPU time | `COMPUTE_RESOURCE_REGISTRY.json` resources = **0**; ไม่มี usage row | ❌ | ❌ | ❌ | — | ❌ | **MISSING** |
| 15 | Network/bandwidth | ไม่มี | ❌ | ❌ | ❌ | — | ❌ | MISSING |

---

## 3. หลักฐานเชิงโค้ดของ meter ที่มีอยู่

| ไฟล์ | บรรทัด | ข้อเท็จจริง |
|---|---|---|
| `app/api/admin/ide/_lib/usageMeterRuntime.ts` | 68 | insert `worker_usage_events` หลัง `adapter.execute()` ทุกครั้ง |
| | 4-11 | ระบุชัด: **ไม่ประมาณ token** — ถ้า provider ไม่ส่ง ให้ `token_source='UNKNOWN'` + reason |
| | 99 | `listUsageEvents()` อ่านได้สูงสุด 100 แถว — เป็น read-side ไม่ใช่ billing |
| `app/api/admin/ide/_lib/costLedgerViewRuntime.ts` | 26 | `DEFAULT_MARGIN_RATE = 0` — ไม่มี margin policy จึงไม่คิดค่าบริการ |
| | 50-60 | provider cost → THB → customer charge โดยใช้ margin 0 |
| `registry/COST_LEDGER.json` | — | entries = **0** |
| `registry/COST_BUDGETS.json` | — | budgets = **0** |

> แปลว่า: แม้ AI call จะถูก meter แล้ว **ก็ยังไม่มีต้นทุนจริงหรือราคาขายจริง** ที่จะเอาไปออกใบเสร็จ

---

## 4. ช่องว่างที่ต้องปิดก่อนเรียกเก็บเงินได้

| # | ช่องว่าง | ผลต่อการวัดรายได้ | ชนิดงาน |
|---|---|---|---|
| U1 | ไม่มี `tenant_id` บน usage/event | รวมยอดข้าม tenant ไม่ได้ / ออกบิลผิดองค์กร | BUILD (schema) |
| U2 | ไม่มี Service Type Registry | จัดกลุ่มรายได้ตามบริการไม่ได้ | BUILD |
| U3 | ไม่มี `transaction_id` บน usage | พิสูจน์ว่า usage เกิดจากธุรกรรมใดไม่ได้ | CONNECT |
| U4 | ไม่มี trace กลาง (มีแต่ request_id ของ AI) | ตรวจสอบย้อนกลับทั้งเส้นไม่ได้ | CONNECT |
| U5 | ไม่มี billable quantity/unit price | คำนวณ charge ไม่ได้ | BUILD |
| U6 | ไม่มี idempotency ของ usage | event ซ้ำจะคิดเงินซ้ำ | BUILD (unique key) |
| U7 | API/DB/GPU/network ไม่มี meter | บริการเหล่านั้นตั้งราคาไม่ได้ | BUILD/PARTIAL |
| U8 | ไม่มี reconciliation กับ Canonical Finance | ยอดรวมรายบริการไม่ตรงบัญชี | BUILD |

---

## 5. เกณฑ์ผ่านของ meter (ข้อเสนอ ไม่ได้สร้างรอบนี้)

1. ทุก usage row มี `tenant_id`, `service_type`, `transaction_id` (nullable เฉพาะ non-transaction service), `trace_id`, `occurred_at`
2. unique key ต่อ `(source, source_event_id, service_type)` → event ซ้ำไม่เพิ่มหน่วย
3. มี `quantity` + `unit` ที่ derive จาก source ได้ ไม่ใช่กรอกมือ
4. มี read model `revenue_by_service` ที่ **อ่านจาก fee charge** ไม่ใช่จาก invoice gross
5. ยอด `SUM(fee_charges)` ต่อเดือน = ยอดในรายงานการเงิน (reconciliation test)
6. ถ้าข้อมูลไม่ครบ → รายงาน `UNKNOWN` ไม่ใช่ `0`

---

## 6. ข้อสรุป

- **มีอยู่:** event evidence 8 ประเภท, AI usage meter 1 ตัว (ไม่ผูก tenant), audit/version trace
- **ยังไม่มี:** billable meter, service registry, tenant attribution, ราคา, ใบเรียกเก็บ, revenue recognition
- **สถานะรวม: `METERED_NOT_BILLABLE`** — วัดปริมาณได้บางส่วน แต่ **วัดรายได้ไม่ได้**

---

## 7. Production snapshot (read-only, 2026-10-25)

| สัญญาณ | จำนวนจริง | หมายเหตุ |
|---|---|---|
| LINE events | **952** | in 583 / out 369 |
| Gateway events | **34** | LINE 11 · vscode 20 |
| AI tasks | **385** | pending 47 · failed 210 · done 128 |
| Worker usage | **104** | 132,771 tokens · failed 21 · UNKNOWN token 21 |
| — ลูกค้าจริง | **2 ครั้ง** | handle_text 1 · classify_image 1; ที่เหลือ benchmark/code.generate |
| Document versions | 123 | ยังไม่ถูก meter เป็นหน่วยบริการ |
| API tokens | 4 | ใช้ 3 · ไม่มี request log |
| Storage | 93 resources / **193.17 GB** | ยังไม่มี GB-month meter |
| Compute | **0 resources** | — |

> ตัวเลขนี้ยืนยันว่า meter ทำงาน แต่ **ยังไม่มีที่ไหนในระบบที่แปลงจำนวนเหล่านี้เป็นเงินได้** — และ AI usage เกือบทั้งหมดเป็น benchmark ไม่ใช่ภาระลูกค้า
