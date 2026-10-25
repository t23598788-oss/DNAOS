# WAVE 1 — CENTRAL AUTHORITY CONSOLIDATION (รายงานผล)
**วันที่:** 2026-10-25 · **HEAD:** `d7fbb05b` · **โหมด:** local source + offline test เท่านั้น
**ผลรวม: ⛔ BLOCKED — 0/14 จุดถูกย้าย (ตามเกณฑ์ STEP 03) · Direct Business Writes: 14 → 14**
**สิ่งที่เปลี่ยนจริงในรอบนี้:** เพิ่ม regression assertions 50 → 69 checks (ไฟล์ทดสอบเท่านั้น) · **ไม่มี diff ในโค้ดธุรกิจ**

---

## 01 OBJECTIVE — เกณฑ์ก่อน/หลัง

| # | เกณฑ์ | ก่อน (audit รอบก่อน) | หลังรอบนี้ | สถานะ |
|---|---|---|---|---|
| 1 | Provider เป็น transport เท่านั้น (ไม่มี business write) | 14 จุด | **14 จุด** | ⛔ ไม่เปลี่ยน |
| 2 | Business Intent เข้า Central Processing | ไม่มีชั้นกลาง | ไม่มี | ⛔ |
| 3 | การเปลี่ยนข้อมูลธุรกิจผ่าน Authority กลาง | 14 จุด bypass | 14 จุด bypass (วัดซ้ำแล้ว) | ⛔ |
| 4 | ทุกการเขียนมี Identity/Trace/Evidence/สิทธิ์ | audit ขาด actor | เท่าเดิม | ⛔ |
| 5 | คำสั่งซ้ำไม่สร้างธุรกรรมซ้ำ | event layer กันได้ / transaction layer ไม่มี guard | ยืนยันด้วย test ใหม่ (G5 FAIL) | ⛔ |
| 6 | Regression test ครอบ cross-channel | 50 checks | **69 checks (+19)** | ✅ ดีขึ้น |
| 7 | ไม่สร้าง Writer/Engine คู่ขนานใหม่ | — | ไม่ได้สร้าง | ✅ |

**เหตุผลที่ 0 จุดถูกย้าย:** STEP 03 อนุญาตเฉพาะจุดที่มี **(a) Existing Canonical Authority ที่รองรับแล้ว** และ **(b) Offline Test ครบ** — และห้ามย้ายราคา/อนุมัติภาษีเข้า writer ที่ยังไม่มี **Scope Validation** ผลตรวจคือ **ไม่มีจุดใดผ่านทั้งสองเงื่อนไข** (รายละเอียด §02.3) จึงหยุดทุกจุดตามคำสั่ง "ให้หยุดเฉพาะการย้ายจุดนั้นและรายงาน BLOCKED"

---

## 02 SOURCE EVIDENCE

### 2.1 STEP 1 — เส้นทางที่ใช้งานจริง (ข้อความหนึ่งรายการถูกประมวลผลกี่ครั้ง)

| ลำดับ | จุด | สิ่งที่เกิดขึ้น | หลักฐาน |
|---|---|---|---|
| 1 | `supabase/functions/line-webhook-v2/index.ts` (signature) | ตรวจ `x-line-signature` | `middleware/signature.ts` |
| 2 | `index.ts:90–113` `processEvent()` | **ประมวลผลธุรกิจเต็ม** (text/location/image/file/audio/postback) | switch ที่ L98–112 |
| 3 | `index.ts:132` `forwardLineInbound(rawBody, signature)` | ส่ง raw body เข้า `app/api/gateway/observe/line` → adapter → bus | `_shared/connect-forward.ts:26` |
| 4 | `index.ts:139–144` | `EdgeRuntime.waitUntil(processAll)` **และ** `waitUntil(forward)` — ทั้งคู่รัน | L137–144 |
| 5 | ปลายทาง A | `integration_gateway_events` (upsert by `event_id`) | `evidence/store.ts:12` |
| 6 | ปลายทาง B | ตารางธุรกิจ/การเงิน (14 จุด §02.3) | test B |

→ **ข้อความเดียว = 2 การประมวลผล** (event กลาง + legacy business) และ `connect-forward.ts:6–14` ระบุเองว่าเป็นขั้น "additive" ที่ยังไม่ retire

**Response side (ตรวจตาม STEP 1):**
| เส้นทาง | ที่อยู่ | หมายเหตุ |
|---|---|---|
| Edge reply/push | `engines/response.ts:154,192,228,234,251` | ใช้ token จาก connector `line` |
| Next push | `registry/communication.ts:37–88` | ใช้ connector เดียวกัน (Run gate) |
| Meta reply | — | 🔴 **ไม่มี** (ไม่มี `graph.facebook.com` ที่ไหนในโปรเจกต์) |

### 2.2 STEP 2 — จัดกลุ่ม 14 จุด + Existing Authority ที่ต้องรับคำสั่ง

| กลุ่ม | จุด (ไฟล์:บรรทัด) | Existing Authority ที่มีจริง | Input Contract ที่ต้องมี | Regression test | ผ่านเกณฑ์ย้าย? |
|---|---|---|---|---|---|
| **A. ราคาและคำขอราคา** | `supplier-quote-reply.ts:68` (pit_materials.update), `:70` (insert), `:51` (pit_price_requests.update) | มี "route เขียนราคา" (`app/api/admin/pits/[pitId]/materials/route.ts:62–87`) แต่ **ไม่มี scope validation** และไม่ atomic | `{ request_id, seller_company_id, material_type_id, price, source_message_id, actor }` + ตรวจเจ้าของ/ผู้รับมอบ | ต้องมี `price-write-authority.test.ts` (ยังไม่มี) | ⛔ **ห้าม** (STEP 03: ห้ามย้ายราคาเข้า writer ที่ไม่มี scope validation) |
| **B. สิทธิ์อนุมัติ/มอบอำนาจ** | `authorization-check.ts:60` (pending_authorizations.insert), `handlers/postback.ts:100` (update) | ไม่มี authority กลาง (ตารางเป็นข้อความอิสระ; `authority_grants` ยังเป็น proposal) | `{ claimant, responsible, company_id, transaction_id, scope, evidence_message_id }` | ต้องมี `authority-claim.test.ts` (ยังไม่มี) | ⛔ ไม่มี authority ให้ย้าย |
| **C. สถานะการชำระเงิน** | `print-jobs.ts:100,147` (paid), `:74` (amount_expected), `:42` (insert), `:111` (method) | `confirmPayment` (canonical) **แต่ไม่ผูกกับ `print_jobs`** (ไม่มี FK/ตารางกลาง) | ต้องมี print-job ↔ receipt linkage ก่อน | ต้องมี `print-job-payment.test.ts` (ยังไม่มี) | ⛔ ไม่มี authority ครอบ |
| **D. สถานที่/โครงการ** | `event-followup.ts:527,542`, `handlers/location.ts:62` (customer_sites.insert) | `app/api/admin/sites/route.ts:31` (POST + ADMIN_TIER) — route เดียว แต่ไม่มี canonical writer/scope | `{ company_id, site fields, geocode, source_message_id, actor }` | ต้องมี `site-create-authority.test.ts` (ยังไม่มี) | ⛔ ไม่มี canonical authority + ไม่มี offline test |
| **E. สถานะค่าบริการ** | `owner-dispatcher.ts:154` (supabase_billing_events.update) | `payable.transition` (canonical, เรียกผ่าน connect-expense ที่ L118 แล้ว) | ควรเป็น **derived read model** ไม่ใช่ write | ต้องมี `billing-status-derived.test.ts` (ยังไม่มี) | ⛔ ต้องเปลี่ยนสถาปัตยกรรม + กระทบผู้อ่านข้อมูล |

### 2.3 จำนวน Direct Business Writes (ก่อน → หลัง)

| กลุ่ม | ก่อน | หลัง | เปลี่ยน |
|---|---|---|---|
| A ราคา | 3 | 3 | 0 |
| B อำนาจ | 2 | 2 | 0 |
| C การชำระเงิน (print) | 5 | 5 | 0 |
| D สถานที่ | 3 | 3 | 0 |
| E ค่าบริการ | 1 | 1 | 0 |
| **รวม** | **14** | **14** | **0** |

> ตัวเลขนี้มาจากการรัน `scripts/central-processing-boundary.test.ts` ซ้ำหลังแก้ (census ตัวเดียวกัน เกณฑ์เดียวกัน)

### 2.4 STEP 3 — สิ่งที่ทำได้จริงในรอบนี้ (และไม่ได้ทำ)

| รายการ | สถานะ |
|---|---|
| แก้โค้ดธุรกิจ/ย้าย 14 จุด | ❌ ไม่ได้ทำ (ไม่มีจุดผ่านเกณฑ์) |
| สร้าง writer/engine ใหม่ | ❌ ไม่ได้ทำ |
| เพิ่ม/แก้ migration | ❌ ไม่ได้ทำ |
| เปลี่ยน UI | ❌ ไม่ได้ทำ |
| ส่งข้อความจริง | ❌ ไม่ได้ทำ |
| **เพิ่ม regression assertions (STEP 4)** | ✅ ทำ — `scripts/central-processing-boundary.test.ts` (+19 checks, section G) |

**Diff ที่เกิดขึ้นจริง (ไฟล์เดียว):** `scripts/central-processing-boundary.test.ts` — เพิ่ม section `G` (7 การตรวจ) และปรับ check bridge/meta-outbound ให้แม่นยำ (ตัด false positive 2 จุด) · ไม่แตะไฟล์ `.ts`/`.tsx` อื่น

---

## 03 RESULT

### 3.1 STEP 4 — ผลทดสอบ cross-channel (LINE + Meta, mock ที่มีความหมายทางธุรกิจเดียวกัน)

| ข้อกำหนด | ผล | หลักฐาน |
|---|---|---|
| ส่ง Intent เข้า Business Engine เดียวกัน | 🟡 บางส่วน | ทั้งคู่ → capability `message.received`, `channel=observe`, contract เดียวกัน (C) · **แต่ยังไม่มี Business Intent engine กลาง** ให้เข้าร่วม |
| ไม่เรียก Financial Writer โดยตรง | 🟢 PASS | G2: adapter/observe 11 ไฟล์ ไม่มี token การเงิน |
| ไม่ออกเอกสารใน Provider | 🟢 PASS | G3: 0 `createDocument` / 0 document-table write ใน provider tier |
| ไม่แก้ราคากลางจากข้อความโดยไม่ตรวจสิทธิ์ | 🔴 **FAIL** | G4: `supplier-quote-reply.ts` เขียน `pit_materials` โดยไม่มี authority/scope ใด ๆ |
| ไม่สร้าง Transaction ซ้ำ | 🔴 **FAIL** | G5: `transaction-write.ts` สร้าง `ORD-<date>-<ms>` ไม่มี idempotency key |
| ส่งผลกลับผ่านช่องทางเดิม | 🟡 LINE ✔ / **Meta ✗** | G6: LINE มี push/reply · Meta ไม่มี outbound path เลย |
| ไม่เปิดเผยข้อมูลข้ามองค์กร | 🔴 **FAIL** | F: actor ไม่มี company scope |

### 3.2 ผลรวม test (รันจริงรอบนี้)
```
checks=69  failed=6
GATE: FAIL (6 findings)
--strict → exit 1
tsc --noEmit → 0 error
```
6 findings: B(14 direct writes) · C(LINE ไม่มี sender id) · F(no company scope) · G4(price no permission) · G5(no tx idempotency) · G6(Meta ไม่มี outbound)

### 3.3 สรุปสถานะตามจุด (STEP 3 ผลลัพธ์)
| จุด | ผล |
|---|---|
| A ราคา/คำขอราคา (3) | ⛔ **BLOCKED** — ต้องมี Material Price command + scope validation + test ก่อน |
| B อำนาจ (2) | ⛔ **BLOCKED** — ต้องมี `authority_grants` (scope/วันมีผล/หลักฐาน) ก่อน |
| C ชำระเงิน print (5) | ⛔ **BLOCKED** — ต้องมี linkage กับหลักฐานชำระ + การตัดสินนโยบายเงินสด |
| D สถานที่ (3) | ⛔ **BLOCKED** — ต้องมี site command + scope + offline test |
| E ค่าบริการ (1) | ⛔ **BLOCKED** — ต้องเปลี่ยนเป็น derived read model (ต้องอนุมัติ) |

### 3.4 เงื่อนไขปลดล็อก (เรียงลำดับที่ทำได้จริง)
1. **Material Price command** (รวม 2 writer ที่มีอยู่เป็นคำสั่งเดียว) + `price.*` ใน audit + scope check → ปลดล็อก A (3 จุด)
2. **authority_grants** + คำสั่ง `authority.request/decide` → ปลดล็อก B (2 จุด)
3. **print_job ↔ receipt linkage** + นโยบายเงินสด → ปลดล็อก C (5 จุด)
4. **site command** + scope → ปลดล็อก D (3 จุด)
5. **billing status เป็น derived** → ปลดล็อก E (1 จุด)
6. เมื่อครบ: retire legacy handler + เปิด `--strict` เป็น CI gate

### 3.5 Decisions ที่ยังค้าง (จากรอบก่อน ยังไม่ตอบ)
1. ราคาจากคำตอบผู้ขาย: มีผลทันที หรือรอคนยืนยัน
2. เงินสด print jobs: คง `paid` ทันที หรือเปลี่ยนเป็นรับเงินปลายทาง
3. ผู้รับผิดชอบบริษัท: first-link ได้ไหม หรือต้องมี grant เท่านั้น
4. LINE sender identity: เพิ่ม `sender_id` หรืออ้าง `line_events.id`
5. จังหวะ retire legacy LINE pipeline

> **STOP** — รอบนี้ไม่มี production change, ไม่มี migration, ไม่มี commit/push/deploy และไม่มีข้อความจริง
