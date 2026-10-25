# PROVIDER DIRECT WRITE MATRIX
**วันที่:** 2026-10-25 · **แหล่งข้อมูล:** `scripts/central-processing-boundary.test.ts` (check B) รันจริงรอบนี้
**ผล:** พบ direct business write **14 จุด** ใน provider tier (`supabase/functions/line-webhook-v2`)

> เกณฑ์: provider/adapter เขียนได้เฉพาะ "หลักฐานการสื่อสาร" (transport/evidence) — ห้ามเขียนธุรกิจ การเงิน ราคา เอกสาร ภาษี อำนาจ

---

## 01 MATRIX — 14 จุดที่ต้องย้ายอำนาจ

| # | ไฟล์:บรรทัด | ตาราง.operation | หมวด | ความเสี่ยง | อำนาจกลางที่ถูกต้อง |
|---|---|---|---|---|---|
| 1 | `engines/supplier-quote-reply.ts:68` | `pit_materials.update` | **ราคา (ธุรกิจ)** | 🔴 สูงสุด — ข้อความ LINE เปลี่ยนราคาขายจริง, ไม่มี audit, ไม่มีเวอร์ชัน | Material Price writer (single command) + `recordCanonicalAudit` |
| 2 | `engines/supplier-quote-reply.ts:70` | `pit_materials.insert` | **ราคา** | 🔴 สูงสุด — สร้างราคาใหม่จากข้อความ | เดียวกัน (create) |
| 3 | `engines/supplier-quote-reply.ts:51` | `pit_price_requests.update` | สถานะข้อเสนอ | 🟠 สูง — เปลี่ยน lifecycle ของคำขอโดยไม่ผ่าน writer | RFQ command central |
| 4 | `engines/authorization-check.ts:60` | `pending_authorizations.insert` | **อำนาจ** | 🔴 สูง — สร้างบันทึกอำนาจจากข้อความผู้กล่าวอ้าง | Authority model (`authority_grants`) |
| 5 | `handlers/postback.ts:100` | `pending_authorizations.update` | **อำนาจ** | 🔴 สูง — อนุมัติ/ปฏิเสธอำนาจใน transport tier | Authority decision command (central) |
| 6 | `engines/print-jobs.ts:100` | `print_jobs.update` (status=`paid`, cash) | **การเงิน** | 🔴 สูง — "จ่ายเงินแล้ว" โดยไม่มีหลักฐานการชำระ | Payment evidence → `payment_allocations` หรือ state `collect_on_pickup` |
| 7 | `engines/print-jobs.ts:147` | `print_jobs.update` (status=`paid`, amount_paid) | **การเงิน** | 🔴 สูง — ยอดรับเงินเขียนจากข้อความ | เดียวกัน (ต้องมี receipt/หลักฐาน) |
| 8 | `engines/print-jobs.ts:42` | `print_jobs.insert` | คำสั่งบริการ | 🟠 กลาง — สร้างงานพิมพ์ (มีราคา `amount_expected`) | Canonical service-order command |
| 9 | `engines/print-jobs.ts:74` | `print_jobs.update` (copies, amount_expected) | **ราคา** | 🟠 กลาง — คำนวณเงินใน provider tier | คำนวณใน central (ใช้ pricing engine เดิม) |
| 10 | `engines/print-jobs.ts:111` | `print_jobs.update` (payment_method) | การเงิน (อ่อน) | 🟡 ต่ำ | เก็บเป็น transport preference ได้ แต่ต้องไม่ใช่สถานะจ่าย |
| 11 | `engines/owner-dispatcher.ts:154` | `supabase_billing_events.update` (status=`paid`) | **บัญชี/การเงิน** | 🟠 สูง — ปิดบิล SaaS จากข้อความ | Canonical expense/payable state (มี bridge อยู่แล้วบางส่วน) |
| 12 | `engines/event-followup.ts:527` | `customer_sites.insert` | ข้อมูลหลัก | 🟠 กลาง — สร้างไซต์จากพิกัด/ข้อความ | Site command central (ตรวจบริษัท/สิทธิ์) |
| 13 | `engines/event-followup.ts:542` | `customer_sites.insert` | ข้อมูลหลัก | 🟠 กลาง | เดียวกัน |
| 14 | `handlers/location.ts:62` | `customer_sites.insert` | ข้อมูลหลัก | 🟠 กลาง | เดียวกัน |

### 1.1 สรุปรายหมวด
| หมวด | จำนวน | จุด |
|---|---|---|
| ราคา/มูลค่าเงิน | 4 | #1, #2, #9 + (#6/#7 เป็นการเงิน) |
| การเงิน/บัญชี | 3 | #6, #7, #11 |
| อำนาจ | 2 | #4, #5 |
| ข้อมูลหลัก (ไซต์) | 3 | #12, #13, #14 |
| สถานะข้อเสนอ/บริการ | 2 | #3, #8 (และ #10 อ่อน) |

---

## 02 สิ่งที่ "อนุญาต" ให้ provider tier เขียน (transport/evidence เท่านั้น)

| ตาราง | เหตุผล | สถานะ |
|---|---|---|
| `line_events` | หลักฐานข้อความขา/ออก + สถานะประมวลผล | ✅ อนุญาต |
| `ai_tasks` | คิวงานสกัดข้อมูล (ไม่ใช่ผลลัพธ์ธุรกิจ) | ✅ |
| `conversation_states` | สถานะบทสนทนา (ชั่วคราว, มี expires_at) | ✅ |
| `entity_registry` | ผลสกัดกลาง ๆ (staging) | 🟡 อนุญาตแบบมีเงื่อนไข — ห้ามใช้แทนตารางธุรกิจ |
| `line_profiles`, `line_conversation_controls`, `line_customer_memory` | ข้อมูลช่องทาง/ควบคุมบทสนทนา | ✅ |
| `line_outbound_drafts` | ร่างข้อความ + สถานะรีวิว | ✅ (แต่ควรมี message record, ดู SELLER_LINE_AUTOMATION) |
| `bank_notifications.matched_receipt_document_id` | เชื่อมหลักฐานธนาคาร ↔ สลิป | 🟡 ควรอยู่ใน Connect evidence layer |
| `print_jobs` | ❌ **ไม่ใช่ transport** — มีราคา/สถานะจ่าย | ต้องย้าย (ดู #6–#10) |

---

## 03 หลักฐานการรัน (รอบนี้)

```
FAIL  B 14 direct business write(s) remain in the provider tier
PASS  B bridge connect-event.ts        — central boundary only
PASS  B bridge connect-expense.ts      — central boundary only
PASS  B bridge connect-forward.ts      — central boundary only (→ /api/gateway/observe/line)
PASS  B bridge connect-identity.ts     — read-only (no transport, no write)
PASS  B bridge connect-inbound.ts      — central boundary only
PASS  B bridge connect-payment.ts      — central boundary only
```

**ข้อสังเกตสำคัญ (เป็นข่าวดี):** เส้นทางการเงินหลัก 3 เส้นถูกย้ายเข้า bridge เรียบร้อยแล้วในโค้ดปัจจุบัน
- สลิป/เอกสารรับเงิน → `connect-inbound` → `inbound-write` (receipt_documents ไม่ถูกเขียนตรงแล้ว)
- ค่าใช้จ่าย/payable → `connect-expense` → `expense-write`
- business_events → `connect-event` → `event-write`
- การรับชำระ → `connect-payment` → `receipt-confirm-flow` → `confirmPayment`
→ **เหลือ 14 จุดที่ยังเป็น "อำนาจค้าง" ใน provider tier** ไม่ใช่ระบบทั้งระบบ

---

## 04 ความเสี่ยงเชิงสถาปัตยกรรม (ไม่ใช่แค่ bug)

| ความเสี่ยง | คำอธิบาย |
|---|---|
| R1 Truth divergence | LINE ข้อความเดียวถูกประมวลผล 2 ทาง (observe event + legacy business writes) — ข้อมูลกลางกับข้อมูลธุรกิจอาจไม่ตรงกัน |
| R2 No audit trail | ทั้ง 14 จุดไม่มี `recordCanonicalAudit` → ตรวจย้อนไม่ได้ว่าใครเปลี่ยนราคา/อนุมัติ |
| R3 Authority by accident | `pending_authorizations` + first-link = การได้มาซึ่งอำนาจโดยพฤตินัย (ไม่มีการมอบหมาย) |
| R4 Money without evidence | `print_jobs.status='paid'` (cash) ไม่มีหลักฐานการชำระ แต่มีผลต่อรายได้/ภาษี |
| R5 Provider lock-in | ถ้าเพิ่ม Messenger/เว็บจริง ต้องสร้าง pipeline ซ้ำถ้าไม่ย้าย 14 จุดนี้ก่อน |

---

## 05 สิ่งที่ **ไม่พบ** (ยืนยันแล้ว)
- ไม่มี `LINE Invoice`, `Messenger Invoice`, provider-specific document engine — canonical writer เป็น provider-independent (test D: 11/11 ไฟล์ผ่าน)
- ไม่มี provider fee engine (ไม่มี fee model เลย)
- adapters (`engines/integration-gateway/adapters/*`) และ observe routes ไม่มีการเขียน business table (test A: PASS ทุกไฟล์)

> รายการแก้ไข/ลำดับงานอยู่ใน `CANONICAL_WRITER_ENFORCEMENT_PLAN.md` — ยังไม่มีการแก้โค้ดในรอบนี้
