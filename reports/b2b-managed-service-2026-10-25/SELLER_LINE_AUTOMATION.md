# SELLER LINE AUTOMATION (เชื่อม LINE ผู้ขายผ่าน Connect Gateway เดิม)
**วันที่:** 2026-10-25 · **สถานะ:** ตรวจของจริง + ข้อเสนอ — **ไม่มีการส่งข้อความจริงถึงพาร์ตเนอร์ในรอบนี้**
**อ้างอิง:** `B2B_TRANSACTION_LIFECYCLE.md` §2.2–2.3

> 🟢 PROVEN · 🟡 โค้ดจริง (ยังไม่รันกับผู้รับจริง) · 🔴 MISSING · 🔵 PROPOSED

---

## 01 OBJECTIVE

ทำให้ "ส่งคำขอถึงผู้ขาย → ได้รับคำตอบ → ยืนยันการขาย" เป็นเหตุการณ์ที่ **แยกสถานะกันได้** และตรวจย้อนได้ โดยใช้ Connect Gateway + LINE OA ที่มีอยู่ ไม่สร้าง Response Gateway ใหม่

**เกณฑ์ผ่าน**
1. 4 สถานะแยกกัน: `ส่งคำขอแล้ว` / `ส่งข้อความสำเร็จ` / `ได้รับการตอบกลับ` / `ยืนยันการขาย`
2. การส่งสำเร็จไม่ทำให้เกิดการยืนยันขายหรือรายได้
3. ผู้รับ (LINE userId) ต้องมาจากการเชื่อมที่ยืนยันแล้วเท่านั้น ห้ามเดาจากชื่อ
4. ข้อความซ้ำไม่สร้างคำขอซ้ำ/ไม่บันทึกราคาซ้ำ
5. ส่งไม่สำเร็จต้องไม่เปลี่ยนสถานะใด ๆ และต้องตามได้

**ผลรวม: 🔴 BLOCKED สำหรับ automation เต็มรูปแบบ** — ส่งได้จริงและรับข้อความได้จริง แต่ **ไม่มี transaction linkage, ไม่มี message id ขาออก, ไม่มีสถานะ "ยืนยันการขาย"** และไม่มีตัวตรวจสิทธิ์ผู้ขาย

---

## 02 SOURCE EVIDENCE — ความสามารถจริง

### 2.1 ชั้นส่งข้อความ (ของเดิม ใช้ซ้ำได้ทั้งหมด)
| องค์ประกอบ | ข้อเท็จจริง | หลักฐาน |
|---|---|---|
| ตัวส่งกลาง | `sendLineMessage(db, to, messages)` — ดึง token จาก connector `line` ผ่าน Run gate | `registry/communication.ts:37–61` |
| ผลลัพธ์ | คืน `{ success: true }` หรือ `{ success:false, error }` — **ไม่มี messageId** (LINE push คืน `{}`) | `registry/communication.ts:72–88` (คอมเมนต์บรรทัด 82) |
| ตัวส่งที่มี UI ยืนยัน | `POST /api/admin/notifications/send` (ADMIN_TIER, ไม่มี auto-send) | `app/api/admin/notifications/send/route.ts` |
| ร่างข้อความ + สถานะรีวิว | `line_outbound_drafts` (`pending_review → sent`, `reviewed_at`, `sent_at`) · ส่งซ้ำคืน 409 | `20260710000006:14–26` · `outbound-drafts/[id]/send/route.ts` |
| เส้นทางขอราคาผู้ขาย (RFQ) | `POST /api/admin/pits/[pitId]/request-quote` → push LINE + สร้าง `pit_price_requests` | route §2.2 |
| ตัวรับข้อความ | `line_events` เก็บ `line_user_id, raw_text, line_message_id, reply_token, extracted` | `20260709000002_line_events.sql:6–21` |
| ตัวแปลงคำตอบผู้ขาย | `trySupplierQuoteReply` — ต้องเป็น pit ที่รู้จัก + มี request `pending` + มีตัวเลข | `supabase/functions/line-webhook-v2/engines/supplier-quote-reply.ts` |
| ตัวตนผู้ขาย | `resolveExternalIdentity` / `resolveProviderSubjectsForCompany` / `listProviderIdentities` | `engines/connect/identity.ts:69,126,137` |
| failure bridge | `normalizeSendResult` แยกความล้มเหลว infra ออกจาก business | `app/api/admin/ide/_lib/businessFailureBridge` |

### 2.2 ช่องว่างที่วัดได้
| # | ช่องว่าง | หลักฐาน |
|---|---|---|
| S1 | **ไม่มี message id ขาออก** → พิสูจน์ "ส่งถึง" ไม่ได้ รู้แค่ "ผู้ให้บริการรับงาน" | `communication.ts:82` |
| S2 | **ไม่มี delivery/read receipt** (ไม่มี webhook สถานะข้อความขาออก) | grep ไม่พบ handler delivery/read |
| S3 | **ไม่มี transaction linkage** บนคำขอ/ร่างข้อความ | `pit_price_requests`, `line_outbound_drafts` ไม่มี `transaction_id` |
| S4 | **ส่งก่อนสร้างแถวคำขอ** (race: คำตอบมาก่อน insert = หลุด) | `request-quote/route.ts` ลำดับ send → insert |
| S5 | **ไม่มี dedup ขาเข้า** — `line_events.line_message_id` ไม่มี unique index | `20260709000002` (ไม่มี unique) |
| S6 | **คำตอบผู้ขายไม่ผูกกับข้อความ/ธุรกรรม** — ผูกกับ pit + request ล่าสุดเท่านั้น | `supplier-quote-reply.ts` (`.limit(1)` + pending) |
| S7 | **ไม่มีสถานะ "ยืนยันการขาย"** — มีแค่ `pending/answered/expired` + `reply_price` | `pit_price_requests` CHECK |
| S8 | **เขียน `pit_materials` ตรงข้าม writer + ไม่มี audit** | `supplier-quote-reply.ts` |
| S9 | **ไม่มี authority ของผู้ขาย** ก่อนถือว่าตอบแทนได้ | TAX G2 (ไม่มี `authority_grants`) |
| S10 | **audit ของการส่งไม่มี actor_user_id** | `notifications/send/route.ts#logNotification` |
| S11 | `line_outbound_drafts.status` เป็น text ไม่มี CHECK | `20260710000006:22` |
| S12 | ไม่มี retry policy/backoff ที่บันทึกไว้ (ส่งซ้ำ = ผู้ใช้กดใหม่) | grep ไม่พบ retry ใน send path |

---

## 03 สถานะที่ต้องแยก (🔵 PROPOSED state machine)

```
[1] REQUESTED        ผู้ใช้กดส่ง / ระบบสร้างคำขอ (ยังไม่แตะ LINE)
      │  บันทึกคำขอ + idempotency_key + transaction_id
      ▼
[2] DISPATCHED       ผู้ให้บริการรับงาน (HTTP 2xx)  ← "ส่งข้อความสำเร็จ" อยู่ชั้นนี้เท่านั้น
      │  เก็บ sent_at + provider result (ไม่ใช่หลักฐานส่งถึง)
      ▼
[3] DELIVERED        (ถ้ามี) webhook สถานะข้อความจากผู้ให้บริการ — วันนี้ยังไม่มี
      │
      ▼
[4] REPLIED          มีข้อความขาเข้าจาก line_user_id ที่บาลานซ์กับคำขอ (line_events.id)
      │  ผูก: request_id + line_event_id + transaction_id
      ▼
[5] SELLER_ACCEPTED  ผู้ขายยอมรับเงื่อนไข (ราคา/ปริมาณ/ส่งมอบ) — ต้องมี "ข้อความที่อ้างได้"
      │  ไม่เกิดอัตโนมัติจากการส่ง/การตอบตัวเลข
      ▼
[6] (แยก) ORDER_CONFIRMED / DOCUMENT_ISSUED   ← คนละแกนกับการสื่อสาร
```

**กฎตายตัว**
- `DISPATCHED` **ห้าม** เปลี่ยน `SELLER_ACCEPTED`
- ตัวเลขในข้อความตอบกลับเป็น **ข้อเสนอราคา** ไม่ใช่การยอมรับ (ต้องมีขั้นยืนยัน)
- ทุก state ต้องมี `evidence_ref` (line_events.id / request_id / audit row)
- ถ้าข้อความตอบกลับไม่มีสัญญาณชัด → `return null` ปล่อยให้สายอื่นจัดการ (รักษาพฤติกรรมเดิมของ `trySupplierQuoteReply`)

---

## 04 กติกาการระบุตัวผู้รับ (identity) — ห้ามเดา

| กฎ | รายละเอียด |
|---|---|
| K1 | ผู้รับต้องมาจาก `company_line_links` ของ `companies` ที่เป็นผู้ขายในธุรกรรม **และ** มี `connect_external_identities` provider `line` ของ company นั้น |
| K2 | ถ้าไม่มี → **fail-closed** (`SELLER_LINE_NOT_LINKED`) ห้าม fallback ไปใช้ line_user_id จาก `line_events` ล่าสุด |
| K3 | ห้ามจับคู่จาก display name / ชื่อบ่อ / ข้อความเก่า (เพิ่มเป็น negative control ใน test) |
| K4 | หลาย LINE ต่อบริษัท → ต้องเลือก "primary" ที่ระบุชัด (`company_line_links` วันนี้ไม่มี flag primary → 🔵 ต้องเพิ่ม) |
| K5 | เปลี่ยนผู้รับ = ต้องมี audit + ผู้อนุมัติ |

---

## 05 กติกากันข้อความซ้ำ/ส่งซ้ำ

| ชั้น | กติกา proposed |
|---|---|
| คำขอ | `idempotency_key = rfq:<transaction_id>:<material_id>:<attempt>` unique |
| ผูกกับธุรกรรม | `request.transaction_id` NOT NULL (ใหม่) |
| ขาเข้า | unique `(line_message_id)` บน `line_events` (หรือตาราง dedup) — webhook ซ้ำ = no-op |
| คำตอบ | จับคู่ด้วย `request_id` ที่ยัง `pending` **และ** `transaction_id` ตรง; คำตอบที่มาหลัง `expired` = ไม่เขียนราคา |
| ส่งซ้ำ | ต้องเป็น action ของคน (เหมือน `outbound-drafts` 409) ไม่มี auto-retry ถึงผู้ขาย |

---

## 06 ความล้มเหลวและการติดตาม

| กรณี | พฤติกรรมที่ถูกต้อง | วันนี้ |
|---|---|---|
| connector ไม่พร้อม / token หาย | ไม่ส่ง, คืน error ชัด, ไม่เปลี่ยนสถานะ | ✅ (`communication.ts:50–61`, fail-closed) |
| provider 4xx/5xx | คืน `{success:false}`, แยกชั้นด้วย failure bridge | ✅ |
| ส่งสำเร็จแต่ผู้ขายไม่ตอบ | ค้างที่ `DISPATCHED`, มี deadline/expire | 🔴 ไม่มี deadline |
| ผู้ขายตอบแต่ไม่ชัด | ไม่เขียนราคา, เก็บข้อความเป็น event | ✅ (return null) |
| คำตอบซ้ำ (ผู้ให้บริการส่ง webhook ซ้ำ) | ไม่สร้าง event ซ้ำ | 🔴 ไม่มี unique |
| ผู้ขายตอบช้าเกิน | `expired` + แจ้งเจ้าของ | ⚠️ มี status `expired` แต่ไม่มีตัวตั้งเวลา |

---

## 07 MIGRATION PROPOSAL (🔵 ยังไม่ apply)

```sql
-- 1) คำขอถึงผู้ขายผูกกับธุรกรรม + idempotent
alter table public.pit_price_requests
  add column if not exists transaction_id uuid,          -- customer_orders.id
  add column if not exists idempotency_key text,
  add column if not exists dispatch_state text not null default 'requested',
  add column if not exists customer_site_id uuid;
create unique index if not exists pit_price_requests_idem_uidx
  on public.pit_price_requests (idempotency_key) where idempotency_key is not null;

-- 2) ข้อความขาออกต้องมีร่องรอย (ไม่มี messageId จากผู้ให้บริการ → เก็บผลลัพธ์จริง)
create table if not exists public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid,
  company_id uuid,
  to_line_user_id text not null,
  channel text not null default 'line',
  purpose text not null,                 -- rfq | seller_notice | draft_reply
  provider_status int,                   -- HTTP status จริง
  provider_result jsonb,                 -- body ที่ผู้ให้บริการคืน (ว่าง = {})
  provider_message_id text,              -- null จนกว่าจะมี API ที่คืนค่า
  idempotency_key text unique,
  requested_by uuid,                     -- profile จริง
  sent_at timestamptz,
  delivered_at timestamptz,
  failure_class text,
  created_at timestamptz not null default now()
);

-- 3) dedup ขาเข้า
create unique index if not exists line_events_message_uidx
  on public.line_events (line_message_id) where line_message_id is not null;

-- 4) สถานะยืนยันการขาย (แยกจาก price request)
create table if not exists public.seller_responses (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null,
  request_id uuid,
  seller_company_id uuid not null,
  line_event_id uuid,                    -- ข้อความที่อ้าง
  response_kind text not null check (response_kind in ('price','availability','conditions','decline')),
  price numeric, currency text default 'THB',
  conditions jsonb,
  accepted_at timestamptz,               -- เฉพาะเมื่อมีคน/ผู้ขายยืนยันชัด
  accepted_by uuid,
  evidence jsonb not null default '{}',
  created_at timestamptz not null default now()
);
```
> ทุกตารางใหม่เป็น **proposal** ตามข้อห้าม "ห้าม Apply Production Migration" และต้องรออนุมัติ
> ⚠️ unique index บน `line_events.line_message_id` (ข้อ 3) จะสร้างไม่ผ่านถ้ามีแถวซ้ำอยู่แล้ว — ก่อน apply ต้องนับ/เก็บหลักฐานแถวซ้ำและตัดสินวิธีรวม (ห้ามลบประวัติโดยไม่มีการอนุมัติ)

---

## 08 Test matrix (mock only — ไม่ส่งข้อความจริง)

| # | กรณี | ต้องได้ | รันได้วันนี้ |
|---|---|---|---|
| L1 | ส่งไม่สำเร็จ (mock 503) | ไม่มี DISPATCHED, request ยัง requested, มี failure_class | 🟡 ต้องมีโค้ดใหม่ |
| L2 | ส่งสำเร็จ | DISPATCHED + `outbound_messages` 1 แถว | 🔴 ยังไม่มีตาราง |
| L3 | webhook ซ้ำ (message_id เดิม) | no-op | 🔴 ไม่มี unique |
| L4 | ผู้ขายตอบตัวเลข | seller_response kind=price, ยังไม่ accepted | 🔴 |
| L5 | ผู้ขายตอบ "ไม่ขาย" | decline, ไม่มีราคา | 🔴 |
| L6 | คำตอบมาหลัง expire | ไม่เขียนราคา/throwing | 🔴 |
| L7 | ไม่มี LINE link | `SELLER_LINE_NOT_LINKED` | 🟡 ตรวจได้ด้วย identity layer |
| L8 | ชื่อตรงแต่ไม่มี link | ถูกปฏิเสธ (negative control K3) | 🟡 |
| L9 | ส่งซ้ำผู้ใช้กดอีกครั้ง | 409 หรือ idempotent no-op | 🟡 (`outbound-drafts` มี 409 แล้ว) |
| L10 | ส่งสำเร็จแต่ไม่ตอบ | ยังไม่ accepted, มี deadline | 🔴 |

---

## 09 สิ่งที่ต้องตัดสินใจ

1. ใช้ OA เดียวหรือหลาย OA (และจะพิสูจน์ "ถึงผู้ขายคนนี้" ได้อย่างไรเมื่อ LINE ไม่คืน messageId ให้ push)
2. ต้องมี "ยืนยันการขาย" เป็นข้อความรูปแบบใด (ข้อความอิสระ / ปุ่ม / ลิงก์ยืนยัน)
3. SLA ของการรอคำตอบ (นาที/ชั่วโมง) และใครแจ้งเตือนเมื่อเกิน
4. อนุญาตให้ระบบส่งอัตโนมัติหลังข้อมูลครบ หรือต้องมีคนกดทุกครั้ง (ปัจจุบัน: ต้องมีคนกด)
5. จะเก็บ consent ของผู้ขายสำหรับการรับข้อความเชิงพาณิชย์อย่างไร
