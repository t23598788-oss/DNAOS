# DNA OS — REVENUE CAPABILITY INVENTORY
**วันที่:** 2026-10-25 · **HEAD:** `d7fbb05b` · **หลักฐาน:** source code, schema/migrations, registry, offline tests
**ข้อจำกัด:** รอบนี้ **ไม่มีการเชื่อมต่อ production DB / LINE / ผู้ให้บริการเงิน** จึงไม่มี `LIVE VERIFIED` ใหม่ — สถานะ LIVE ที่อ้างถึงเป็นข้อเท็จจริงจากหลักฐานภายใน repo (REALITY_INVENTORY_STEP1.md, 2026-08-10) และถูกทำเครื่องหมายว่า **ไม่ re-verify รอบนี้**

## ระดับสถานะที่ใช้

| สถานะ | ความหมาย |
|---|---|
| EXISTS | มีโค้ด/ตารางจริงใน source |
| TESTED | มี test ใน repo และรันผ่านรอบนี้ (static/mock/local DB) |
| LIVE VERIFIED | มีหลักฐานการใช้งาน production จริง — **รอบนี้ไม่มีใหม่** |
| BLOCKED | มีของ แต่ติดสิทธิ์/ข้อมูล/ระบบที่ยังไม่ผ่าน |
| MISSING | ไม่มีใน source |

---

## 1. ตารางความสามารถหลัก

| # | ความสามารถ | สถานะ | หลักฐาน Source / Schema | Test / ข้อจำกัด |
|---|---|---|---|---|
| 1 | Connect Gateway (normalize provider → canonical event) | EXISTS · TESTED | `engines/integration-gateway/adapters/{line,meta}.ts` · `app/api/gateway/observe` · `docs` event contract | `central-processing-boundary` C, `connect-channel-receive` 77/77 |
| 2 | Webhook Inbound (LINE) | EXISTS · TESTED · (LIVE 08-10, not re-verified) | `supabase/functions/line-webhook-v2/index.ts:85-144` · `line_events` | signature/dup/retry 77/77 · outbound ถูก kill switch |
| 3 | Response Gateway (central outbound) | **MISSING** | ไม่มี module กลาง; outbound อยู่ที่ `line-webhook-v2/engines/response.ts` + `line_outbound_drafts` | Meta ไม่มี outbound (G6 BLOCKED) · non-owner reply ถูก suppress (`response.ts:98`, FCR-016) |
| 4 | Identity | EXISTS · TESTED | `profiles` (role only) `full_schema.sql:1439` · `connect_external_identities` `20260923000003:50` | `connect-identity-model` 54/54 · ไม่มี organization membership |
| 5 | Organization / Tenant | **PARTIAL / MISSING** | ใช้ `companies` + `customer_company_id` บนเอกสาร/ออเดอร์; ไม่มี `organizations`/`org_members` | tenant ผูกได้เฉพาะเอกสาร ไม่ผูก user/usage |
| 6 | Resource Registry | **PARTIAL** | `pit_profiles`, `material_types`, `customer_sites`, `vehicle_types`, `equipment_assets`, `match_queue`, `resource_transactions` | ไม่มี registry เดียว; `cognitive/state/resource-graph.ts` เป็น AI graph ไม่ใช่ทะเบียนธุรกิจ |
| 7 | Resource Matching | EXISTS (legacy) | `match_queue` `20260709000003:40` · `engines/material-resolver.ts` | ไม่มี event log การจับคู่/ไม่มีการคิดค่าจับคู่ |
| 8 | Transaction / Business Events / Jobs | EXISTS · TESTED | `engines/canonical/transaction-write.ts` · `business_events` · `engines/jobs/auto-create.ts` | idempotency 11/11 · `customer_orders.order_no` UNIQUE |
| 9 | Canonical Finance / Accounting Kernel | **PARTIAL** | `payment-write.ts`, `receipt-confirm-flow.ts`, `debt-write.ts` · `payment_allocations` `20260922000001:132` | ไม่มี general ledger — `business-coverage.json` accounting = `not_covered` |
| 10 | Document Writer | EXISTS · TESTED | `engines/canonical/document-write.ts` · `engines/documents/engine.ts` · `document_versions` | `document-authority-census` 58/58 |
| 11 | Receipt / Invoice | EXISTS · TESTED | `invoices` `full_schema.sql:1135` · `receipt_documents` `20260717000002:7` | payment allocation atomic ผ่าน local DB proof (suite เดิม) |
| 12 | Processing Fee / Fee Contract | **MISSING** | สูตร `system_fee` อยู่ใน `engines/pricing.ts:27-64` แต่ **0 production callers**; ไม่มี `fee_contracts`/`fee_charges` | `revenue-metering-audit-test` C · `BUILT_NOT_WIRED` (FCR-013) |
| 13 | Resource Usage / AI Gateway | **PARTIAL** | `worker_usage_events` `20260810000002:13` · `ai_tasks` · `usageMeterRuntime.ts` · `gateway/` | meter มี token/latency จริง แต่ไม่มี tenant/ราคา/ใบเรียกเก็บ |
| 14 | Runtime / Compute / Database / Storage | **PARTIAL** | `registry/infrastructure.json` (declared) · `registry/COMPUTE_RESOURCE_REGISTRY.json` (**0 resources**) · `storage_resources` | ไม่มี compute ที่ลงทะเบียน; cost เป็น declared ไม่ใช่ invoice |
| 15 | Audit / Evidence / Provenance | EXISTS · TESTED | `engines/canonical/audit.ts` · `audit_logs` · `integration_gateway_events.evidence` · `document_versions` | audit `company_id` เป็น optional/null |
| 16 | Business API | EXISTS · TESTED | `app/api/v1/query/route.ts` · `api_tokens` `20260705000006:7` | ไม่มี per-request metering; `last_used_at` อย่างเดียว |
| 17 | Report Reader | EXISTS · PARTIAL | `app/api/admin/finance-summary/route.ts` · `services/public-catalog/reader.ts` | finance summary เป็น GMV ไม่ใช่ platform revenue |

## 2. สรุปเชิงตัวเลข (นับจากตารางข้างบน)

| สถานะ | จำนวน |
|---|---|
| มีโค้ด/ตารางจริง (EXISTS/PARTIAL) | **14** |
| ผ่าน test ในรอบนี้ | **8** (Connect, Webhook, Identity, Transaction, Document, Receipt/Invoice, Audit, Business API) |
| PARTIAL | **6** (Org, Resource Registry, Finance, Usage, Runtime, Report) |
| MISSING | **2** (Response Gateway, Fee Contract) |
| LIVE VERIFIED ใหม่รอบนี้ | **0** |

> ตัวเลข EXISTS/PARTIAL นับซ้ำกันได้ เพราะบางรายการมีโค้ดจริงแต่ยังไม่ครบทั้ง capability

> หมายเหตุ: ตัวเลขนี้ไม่ใช่ "ความพร้อม production" — เป็นการมีอยู่ของโค้ด/ตารางและหลักฐาน test ในเครื่อง

## 3. หลักฐานสำคัญที่ทำให้ความสามารถด้านรายได้ยังไม่ครบ

1. **Fee engine ไม่ถูกเรียกจากเส้นทางจริง** — `engines/pricing.ts:24` ถูก import เฉพาะ `engines/index.ts:9` ซึ่งไม่มี production caller; dispatcher คิด `total_price = unitPrice × qty + transportCost` (`engines/validation/dispatcher.ts:146`)
2. **ไม่มีที่เก็บข้อตกลงค่าบริการ** — ไม่มี `fee_contracts`, `fee_charges`, `revenue_recognitions`, `platform_revenue` ในทุก migration (`revenue-metering-audit-test` B)
3. **Usage ไม่มี tenant** — `worker_usage_events`, `integration_gateway_events`, `line_events` ไม่มี `company_id`/`tenant_id` (test E)
4. **การเงินเป็นของธุรกิจปฏิบัติการ ไม่ใช่ของ DNA OS** — `finance-summary:70-74` รวม `gross` ของเอกสารเป็น `revenue_documented` = GMV
5. **ไม่มีบัญชีแยกประเภท** — `registry/business-coverage.json` → `accounting: not_covered`
6. **ต้นทุน AI ยังว่าง** — `registry/COST_LEDGER.json` entries = **0**, `COST_BUDGETS.json` budgets = **0**

## 4. Regression ที่เกี่ยวข้องรอบนี้

```bash
npx tsx scripts/revenue-metering-audit-test.ts   # 66/66 PASS
npx tsx scripts/material-price-authority.test.ts # 45/45 PASS (WAVE 3)
npx tsx scripts/authority-scope-and-concurrency.test.ts # 40/40 PASS
npx tsc --noEmit                                 # 0 error
```
