# CONNECT CHANNEL BOUNDARY AUDIT
**วันที่:** 2026-10-25 · **HEAD:** `d7fbb05b` · **โหมด:** read-only audit + offline test · ไม่มีการแก้ source/DB/UI/ข้อความจริง

> 🟢 PROVEN (โค้ด/ไฟล์จริงรอบนี้) · 🟡 โค้ดจริงแต่ยังไม่รันกับผู้ใช้จริง · 🔴 FAIL/MISSING

---

## 01 OBJECTIVE

พิสูจน์หลักการ: **ทุกช่องทางเป็น Transport Adapter เท่านั้น** — ไม่มีอำนาจประมวลผลธุรกิจ บันทึกการเงิน คำนวณราคา หรือออกเอกสาร

**เกณฑ์ตรวจ**
1. ทุกช่องทางวิ่งเข้าเส้นกลางเดียวกัน (Connect Transport → Business Intent กลาง)
2. ข้อมูลขนส่งครบ: Provider, Account, Sender Identity, Message ID, Timestamp, Raw Evidence Ref, Trace/Event ID, ช่องทางตอบกลับ
3. Identity ≠ สิทธิ์ (ห้ามแปลง provider identity เป็นเจ้าของทรัพยากร/อำนาจอัตโนมัติ)
4. Adapter ไม่เขียนธุรกิจ
5. ผลลัพธ์ของ adapter เป็นสัญญากลางแบบเดียวกันทุก provider

**ผลรวม: 🔴 FAIL (2/5 เกณฑ์)** — โครง transport ใหม่สะอาดและมีสัญญากลางจริง แต่ยังมี **dual path** (LINE ถูกประมวลผลสองครั้ง) และ LINE adapter **ทิ้ง sender identity**

---

## 02 SOURCE EVIDENCE — ช่องทางที่มีจริง

| ช่องทาง | Ingress | Adapter/Normalizer | ปลายทาง | สถานะ |
|---|---|---|---|---|
| **LINE OA (legacy, ใช้งานจริง)** | `supabase/functions/line-webhook-v2/index.ts:132` (signature ✓) | ไม่ใช้ adapter — handler เฉพาะ LINE 9 ตัว | ① forward ไป `app/api/gateway/observe/line` (adapter + bus) **และ** ② ประมวลผลธุรกิจในฟังก์ชันเอง | 🔴 dual path |
| **LINE (ingress ใหม่)** | `app/api/gateway/observe/line/route.ts` (x-line-signature, per-account secret) | `engines/integration-gateway/adapters/line.ts:80` | `publish` → `integration_gateway_events` | 🟢 transport-only |
| **Facebook Messenger** | `app/api/gateway/observe/meta/route.ts` (X-Hub-Signature-256) | `engines/integration-gateway/adapters/meta.ts:118` | bus → `integration_gateway_events` | 🟢 transport-only |
| **Instagram Messaging** | เดียวกัน (`object=instagram`) | เดียวกัน | เดียวกัน | 🟢 |
| **เว็บไซต์ / แชตบนเว็บ** | — | — | — | 🔴 ไม่มีช่องทางแชต (มีแค่ public catalog API) |
| **GitHub / Vercel / Railway / Supabase** | `app/api/gateway/observe/{github,vercel,railway}` | adapter ของแต่ละตัว | bus | 🟢 (ไม่ใช่ messaging) |
| **ขาออก (ผู้ให้บริการ → ผู้ใช้)** | `ResponseGateway` (edge, `engines/response.ts`) · `sendLineMessage` (Next, `registry/communication.ts:37`) · `notifications/send` · `outbound-drafts/[id]/send` | — | LINE push/reply + audit | 🟡 มี 2 ตัวส่ง (edge/Next) แต่ใช้ token path เดียวกันผ่าน connector Run gate |

### 2.1 หลักฐาน dual path (สำคัญที่สุด)
`supabase/functions/line-webhook-v2/index.ts`
- L90–113: `processEvent()` → `handleText/handleLocation/handleImage/handleFile/handleAudio/handlePostback` (ประมวลผลธุรกิจเต็มรูปแบบ)
- L132: `const forward = forwardLineInbound(rawBody, signature)`
- L137–144: `EdgeRuntime.waitUntil(processAll)` **และ** `EdgeRuntime.waitUntil(forward)`

`supabase/functions/_shared/connect-forward.ts:6–14` ระบุเองว่าเป็น "additive step … old path retired only after zero-caller proof" → **วันนี้ยังไม่ retire**

**ผล:** ข้อความ LINE หนึ่งข้อความถูกตีความสองครั้ง (obus event + legacy business pipeline) และมีโอกาสเกิดความจริงสองชุดที่แยกกัน

### 2.2 ช่องว่างข้อมูลขนส่ง (STEP 01 required fields)

| ฟิลด์ | LINE | Meta | หลักฐาน |
|---|---|---|---|
| Provider | ✅ `"line"` | ✅ `facebook`/`instagram` | adapter |
| Account | ✅ `channel_destination` (destination) | ✅ `entry_id` / `recipient_id` | evidence keys |
| **Sender Identity** | 🔴 **ไม่มี** (`source.userId` ถูกทิ้ง) | ✅ `sender_id` | test C: `evidence keys = webhook_event_id,event_type,source_type,message_type,has_media,is_redelivery,channel_destination,provider_timestamp` |
| Message ID | ✅ `webhook_event_id` | ✅ `webhook_event_id` (=mid) | |
| Timestamp | ✅ `provider_timestamp` | ✅ `provider_timestamp` | |
| Raw Evidence Ref | 🟡 ไม่มี raw body ใน event (ตั้งใจ) — มี `line_events.raw_json` แยก | 🟡 เช่นเดียวกัน | `line_events` schema |
| Trace / Event ID | ✅ `EVT-line-<webhookEventId>` (deterministic) | ✅ `EVT-<provider>-<mid>` | test C: deterministic, ไม่ชนข้าม provider |
| ช่องทางตอบกลับ | 🟡 `channel_destination` (LINE) / `recipient_id` (Meta) — ไม่มี reply-token/account routing field | 🟡 | adapter |

**สรุปฟิลด์:** Meta ครบ · LINE ขาด sender identity (ทำให้ตรวจย้อนว่า "ใครส่ง" ไม่ได้จาก event กลาง)

### 2.3 กฎ "Identity ≠ สิทธิ์" — จุดที่ยังฝ่าฝืน

| จุด | พฤติกรรมจริง | หลักฐาน |
|---|---|---|
| `authorization-check.ts:37–44` | เลือก "ผู้รับผิดชอบ" = LINE link ที่เก่าที่สุดของบริษัท (`order created_at asc limit 1`) แล้วให้เขากดอนุมัติ | 🔴 ตั้งผู้มีอำนาจจากลำดับการเชื่อม ไม่ใช่การมอบหมาย |
| `authorization-check.ts:60` | สร้าง `pending_authorizations` จากข้อความ LINE | 🔴 provider tier เขียนตารางอำนาจ |
| `handlers/postback.ts:100` | postback `AUTH_APPROVE/AUTH_DENY` เปลี่ยนสถานะอำนาจ | 🔴 การอนุมัติเกิดใน transport tier |
| `supplier-quote-reply.ts:20–27` | จับคู่ผู้ขายด้วย `pit_profiles.line_user_id` → แล้วเขียนราคา | 🔴 identity ผู้ขาย = สิทธิ์แก้ราคา (อัตโนมัติ) |
| `build-event-from-extraction.ts:35` | ใช้ `company_line_links` เป็น `partner_id` ของธุรกิจ | 🟡 ยอมรับได้ถ้า link ผ่านการยืนยันแล้ว แต่ไม่มีการแยก "verified" ในเส้นนี้ |
| `connect_external_identities` (Next) | มี `trust_level=verified` + `revoked_at` (แบบจำลองที่ถูก) | 🟢 แต่ edge tier ยังไม่ใช้เป็นด่าน |

---

## 03 RESULT

| # | เกณฑ์ | ผล | หลักฐาน |
|---|---|---|---|
| 1 | ทุกช่องทางเข้าเส้นกลางเดียว | 🔴 FAIL | LINE มี dual path (index.ts L132 + processAll) |
| 2 | ข้อมูลขนส่งครบ | 🔴 FAIL | LINE ไม่มี sender identity (test C) |
| 3 | Identity ≠ สิทธิ์ | 🔴 FAIL | `pending_authorizations` + first-link responsibility + pit price authority |
| 4 | Adapter ไม่เขียนธุรกิจ | 🟢 PASS (adapters) / 🔴 FAIL (legacy handler tier) | test A: 0 business writes ใน `adapters/*` + `observe/*` · test B: 14 จุดใน legacy tier |
| 5 | สัญญากลางเดียวกันทุก provider | 🟢 PASS | test C: capability `message.received`, `channel=observe`, `GatewayEvent` ผ่าน `isGatewayEvent` ทั้งสอง provider |

### 3.1 ช่องทางที่ยังไม่มี (รายงานตรง ไม่สร้าง)
- **เว็บแชต**: ไม่มี endpoint รับข้อความจากเว็บ (มีเฉพาะ `app/api/public/products*`)
- **TikTok / WhatsApp / Telegram**: ไม่มี adapter (ไม่กล่าวอ้าง)

### 3.2 สิ่งที่ต้องตัดสินใจก่อนแก้
1. จะ retire legacy LINE pipeline เมื่อใด (ต้องมี zero-caller proof + parity test ของทุก intent)
2. `source.userId` จะถูกเพิ่มใน LINE evidence หรือจะอ้าง `line_events.id` เป็นตัวชี้ sender (เลือกทางเดียว)
3. "ผู้รับผิดชอบของบริษัท" จะมาจาก `authority_grant` (TAX G2) แทน first-link หรือไม่
4. ช่องทางตอบกลับจะเก็บเป็น field กลาง (`reply_channel`) หรืออ้าง account id ที่ resolve ได้

> ยังไม่มีการแก้โค้ดธุรกิจในรอบนี้ — รายการย้าย authority อยู่ใน `CANONICAL_WRITER_ENFORCEMENT_PLAN.md`
