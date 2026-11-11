# DNA OS — System & Integration Manual

เอกสารนี้สรุป “ไอคอนกล่องข้อความ” ทั้งหมด, วิธีทำงานข้ามระบบ, API, จุดเชื่อมต่อ, และจุดที่ AI เข้ามาเกี่ยวข้อง พร้อมตำแหน่งโค้ดจริงใน repository

---

## 1. ภาพรวมระบบข้อความ

DNA OS มี “สองชั้น” ของข้อความ:

1. **Workspace Chat / Command Surface**  
   ใช้สำหรับผู้ใช้พิมพ์คำสั่งกับ DNA OS ในหน้า workspace (`app/workspace/WorkspaceFrame.tsx`)  
   เรียก `POST /api/chat` → `runCognitivePipeline` → canonical readers/capabilities → บางกรณี fallback ไป owner runtime

2. **External Messaging / LINE Inbound & Reply**  
   ใช้สำหรับลูกค้าส่งข้อความเข้ามาผ่าน LINE และ admin ตอบกลับ  
   ข้อมูลถูก mirror เข้า central conversation model (`conversations`, `messages`, ฯลฯ) เพื่อให้ Floating Messenger อ่านจาก Single Source of Truth

หลักการปัจจุบัน:
- `line_events` ยังเป็น ingest path เดิม
- central conversation model เป็น additive SSOT สำหรับ UI ใหม่
- Floating Messenger อ่าน/ตอบผ่าน central APIs
- business identity/context resolve แบบ background ไม่บล็อก chat

---

## 2. ไอคอนกล่องข้อความทั้งหมดและหน้าที่

### 2.1 ไอคอนหลักใน WorkspaceFrame

ไฟล์: `app/workspace/WorkspaceFrame.tsx`

| ไอคอน | ความหมาย | การทำงาน |
|---|---|---|
| `MessageSquare` (มุมขวาบน) | เปิดประวัติการสื่อสาร / Floating Messenger | dispatch `window.dispatchEvent(new CustomEvent("dna:open-messenger"))` |
| `MessageCircle` (ใน drawer APPS) | LINE | เปิด route `/admin/line-customers` |
| `MessageSquare` (ใน drawer APPS) | ความสัมพันธ์ | เปิด route `/admin/relationships` |

หมายเหตุ:
- ปุ่มมุมขวาบนเคย toggle `messagePanel` เดิม แต่ปัจจุบันเปิด Floating Messenger แทน
- `messagePanel` prop ยังมีอยู่เพื่อ backward compatibility แต่ไม่ใช้เป็นทางหลักแล้ว

### 2.2 FloatingHomeButton (เมนูลอยทั้งระบบ)

ไฟล์: `presentation/ui/FloatingHomeButton.tsx`

เมนูมี entry เดียวกับ WorkspaceFrame:
- `MessageCircle` → `/admin/line-customers` (LINE)
- `MessageSquare` → `/admin/relationships` (ความสัมพันธ์)

### 2.3 Floating Messenger Widget

ไฟล์: `presentation/ui/FloatingMessenger.tsx`

ไอคอนที่ใช้:
- `MessageSquare` = header ของ widget
- `ArrowLeft` = กลับจาก thread ไปรายการ
- `Send` = ส่ง reply
- `X` = ปิด widget

การทำงาน:
1. ฟัง event `dna:open-messenger`
2. โหลดรายการ conversation จาก `GET /api/admin/conversations`
3. เลือก conversation แล้วโหลด detail จาก `GET /api/admin/conversations/[conversationId]`
4. subscribe realtime บน `conversations` และ `messages`
5. ส่งข้อความผ่าน `POST /api/admin/conversations/[conversationId]/reply`
6. ถ้ายังไม่มี business context จะ polling detail ทุก 3 วินาที (สูงสุด ~30 วินาที) เพื่อ auto-resolve

### 2.4 หน้า LINE Customers

ไฟล์: `app/admin/line-customers/page.tsx`

ใช้สำหรับ:
- ดู contacts จาก `GET /api/admin/line-customers`
- ดู detail จาก `GET /api/admin/line-customers/[lineUserId]`
- สลับ thread source ระหว่าง `LINE` และ `Central`
- reply ผ่าน central endpoint เมื่ออยู่ใน Central view
- แสดง partner binding status (ไม่บล็อกการแชท)
- แสดง central mirror count และ conversation id

ข้อความ UI ปัจจุบัน:
- ไม่พบบริษัท → “กำลังตรวจสอบ context...”
- ไม่มี binding → “กำลังตรวจสอบ context...”
- manual binding heading → “จับคู่บริษัท (ไม่บล็อกการแชท)”

### 2.5 Relationships

ไฟล์: `app/admin/relationships/workspace.tsx`

- `MessageCircle` ใช้ใน icon registry/UI gallery context
- `messagePanel = ListColumn` ของ relationships ถูกส่งไป WorkspaceFrame เพื่อแสดงใน panel เดิม
- ตอนนี้ top-right icon เปิด Floating Messenger แทน panel เดิม

### 2.6 Event Inbox

ไฟล์: `app/admin/event-inbox/page.tsx`

- เป็น “ประวัติ / หลักฐาน” ของ event ไม่ใช่ messenger หลัก
- เข้าได้จาก drawer action “ประวัติ / หลักฐาน” หรือ URL โดยตรง
- ใช้ดู live data / evidence ที่เกี่ยวกับข้อความและ action

### 2.7 User-facing Messaging

ไฟล์: `app/user/page.tsx`

- `MessageSquare` ถูก map เป็น capability `messaging`
- เป็น entry point ฝั่ง user-facing ไม่ใช่ admin LINE inbox

### 2.8 Empty State

ไฟล์: `presentation/feedback/EmptyState.tsx`

- ใช้ icon `Inbox` เป็น default icon เมื่อไม่มีข้อมูล
- ไม่ใช่ระบบข้อความจริง

---

## 3. Cross-System Data Flow

### 3.0 Inbound Facebook Messenger Message

เส้นทางโดยสรุป:

1. ผู้ใช้ส่งข้อความใน Facebook Messenger
2. Facebook ยิง webhook เข้า `POST /api/connectors/webhook/facebook`
   - GET ใช้สำหรับ Meta subscription verification (hub.challenge)
   - POST ตรวจสอบ `X-Hub-Signature-256` (HMAC-SHA256 ด้วย App Secret)
3. payload ถูก parse และบันทึกเป็น `facebook_events` (raw audit)
4. DB trigger `facebook_events_mirror_central` + function `mirror_facebook_event_to_conversation(uuid)` mirror ไป central tables:
   - `conversations` (channel_type = 'FACEBOOK')
   - `conversation_participants`
   - `messages`
   - `conversation_delivery_routes` (provider = 'facebook')
   - `conversation_business_links` (จาก `company_facebook_links` เท่านั้น)
5. usage metering บันทึกเข้า `connector_usage_events` (connector_type = 'facebook_messenger')

หลักการ:
- ถ้า mirror fail ไม่ทำให้ ingest fail
- business identity ไม่ guess by display name
- ใช้ explicit `company_facebook_links` เท่านั้น
- echo (is_echo) ถูก skip (inbound only)

### 3.1 Inbound LINE Message

เส้นทางโดยสรุป:

1. ผู้ใช้ส่งข้อความใน LINE
2. LINE ยิง webhook เข้า Supabase Edge Function `supabase/functions/line-webhook-v2/index.ts` (primary path)
   - verify `X-Line-Signature`
   - dispatch ต่อ event type → handlers/*
   - `saveEvent` → insert `line_events` (ingest path เดิม)
3. DB trigger `line_events_mirror_central` + function `mirror_line_event_to_conversation(uuid)` mirror ไป central tables:
   - `conversations`
   - `conversation_participants`
   - `messages`
   - `message_attachments`
   - `conversation_business_links` (จาก `company_line_links` เท่านั้น)
   - `conversation_delivery_routes`

หมายเหตุ:
- `app/api/connectors/webhook/[slug]/route.ts` เป็น generic connector audit path (`connector_webhook_events`) ไม่ใช่ primary LINE ingest และไม่ insert `line_events`/mirror ไป central model
- ถ้า mirror fail ไม่ทำให้ ingest fail
- business identity ไม่ guess by LINE display name
- ใช้ explicit `company_line_links` เท่านั้น

### 3.2 Central Read Path

Floating Messenger และ provider-neutral API อ่านจาก central model:

- `GET /api/admin/conversations`
  - ไฟล์: `app/api/admin/conversations/route.ts`
  - list conversations + participants + latest business link + last message + delivery routes

- `GET /api/admin/conversations/[conversationId]`
  - ไฟล์: `app/api/admin/conversations/[conversationId]/route.ts`
  - detail messages, participants, businessLinks, deliveryRoutes
  - auto-resolve business context ถ้าไม่มี link

- `GET /api/admin/line-customers/[lineUserId]`
  - ไฟล์: `app/api/admin/line-customers/[lineUserId]/route.ts`
  - ยังคง LINE path เดิม + เพิ่ม `central` field
  - signed URL สำหรับ attachments

### 3.3 Reply Path

- `POST /api/admin/conversations/[conversationId]/reply`
  - ไฟล์: `app/api/admin/conversations/[conversationId]/reply/route.ts`
  - reply ผ่าน delivery route
  - provider=facebook จะส่งผ่าน Facebook Send API (`graph.facebook.com`) ด้วย `FACEBOOK_PAGE_ACCESS_TOKEN`
  - provider=line จะส่งผ่าน `sendLineMessage` (LINE Messaging API)
  - conversation model ไม่ provider-specific แต่ delivery provider ยังเป็น LINE/Facebook ได้

- LINE customers page:
  - ถ้าอยู่ใน Central view → reply ผ่าน central reply endpoint
  - ถ้าอยู่ใน LINE view → ใช้ path เดิม

### 3.4 Auto-Context Resolution

เมื่อ thread ยังไม่ผูกบริษัท:
1. GET conversation detail
2. ถ้า `businessLinks` ว่าง:
   - หา recipient จาก `conversation_delivery_routes.recipient_external_id`
   - หรือ participant `external_subject_id`
3. query `company_line_links` ด้วย LINE user id
4. ถ้าพบ → insert `conversation_business_links`
   - `source = "AUTO"`
   - `resolved_by = "auto-context"`
5. refresh businessLinks
6. UI แสดง “กำลังตรวจสอบ context...” จนกว่าจะ resolve

หลักการสำคัญ:
- ไม่บล็อกการอ่านข้อความ
- ไม่บล็อกการตอบ
- context เป็นข้อมูลเสริมที่ resolve ภายหลัง

---

### 3.5 Authority Boundary (Provider Tier)

- Provider tier (`supabase/functions/line-webhook-v2`) ห้ามเขียน business tables ตรง
- การเขียน business state ต้องผ่าน canonical writers ผ่าน Connect internal routes (`/api/internal/connect/*`)
- ตัวอย่าง bridge: `connect-customer-site`, `connect-pending-authorization`, `connect-print-job`, `connect-billing-event`
- Facebook outbound ใช้ `FACEBOOK_PAGE_ACCESS_TOKEN` (env) และ endpoint `graph.facebook.com`

## 4. ระบบ AI เกี่ยวข้องกับข้อความอย่างไร

### 4.1 Workspace Chat / Command (ไม่ใช่ LINE Messenger โดยตรง)

ไฟล์หลัก:
- `app/api/chat/route.ts`
- `cognitive/pipeline.ts`
- `app/api/chat/_lib/localAiBridge.ts`
- `core/owner-runtime/client.ts`

ลำดับการทำงาน:
1. ผู้ใช้พิมพ์ใน WorkspaceFrame chat input
2. `POST /api/chat`
3. `runCognitivePipeline(rawMessage, ...)`
4. deterministic command/intent/reader/capability ก่อน
5. ถ้า eligible → `translateLocalAiCommand` (local AI bridge)
6. ถ้าผลยังเป็น text → fallback ไป `askOwnerRuntime` (owner runtime ที่ `127.0.0.1:8791`)
7. ผลถูก map เป็น `ChatResult` (text / sections / fields / table / document / timeline / error)
8. UI render ผ่าน `BusinessDisplayRenderer` และ `RichText`

AI ที่เกี่ยวข้อง:
- Local AI bridge (`translateLocalAiCommand`)
- Owner runtime fallback (`askOwnerRuntime`)
- Cognitive pipeline ที่รวม deterministic checks ก่อน AI

หลักการที่เอกสารระบุ:
- “ก่อนให้ AI คิด ต้องผ่านหลายชั้นก่อน”
- deterministic checks มาก่อน AI
- AI ไม่ได้เป็นชั้นแรกของระบบ

### 4.2 AI ที่ไม่ได้เข้าไปใน Floating Messenger Reply

Floating Messenger reply ปัจจุบัน:
- ส่งข้อความตรงไป provider (LINE) ผ่าน delivery route
- ไม่เรียก cognitive pipeline
- ไม่เรียก local AI bridge หรือ owner runtime
- ไม่สร้าง AI reply อัตโนมัติ

ดังนั้น:
- AI อยู่ใน “Workspace Command Chat”
- Floating Messenger อยู่ใน “External Messaging Reply”
- สองระบบแยกกัน แต่ใช้ UI shell เดียวกัน

### 4.3 AI / Scan ที่เกี่ยวข้องทางอ้อม

ไฟล์/route ที่เกี่ยวข้อง:
- `/admin/receipts` (Scan / AI entry in FloatingHomeButton/WorkspaceFrame)
- `presentation/ai/RichText.tsx` (render ผลลัพธ์)
- `app/admin/ui-gallery` (visual review, ไม่ใช่ production path)

---

## 5. โค้ดและตำแหน่งสำคัญ

### 5.1 UI

| ไฟล์ | หน้าที่ |
|---|---|
| `app/workspace/WorkspaceFrame.tsx` | shell หลัก, top-right MessageSquare, drawer LINE/Relationships |
| `presentation/ui/FloatingHomeButton.tsx` | เมนูลอยทั้งระบบ, entry LINE/Relationships |
| `presentation/ui/FloatingMessenger.tsx` | Floating Messenger Widget |
| `app/admin/line-customers/page.tsx` | LINE customers UI, central toggle, partner binding UI |
| `app/admin/relationships/workspace.tsx` | relationships message panel |
| `app/admin/event-inbox/page.tsx` | event history/evidence |
| `app/user/page.tsx` | user-facing messaging capability |
| `presentation/feedback/EmptyState.tsx` | default Inbox icon |

### 5.2 API

| Route | ไฟล์ | หน้าที่ |
|---|---|---|
| `GET /api/admin/conversations` | `app/api/admin/conversations/route.ts` | list central conversations |
| `GET /api/admin/conversations/[conversationId]` | `app/api/admin/conversations/[conversationId]/route.ts` | read central detail + auto-context |
| `POST /api/admin/conversations/[conversationId]/reply` | `app/api/admin/conversations/[conversationId]/reply/route.ts` | reply via delivery route |
| `GET /api/admin/line-customers` | `app/api/admin/line-customers/route.ts` | list LINE contacts |
| `GET /api/admin/line-customers/[lineUserId]` | `app/api/admin/line-customers/[lineUserId]/route.ts` | LINE detail + central mirror |
| `POST /api/admin/line-customers/[lineUserId]/bind-partner` | `app/api/admin/line-customers/[lineUserId]/bind-partner/route.ts` | manual partner binding |
| `POST /api/chat` | `app/api/chat/route.ts` | workspace command chat |
| `POST /api/chat/confirm` | `app/api/chat/confirm/route.ts` | Rule-72 confirm + LINE send |
| `POST /api/connectors/webhook/[slug]` | `app/api/connectors/webhook/[slug]/route.ts` | inbound webhook |
| `GET/POST /api/connectors/webhook/facebook` | `app/api/connectors/webhook/facebook/route.ts` | Facebook Messenger ingest → central |
| `GET /api/admin/finance/summary` | `app/api/admin/finance/summary/route.ts` | Monetized: revenue/expense/tax summary + usage metering |

### 5.3 Database / Central Model

Migration:
- `supabase/migrations/20261111120000_central_conversation_model.sql`

Tables:
- `conversations`
- `conversation_participants`
- `messages`
- `message_attachments`
- `conversation_business_links`
- `conversation_delivery_routes`
- `company_line_links`

Trigger:
- `line_events_mirror_central`
- function `mirror_line_event_to_conversation(uuid)`

### 5.4 Registry / Outbound

- `registry/communication.ts` = single outbound LINE gateway via `sendLineMessage`
- outbound drafts / Rule 72 อยู่ใน `line_outbound_drafts`

---

## 6. วิธีทดสอบที่แนะนำ

1. เปิดหน้าที่ใช้ WorkspaceFrame
2. กดไอคอน `MessageSquare` มุมขวาบน
3. ตรวจสอบว่า Floating Messenger เปิด
4. ตรวจสอบรายการ conversation โหลดจาก `/api/admin/conversations`
5. เลือก conversation
6. ตรวจสอบข้อความโหลดจาก central detail
7. พิมพ์ reply และกด Send
8. ตรวจสอบว่าข้อความใหม่ปรากฏ (realtime/refetch)
9. ตรวจสอบ context status:
   - resolved → แสดงบริษัท
   - unresolved → “กำลังตรวจสอบ context...”
10. ถ้า unresolved ให้รอ auto-resolve จาก `company_line_links`

---

## 7. ข้อควรระวัง

- ห้ามลบ handler เดิมของ action bar / overflow / business / communication actions
- ห้ามแตะ forbidden paths ที่ระบุใน task
- `npm run build` อาจถูก deploy gate บล็อกจาก pre-existing architecture drift ที่ไม่เกี่ยวกับงานนี้
- `.tmp-qa` ต้องคงอยู่
- ห้ามพิมพ์ secret
- Plus dropdown ต้องคง 10 รายการ
- manual partner binding handler ยังคงอยู่ (ไม่ลบ) แต่ไม่บล็อกการแชท

---

## 8. จุดยืนการเชื่อมต่อแพลตฟอร์ม & ข้อกำหนด (Platform Integration Stance & Requirements)

### 8.1 ประกาศจุดยืนการเป็นอิสระ (Non-Partnership Disclaimer)

DNA OS เป็น **Independent Architecture & Aggregator** อย่างชัดเจน:

- **ไม่มีส่วนเกี่ยวข้อง** และ **ไม่เป็นพาร์ทเนอร์ทางการค้าอย่างเป็นทางการ** กับ LINE Corporation หรือ Meta (Facebook) หรือผู้ให้บริการแพลตฟอร์มใด ๆ ที่เชื่อมต่อ
- การเชื่อมต่อทำผ่าน **ช่องทางที่เปิดให้บริการสาธารณะ (Official APIs / Webhooks)** ของแต่ละแพลตฟอร์มเท่านั้น เช่น LINE Messaging API, Meta Messenger Platform API
- ไม่ใช้ unofficial client, ไม่ scrape, ไม่ reverse-engineer, และไม่เรียกใช้ API ที่ไม่ได้รับอนุญาต
- ชื่อ/โลโก้/เครื่องหมายการค้าของแต่ละแพลตฟอร์มเป็นทรัพย์สินของเจ้าของนั้น ๆ; การอ้างอิงในเอกสารนี้เพื่อระบุจุดเชื่อมต่อทางเทคนิคเท่านั้น
- DNA OS ไม่รับประกัน uptime/SLA ของแพลตฟอร์มต้นทาง; หากแพลตฟอร์มเปลี่ยน API/นโยบาย ระบบอาจต้องปรับตาม

### 8.2 ประเภทบัญชีที่รองรับการเชื่อมต่อ (Supported Account Types)

บัญชีที่จะดึงเข้ามาต่อพ่วงกับท่อกลาง (central conversation model) ต้องเป็น **บัญชีธุรกิจ/ช่องทางอย่างเป็นทางการ** เท่านั้น ไม่รองรับบัญชีส่วนตัว:

- **LINE**
  - `LINE Official Account (OA)` ที่เปิดใช้งาน `Messaging API Channel` (Verified หรือ Unverified ตามสิทธิ์ที่ LINE อนุญาต)
  - ต้องเป็นบัญชีที่มี Channel ID / Channel Secret / Channel Access Token ที่ออกโดย LINE Developers Console
  - **ไม่รองรับ** LINE บัญชีส่วนตัว (LINE personal account) หรือการเชื่อมผ่าน unofficial client
- **Meta (Facebook)**
  - `Facebook Page` ที่เปิดใช้งาน `Messenger Platform` (Page Access Token ที่ได้จาก App Review/Permissions ที่จำเป็น)
  - ต้องเป็น Page ที่ผู้ใช้มีสิทธิ์ admin/manage
  - **ไม่รองรับ** Facebook โปรไฟล์ส่วนตัว (personal profile) หรือ Group chat ที่ไม่ได้เปิด Messenger API
- **ข้อจำกัดทั่วไป**
  - บัญชีต้องผ่านการยืนยันตัวตน/สิทธิ์ของแพลตฟอร์มต้นทางก่อนเชื่อม
  - 1 บัญชีธุรกิจ (company) อาจมีหลาย channel link ผ่าน `company_line_links` (explicit link เท่านั้น ไม่ guess by display name)

### 8.3 ข้อกำหนดและวิธีการเชื่อมต่อ (Integration Requirements & Protocols)

#### 8.3.1 LINE Messaging API

1. สร้าง/เลือก Provider และ Channel ประเภท **Messaging API** ใน LINE Developers Console
2. ขอ **Channel Access Token** (long-lived) และเก็บเป็น secret (ห้ามพิมพ์/commit)
3. จด **Channel Secret** สำหรับ signature validation
4. ลงทะเบียน **Webhook URL** ให้ชี้มายัง endpoint ของ DNA OS:
   - `POST /api/connectors/webhook/[slug]` (ผ่าน connector gate)
   - gate อยู่ใน `app/api/connectors/webhook/[slug]/_lib/webhookGate.ts`
5. เปิด **Use webhook** และปิด **Auto-reply messages** ของ LINE (ถ้าต้องการให้ DNA OS ตอบเอง)
6. Signature validation: ใช้ `X-Line-Signature` (HMAC-SHA256 ด้วย Channel Secret) ต้องผ่านก่อน ingest
7. Rate limit: เคารพ quota ของ LINE; หลีกเลี่ยงการส่งซ้ำ/สแปม; outbound ผ่าน `registry/communication.ts` (`sendLineMessage`) ช่องทางเดียว

#### 8.3.2 Meta Messenger Platform (Facebook Page)

1. สร้าง Meta App และขอ permissions ที่จำเป็น (เช่น `pages_messaging`, `pages_manage_metadata`)
2. รับ **Page Access Token** ผ่าน OAuth / Page token flow
3. ลงทะเบียน **Webhook** ไปยัง endpoint ของ DNA OS พร้อม verify token
4. Signature validation: ใช้ `X-Hub-Signature-256` (HMAC-SHA256 ด้วย App Secret)
5. เคารพ rate limit และ policies ของ Meta; ไม่ส่งข้อความที่ผิดนโยบาย (spam, promotional without opt-in)

#### 8.3.3 ขั้นตอนทั่วไป (connector/provider)

- connector ต้องอยู่ในสถานะ connected/enabled ก่อนรับ webhook (gate)
- event ถูกบันทึกผ่าน `recordWebhookEvent(...)`
- ingest path เดิม (`line_events`) ยังคงอยู่; central model เป็น additive SSOT
- ทุกการเชื่อมต้องผ่าน approval/consent ของผู้ใช้ (owner of the account)

### 8.4 การบริหารความเสี่ยงจากแพลตฟอร์มใหญ่ (Platform Risk Mitigation)

แนวทางปฏิบัติเพื่อความโปร่งใสและลดความเสี่ยงถูกแบน/ถูกปิดกั้น:

1. **Official APIs only** — ใช้เฉพาะ API ที่แพลตฟอร์มเปิดอย่างเป็นทางการ; ไม่ใช้ unofficial/scraping
2. **ToS compliance** — ปฏิบัติตาม Terms of Service และ Developer Policies ของแต่ละแพลตฟอร์ม (LINE Developers Agreement, Meta Platform Terms)
3. **Signature validation ทุก inbound** — ปฏิเสธ request ที่ signature ไม่ถูกต้อง; ป้องกัน spoofing
4. **Audit trail** — เก็บ event ผ่าน `recordWebhookEvent` และ `line_events` เพื่อตรวจสอบย้อนหลัง
5. **Least privilege** — ขอเฉพาะ permissions ที่จำเป็น; ไม่ขอ scope เกินความจำเป็น
6. **Secret hygiene** — ห้ามพิมพ์/commit secret; เก็บใน env/secret store; หมุน token เมื่อสงสัย breach
7. **Rate limit awareness** — หลีกเลี่ยง burst; ใช้ queue/backoff เมื่อจำเป็น; ไม่เรียก API ซ้ำโดยไม่จำเป็น
8. **Data handling** — เก็บเฉพาะข้อมูลที่จำเป็น; ไม่ใช้ข้อมูลลูกค้าเกินวัตถุประสงค์; เคารพ privacy policy
9. **Graceful degradation** — ถ้าแพลตฟอร์มเปลี่ยน API หรือปิดกั้น ระบบต้องยังทำงานได้บางส่วน (เช่น central model ยังอ่านได้) และแจ้ง admin
10. **No impersonation / no spam** — ไม่ส่งข้อความแทนบัญชีที่ไม่ได้รับอนุญาต; ไม่ส่งข้อความเชิงพาณิชย์โดยไม่ได้รับ consent
11. **Transparency** — ระบุในเอกสาร/UI ว่าเป็น independent aggregator (ดู 8.1) เพื่อไม่ให้ผู้ใช้เข้าใจผิดว่าเป็น official integration
12. **Incident response** — หากถูก rate-limit หรือแบน ให้หยุดเรียก API ทันที บันทึก log และแจ้ง owner เพื่อทบทวน

---

### 8.5 Monetized Core Capabilities (Usage Metering)

DNA OS ให้บริการ “Core Capabilities” ที่สามารถคิดเงินได้ (Monetized) โดยทุกครั้งที่มีการเรียกใช้จะบันทึก `unit_consumed` เข้า `connector_usage_events`:

- `GET /api/admin/finance/summary` — สรุปยอดรายรับ (invoices) / รายจ่าย (company_expenses) / ภาษี (VAT) / กำไรสุทธิ สำหรับช่วงเวลาที่ระบุ; meter 1 unit ต่อการเรียก
- โครงสร้าง metering JSON:
  ```json
  { "connector_type": "...", "event_type": "...", "unit_consumed": 1, "status": "success", "timestamp": "..." }
  ```
- รายรับ/รายจ่าย/ภาษี คำนวณจากตาราง `invoices` (total_amount, vat_amount, subtotal, paid_amount) และ `company_expenses` (amount, expense_date)
- รองรับ filter ตาม `company_id` และช่วงวันที่ `from`/`to`

---

## 9. สรุปสั้น

- ไอคอนกล่องข้อความหลัก = `MessageSquare` มุมขวาบนใน WorkspaceFrame
- มันเปิด Floating Messenger ที่อ่านจาก central conversation SSOT
- LINE inbound → webhook → `line_events` → trigger mirror → central tables
- Floating Messenger list/detail/reply ใช้ `/api/admin/conversations*`
- business context auto-resolve จาก `company_line_links`
- AI อยู่ใน `/api/chat` (workspace command), ไม่ได้ตอบ LINE messenger อัตโนมัติ
- code สำคัญอยู่ใน `app/workspace/WorkspaceFrame.tsx`, `presentation/ui/FloatingMessenger.tsx`, `app/api/admin/conversations/*`, `app/api/chat/route.ts`, และ migration central conversation model