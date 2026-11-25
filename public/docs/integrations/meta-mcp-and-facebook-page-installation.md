# คู่มือ Meta MCP และการติดตั้ง Facebook Page ใน DNA OS

**คู่มือสถานะและแผนเชื่อมต่อ — ฉบับ 1.1 — 26 พฤศจิกายน 2026**

เอกสารนี้แยกสองเส้นทางที่ชื่อคล้ายกันแต่ทำหน้าที่คนละอย่าง:

1. **Meta Social Technologies MCP** เป็นเครื่องมือฝั่งผู้ดูแล/นักพัฒนา ใช้จัดการแอป Meta และ Webhook จาก Codex หรือไคลเอ็นต์ที่ Meta รองรับ
2. **การเชื่อม Facebook Page ใน DNA OS** เป็นขั้นตอนสำหรับเจ้าของร้าน/องค์กร ให้ยินยอมเชื่อมเพจของตน แล้วส่งเหตุการณ์ข้อความเข้า DNA OS

ผู้ใช้ร้านค้าไม่ต้องติดตั้งหรือใช้ Meta MCP ส่วน MCP ไม่ใช่ตัวรับข้อความจากเพจ และไม่ใช่ช่องทางล็อกอินของผู้ใช้ทั่วไป

## ภาพรวมเส้นทาง

```text
ผู้ดูแลระบบ DNA OS
  → Codex MCP servers
  → Meta Social Technologies MCP (OAuth: Read หรือ Manage)
  → สร้าง/ตรวจแอป Meta และตั้ง Webhook ระดับแอป

ผู้ดูแลร้าน/องค์กร
  → DNA OS: ช่องเชื่อมต่อ > ช่องทางข้อความ > Facebook Page (หน้าจอเป้าหมาย; ยังไม่อยู่ใน Production)
  → เข้าสู่ระบบ Meta และเลือกเพจที่ตนมีสิทธิ์จัดการ
  → อนุญาตเฉพาะสิทธิ์ที่จำเป็น และผูกเพจกับองค์กรใน DNA OS
  → สมัครเพจให้ส่ง field messages ไปยังแอป Meta ของ DNA OS
  → https://dnaos.dev/api/gateway/observe/meta
  → Cloudflare Worker ตรวจลายเซ็นและแปลงเหตุการณ์
  → Integration Gateway / Observe
  → กล่องเหตุการณ์ขององค์กร (หลังทำ Page-to-organization mapping; ยังไม่เปิด)
```

**ขอบเขตเปิดใช้ระยะแรก:** รับข้อความเข้าและส่งต่อเป็นเหตุการณ์เท่านั้น ไม่มีการตอบลูกค้าอัตโนมัติ ไม่มีการส่งข้อความออก และไม่แก้ไขข้อมูลใน ERP/สต็อกขององค์กร

## A. เชื่อม Meta MCP กับ Codex สำหรับผู้ดูแลระบบ

Meta ปัจจุบันเรียกเครื่องมือนี้ว่า **Meta Social Technologies MCP** (ชื่อเดิม Meta Developer Tools MCP); endpoint และ prefix `devtools_` ยังใช้เดิม ส่วน repository `facebook/agentic-tools` มี skill สำหรับตรวจแอปและตั้ง/ตรวจ Webhook ให้เรียกใช้ขั้นตอนทางการเป็นลำดับได้

### ข้อมูลเซิร์ฟเวอร์

| รายการ | ค่า |
|---|---|
| ชื่อ | Meta Social Technologies |
| URL | `https://mcp.facebook.com/devtools` |
| วิธีเชื่อมต่อ | Streamable HTTP + OAuth |
| ต้องสร้าง Meta App เพื่อเชื่อม MCP หรือไม่ | ไม่ต้อง ใช้การลงทะเบียน OAuth อัตโนมัติ |
| ขอบเขต | เลือกสิทธิ์ตามหน้าขออนุญาต Meta; ใช้อ่านก่อน และอนุญาตการจัดการเมื่อจะเปลี่ยนค่า |

การเชื่อม MCP ใช้ OAuth ของบัญชี Meta ผู้พัฒนา; ไม่ต้องสร้าง Meta App เพื่อเชื่อม MCP. เครื่องมือจริงอาจเปลี่ยนตามรุ่น ให้ตรวจรายการ tool ที่ Codex แสดงหลังเชื่อม แทนการยึดชื่อเครื่องมือในเอกสารเก่า

### ขั้นตอนเพิ่ม MCP ใน Codex

1. เพิ่ม MCP server ชื่อ `devtools` ในการตั้งค่า Codex โดยใช้ URL `https://mcp.facebook.com/devtools` และ transport แบบ HTTP/Streamable HTTP
2. บันทึกค่าและรีสตาร์ต Codex หากระบบร้องขอ
3. เริ่มเรียก server เพื่อเปิด OAuth; เข้าระบบด้วยบัญชี Meta ที่มีบทบาทในแอปที่ต้องการจัดการ
4. ตรวจรายการสิทธิ์ในหน้าของ Meta ก่อนอนุญาต แล้วกลับมาที่ Codex
5. ตรวจว่าเครื่องมือของ `devtools` ปรากฏ จากนั้นเริ่มด้วยการอ่านรายการแอปและการตั้งค่า

รูปแบบตัวอย่างใน `~/.codex/config.toml`:

```toml
[mcp_servers.devtools]
url = "https://mcp.facebook.com/devtools"
```

เมื่อหน้าของ Meta แสดงตัวเลือกอ่าน/จัดการ ให้เริ่มจากสิทธิ์อ่านเพื่อสำรวจค่า หากต้องเขียนการตั้งค่า ต้องตรวจแอป, URL callback และ field ที่จะเปลี่ยนก่อน แล้วจึงอนุญาตสิทธิ์จัดการเฉพาะตอนที่จำเป็น การเชื่อม MCP เป็นเครื่องมือผู้ดูแล ไม่ได้เชื่อม Page ของลูกค้าเข้ากับ DNA OS

### เครื่องมือที่เกี่ยวข้องกับงานนี้

| งาน | เครื่องมือ Meta MCP | ขอบเขตตามเอกสาร Meta |
|---|---|---|
| ตรวจแอป การตั้งค่า และสถานะรีวิว | skill `/app-health-check` หรือเครื่องมือ `devtools_*` ที่ server เผยแพร่ | อ่านก่อนเปลี่ยน |
| ตั้ง Webhook ระดับแอป | skill `/webhook-setup` | เปลี่ยนค่าแอป; ยืนยัน app, callback URL และ field ก่อนเขียน |
| ตรวจปัญหาการส่ง Webhook | skill `/debug-webhooks` | เริ่มจากอ่านสถานะ; การส่ง test event จะยิง callback จริง |
| ตรวจเอกสารและสิทธิ์ API | `/search-docs`, `/api-integration`, `/app-review-prep` | ตรวจเอกสารล่าสุดและสถานะแอป |

**กติกาก่อนเรียกเครื่องมือที่เขียนข้อมูล:** อ่านค่าแอปและ Webhook ปัจจุบันก่อน ระบุ `app_id`, URL และ field ที่จะเปลี่ยนให้ชัดเจน แล้วให้ผู้ดูแลยืนยันการเปลี่ยนแต่ละครั้ง ห้ามเพิ่ม use case/permission แบบกว้างโดยไม่จำเป็น ห้ามส่ง test payload ไปยัง production จนยืนยันปลายทางและผลที่จะเกิดแล้ว

Meta MCP ใช้จัดการ Webhook **ระดับแอป** ได้ การติดตั้งแอปลงบน Page และการอนุญาต Page token เป็นอีกขั้นหนึ่ง Meta ส่งเฉพาะ field ที่สมัครไว้ทั้งระดับแอปและระดับ Page เท่านั้น

Meta MCP ไม่ส่งคืน **App Secret** จากเครื่องมือสร้างแอป ให้ผู้ดูแลเปิดหน้าแอปใน Meta Dashboard เพื่ออ่านค่านั้น แล้วบันทึกเป็น Worker secret ผ่านช่องทางดูแลระบบที่ปลอดภัยเท่านั้น ส่วน Verify Token ให้ DNA OS สร้างค่าแบบสุ่มแยกต่างหากและใส่ให้ตรงกันทั้ง Meta callback config กับ Worker secret

## B. ขั้นตอนสำหรับผู้ใช้ร้าน/องค์กรใน DNA OS

นี่คือเส้นทางผลิตภัณฑ์ที่ต้องทำให้ผู้ใช้กดเชื่อมได้จากระบบ DNA OS โดยไม่ต้องเปิด Meta Developers เอง

### หน้าจอที่ผู้ใช้เห็น

เส้นทางเมนู:

```text
Workspace
  → ตั้งค่า
  → องค์กร/พื้นที่ทำงาน
  → ช่องเชื่อมต่อ
  → ช่องทางข้อความ
  → Facebook Page · Messenger
```

หน้ารายละเอียด Facebook Page แสดงข้อมูลสั้นๆ ก่อนเชื่อม:

- รับข้อความที่ลูกค้าส่งเข้าเพจและส่งเข้าเหตุการณ์ขององค์กร
- ระยะแรกยังไม่ตอบข้อความแทนร้าน
- ต้องเป็นผู้ดูแลเพจหรือมีสิทธิ์ตามที่ Meta กำหนด
- ระบบจะแสดงเพจที่บัญชี Meta อนุญาตให้เลือก
- แสดงสิทธิ์ที่ขอ เหตุผล และข้อมูลที่จะส่งเข้าระบบก่อนปุ่ม **เชื่อมเพจ**

### แผนที่ URL/API: ของที่มีและของที่ต้องทำ

| URL/จุดเชื่อม | สถานะ | หน้าที่ |
|---|---|---|
| `/account/connections/channels` → `/account/connections/facebook-messenger` | ยังไม่พบใน branch Production `origin/main` | หน้าคำอธิบาย, เลือกองค์กร, ปุ่มเชื่อม, สถานะ และการถอน |
| `GET /api/connectors/oauth/authorize/[slug]` และ `/callback/[slug]` | มี generic connector OAuth สำหรับผู้ดูแล แต่ไม่ได้เลือก/ผูก Page และ callback เก็บ generic connector token; **ไม่ใช้กับ Page OAuth** | Meta Business Login/Page flow ใหม่ที่มี state สุ่มใช้ครั้งเดียว, session และ organization authorization |
| `GET /api/gateway/observe/meta` และ `POST /api/gateway/observe/meta` | มี callback ใน Next.js source; ใน production ที่ตรวจตอบ 404 | ตรวจ challenge, HMAC แล้วส่ง event metadata เข้า Observe |
| `dnaos.dev/api/gateway/observe/meta` ผ่าน Worker | Worker source อยู่ใน release branch นี้; Cloudflare ยังไม่มี Worker ชื่อนี้ | callback production แบบ path เฉพาะ |
| `GET /api/account/connections/facebook-messenger/pages` | ยังไม่มี | แสดง Page ที่ผู้ใช้มีสิทธิ์เห็น โดยไม่ส่ง token กลับ browser |
| `POST /api/account/connections/facebook-messenger/pages/[pageId]/install` | ยังไม่มี | ตรวจสิทธิ์ Page แล้วสมัคร field `messages` และผูก Page กับองค์กร |
| `GET /api/account/connections/facebook-messenger/status` | ยังไม่มี | แสดงสถานะการอนุญาต, Page subscription และ event ล่าสุดโดยไม่เปิด credential |
| `DELETE /api/account/connections/facebook-messenger/pages/[pageId]` | ยังไม่มี | ถอน Page binding, subscription และ credential ตามสิทธิ์ |

เส้นทางที่เสนอทั้งหมดต้องตรวจ DNA OS session, สิทธิ์ในองค์กร, CSRF/state, ownership ของ Page และ rate limit; browser รับเฉพาะข้อมูลแสดงผล ห้ามรับ/คืน App Secret, access token, verify token หรือ `credential_ref`

### ลำดับการทำงาน

1. **เลือกองค์กรก่อน** — ผู้ใช้ต้องอยู่ในองค์กร/ร้านที่ตนมีสิทธิ์จัดการ การเชื่อมต่อไม่ควรผูกกับบัญชีส่วนตัวโดยไม่มีบริบทองค์กร
2. **เริ่มเชื่อมเพจ** — DNA OS ส่งผู้ใช้ไปหน้า OAuth/การอนุญาตของ Meta ด้วย Meta App ที่องค์กร DNA OS ควบคุม
3. **ตรวจ state และ callback** — callback ต้องผูกกับผู้เริ่มเชื่อม ใช้ state อายุสั้น ใช้ครั้งเดียว ป้องกัน CSRF และตรวจ error/การปฏิเสธสิทธิ์
4. **แลก authorization code ฝั่งเซิร์ฟเวอร์** — เก็บ token ใน secret vault เท่านั้น ห้ามส่ง token หรือ App Secret ไป browser, log, URL หรือฐานข้อมูลที่ผู้ใช้ทั่วไปอ่านได้
5. **แสดงรายการเพจ** — ดึงเฉพาะเพจที่บัญชีผู้ใช้มีสิทธิ์จัดการ ให้ผู้ใช้เลือกเพจจริงและยืนยันว่าเพจนั้นเป็นขององค์กรที่เลือก
6. **บันทึกการผูกเพจกับองค์กร** — บันทึก Page ID, ชื่อเพจ, ผู้ให้สิทธิ์, องค์กร, scopes, สถานะ, เวลาตรวจล่าสุด และ reference ไปยัง token ใน vault
7. **สมัครเพจเข้ากับแอป** — ฝั่งเซิร์ฟเวอร์ใช้ Page access token เรียก Graph API subscription ของ Page ให้รับ `messages` เท่านั้นในระยะแรก
8. **ตรวจว่าพร้อมรับเหตุการณ์** — แสดง “กำลังตรวจการเชื่อมต่อ” จนตรวจการอนุญาต, การสมัครเพจ, callback และ event path ได้ครบ อย่าแสดง “เชื่อมแล้ว” จากการ OAuth สำเร็จอย่างเดียว
9. **พิสูจน์ด้วยข้อความจริง** — ผู้ใช้ส่งข้อความทดสอบเข้าเพจ แล้วตรวจว่ามี event ของ Page และองค์กรที่ถูกต้องเข้ากล่องเหตุการณ์ DNA OS โดยไม่มีการตอบกลับอัตโนมัติ
10. **จัดการภายหลัง** — ให้ผู้ดูแลดูสถานะ เปลี่ยนเพจ ยกเลิกการเชื่อม และเห็นเวลา/ผลการรับเหตุการณ์ล่าสุดได้

### สถานะที่ควรแสดง

| สถานะใน DNA OS | ความหมาย |
|---|---|
| ยังไม่เชื่อม | ยังไม่มีการอนุญาตเพจ |
| รอเลือกเพจ | Meta อนุญาตบัญชีแล้ว แต่ยังไม่ได้เลือก Page |
| กำลังสมัครรับเหตุการณ์ | บันทึกการอนุญาตแล้ว กำลังผูก Page กับ Webhook |
| กำลังตรวจการเชื่อมต่อ | ตรวจ callback/การสมัครและ event ทดสอบ |
| รับเหตุการณ์แล้ว | event ของเพจเข้ากล่องเหตุการณ์และผูกองค์กรได้ถูกต้อง |
| ต้องแก้สิทธิ์ | Meta เพิกถอนสิทธิ์, token หมดอายุ, หรือ Page subscription หาย |
| ยกเลิกแล้ว | ผู้ใช้หรือ Meta ยกเลิกการอนุญาต |

## C. เส้นทางข้อมูลและจุดรับผิดชอบ

### ปลายทาง Webhook ของ DNA OS

```text
GET  https://dnaos.dev/api/gateway/observe/meta
  → ตรวจ hub.mode + hub.verify_token
  → ตอบ hub.challenge แบบ text/plain

POST https://dnaos.dev/api/gateway/observe/meta
  → ตรวจ X-Hub-Signature-256 ด้วย META_APP_SECRET
  → parse payload ของ Page
  → normalizeMetaWebhook()
  → Integration Gateway Observe / publish()
  → integration_gateway_events
  → ตอบ HTTP 200 ให้ Meta
```

### แยกหน้าที่ของรหัสและ token

| ค่า | ใช้ที่ใด | ใครดูแล |
|---|---|---|
| Meta App ID | OAuth config และหน้าแอป Meta | ผู้ดูแลระบบ DNA OS |
| Meta App Secret | ตรวจลายเซ็น webhook | Cloudflare Worker secret เท่านั้น |
| Verify Token | handshake GET ของ webhook; ค่าลับที่ DNA OS สร้างเองและต้องตรงกับค่าใน Meta | Cloudflare Worker secret + ฟอร์ม Meta |
| User access token | แลก/ค้นเพจตามการอนุญาต | Server-side ชั่วคราวตามความจำเป็น |
| Page access token | สมัครเพจและใช้ API ที่ได้รับอนุญาต | Secret vault ผูกกับ Page และองค์กร |
| Page ID | route event ไปยังการเชื่อมต่อ/องค์กรที่ถูกต้อง | Metadata ที่จำกัดสิทธิ์ |
| `X-Hub-Signature-256` | พิสูจน์ว่า POST มาจากแอปที่มี App Secret ตรงกัน | ตรวจที่ Worker ก่อนประมวลผล |

**ห้ามใช้ Meta MCP OAuth token แทน Page access token ของร้าน** และห้ามใช้ App Secret/Verify Token เป็น OAuth token ทั้งหมดนี้เป็นคนละ credential และคนละหน้าที่

## D. สิทธิ์และการอนุมัติ

เอกสาร Meta สำหรับ Webhooks ของ Pages และ Graph API `v27.0` ระบุว่า:

- ตั้ง Webhook object เป็น `Page` และเลือก field อย่างน้อยหนึ่งรายการ; สำหรับเหตุการณ์ Messenger ให้เลือก `messages`
- เพจต้องติดตั้งแอปที่กำหนด Webhook ไว้ และต้องไม่ปิดแพลตฟอร์มแอปของเพจ
- `/{page-id}/subscribed_apps` ใช้ Page access token จากผู้ที่มี task `CREATE_CONTENT`, `MANAGE` หรือ `MODERATE` และต้องมี `pages_manage_metadata` กับ `pages_show_list`
- สำหรับ field `messages` ต้องมี `pages_messaging` และ Page access token จากผู้ที่มี task `MESSAGING` บนเพจด้วย
- ต้องสมัคร field `messages` ทั้งที่ระดับแอปและระดับ Page; การสมัครสำเร็จระดับหนึ่งอย่างเดียวไม่ทำให้มี event ส่งถึง callback
- Webhooks product เองไม่ต้องผ่าน App Review แต่ permission ที่เปิดให้ใช้กับผู้ใช้ทั่วไปและการเปิดแอปเป็น Live ยังอยู่ภายใต้ข้อกำหนด App Review/การอนุมัติของ Meta ตามกรณี

ก่อนเปิดให้ผู้ใช้ภายนอกติดตั้ง ให้ตรวจ permissions, feature, app mode และ App Review ตาม Dashboard/เอกสาร Meta **ณ วันที่ปล่อยจริง** และขอเฉพาะสิทธิ์ที่ flow ใช้ ห้ามสรุปว่าการอยู่ใน Development Mode หรือการเพิ่ม permission ในแอปเพียงอย่างเดียวทำให้ทุกเพจภายนอกติดตั้งได้ ส่วนคู่มือ Webhooks กล่าวถึง mTLS สำหรับ subscription ของ WhatsApp Business Account; ไม่ใช่ข้อกำหนดที่ระบุสำหรับ Facebook Page Messenger ใน flow นี้

## E. โครงสร้างฝั่ง DNA OS ที่มีอยู่และงานที่ต้องเชื่อม

### โค้ด/สัญญาที่ตรวจพบใน repository นี้

- `workers/meta-webhook/index.ts` — Worker แยก ตรวจ GET challenge, POST signature, จำกัด body และส่ง event ผ่าน Gateway
- `workers/meta-webhook/wrangler.jsonc` — route `dnaos.dev/api/gateway/observe/meta`
- `app/api/gateway/observe/meta/route.ts` — route callback ใน Next.js; ตรวจ challenge/signature และเรียก Integration Gateway
- `engines/integration-gateway/adapters/meta.ts` — แปลง Meta event เป็น event กลาง
- `engines/integration-gateway/event-bus/bus.ts` — ส่ง event เข้า Observe bus
- `public/docs/integrations/facebook-messenger.md` — คู่มือท่อรับเดิม
- `app/api/connectors/oauth/authorize/[slug]/route.ts` และ `app/api/connectors/oauth/callback/[slug]/route.ts` — OAuth ทั่วไปสำหรับ connector ที่ผู้ดูแลตั้งค่า; callback ใช้ state จาก connector ID และบันทึก token ลง connector จึงยังไม่ใช่ flow ที่เหมาะกับการให้ลูกค้าเชื่อมหลาย Page เข้าองค์กร
- `app/account/connections/` — ยังไม่มีหน้าจอเชื่อม Facebook Page ใน branch Production ปัจจุบัน
- `supabase/migrations/20261007000001_propose_meta_gateway_providers.sql` — เพิ่ม `facebook`/`instagram` ใน provider allow-list แต่หัวไฟล์ระบุ DRAFT / NOT APPLIED; ต้องตรวจ ledger ของฐานข้อมูลเป้าหมายก่อนใช้

**ข้อจำกัดของ payload ปัจจุบัน:** adapter เก็บเฉพาะหลักฐาน เช่น sender/conversation/message IDs, ชนิดข้อความ, ชนิดไฟล์ และเวลา โดยตั้งใจไม่เก็บข้อความดิบหรือ URL ไฟล์ลง `integration_gateway_events` ดังนั้น event ปัจจุบันพิสูจน์ได้ว่ามีข้อความเข้า แต่ยังไม่ใช่กล่องแชทที่แสดงเนื้อหาข้อความ ถ้าผลิตภัณฑ์ต้องแสดง/ส่งต่อเนื้อหาจริง ต้องออกแบบที่เก็บข้อความแยกพร้อมการยินยอม การจำกัดสิทธิ์ การเข้ารหัส retention และการลบ ก่อนเพิ่มข้อความลง event payload

### งานที่ยังต้องทำก่อนให้ผู้ใช้กดติดตั้งได้จริง

1. เพิ่ม provider `facebook-messenger` ในหน้ารายละเอียดช่องเชื่อมต่อ พร้อมคู่มือและ state ที่แยกจาก Facebook Login สำหรับยืนยันตัวตน
2. ทำ OAuth/Business Login flow ของ Meta สำหรับผู้ดูแลธุรกิจ พร้อมค้นและให้เลือก Page; ไม่ควรเพียงเพิ่มโดเมน Meta เข้า OAuth allow-list เดิม เพราะ flow Page มีหลายทรัพย์สินและ Page token
3. วางความสัมพันธ์ `organization ↔ Page ↔ credential_ref` และกติกาว่าใครในองค์กรเชื่อม/ถอนเพจได้
4. สร้าง secure server-side operation เพื่อสมัคร Page กับ app ที่ field `messages`; ไม่รับ Page ID/token ที่ client ส่งมาโดยไม่ตรวจสิทธิ์
5. ปรับ Worker/Gateway ให้ map Page ID ไปยัง connection/organization ก่อนเผยแพร่ event; ถ้า map ไม่ได้ต้อง quarantine/reject อย่างตรวจสอบได้ ไม่ผูก event กับผู้ใช้แบบเดาสุ่ม
6. ตัดสินใจแบบมีหลักฐานว่าจะใช้ Worker หรือ Next.js callback เป็นปลายทาง production หลักหนึ่งตัว; อย่าให้ route ซ้ำรับ webhook พร้อมกัน
7. ตรวจ schema production สำหรับ provider/capability/event fields, policy/RLS, idempotency, retention และขอบเขตเนื้อหาข้อความก่อนเปิดจริง
8. เพิ่มสถานะเชื่อมต่อ/ยกเลิก/หมดอายุ และการตรวจสุขภาพ subscription โดยไม่เปิดเผย token
9. ทดสอบ end-to-end กับเพจที่ผู้ดูแลควบคุม: verify GET, signed POST, Page mapping, event เข้าองค์กรถูกต้อง, retry/dedup, revoke, และไม่มีข้อความตอบกลับ
10. ทำ App Review/โหมด Live ตามที่ Meta กำหนด แล้วค่อยเปิดปุ่มติดตั้งแก่ลูกค้าภายนอก

## F. เงื่อนไขผ่านก่อนเปิดปุ่ม “เชื่อมเพจ” ให้ผู้ใช้ทั่วไป

- [ ] แอป Meta และผู้รับผิดชอบแอปเป็นของ DNA OS/บริษัทที่ระบุชัด
- [ ] OAuth callback ที่ production ใช้ HTTPS และอยู่ใน allow-list ของแอป
- [ ] Meta ยืนยัน Callback URL ได้ และ GET ตอบ challenge ถูกต้อง
- [ ] POST ที่ลายเซ็นผิดถูกปฏิเสธ; App Secret ไม่อยู่ใน client/log/source
- [ ] Page ที่เลือกผูกกับองค์กรหนึ่งหรือหลายองค์กรตามกติกาที่ตรวจสอบได้
- [ ] การสมัครรับ `messages` สำเร็จและอ่านสถานะกลับมาได้
- [ ] มีเหตุการณ์ข้อความเข้าจริงในกล่องขององค์กรที่เลือก
- [ ] เหตุการณ์ซ้ำถูก deduplicate และ event ที่ระบุต้นทางไม่ได้ไม่ปะปนข้ามองค์กร
- [ ] หน้าจอระบุชัดว่าเป็น “รับข้อความเข้าเท่านั้น” และไม่มี auto-reply
- [ ] ถอนการเชื่อมแล้ว token ถูก revoke/ลบจาก vault และ subscription ถูกจัดการตามสิทธิ์
- [ ] Meta App Review/Live พร้อมสำหรับกลุ่มผู้ใช้ที่ต้องการเปิดให้เชื่อม

หากข้อใดไม่ผ่าน ให้สถานะเป็น **“รอเชื่อมต่อ/กำลังตรวจสอบ”** พร้อมบอกขั้นตอนที่ต้องทำต่อ ห้ามแสดงว่าเชื่อมสำเร็จจากการบันทึก OAuth เพียงอย่างเดียว

## แหล่งอ้างอิง Meta

- [Meta Social Technologies MCP](https://developers.facebook.com/documentation/mcp/devtools-mcp)
- [เชื่อม MCP client กับ Meta](https://developers.facebook.com/documentation/mcp/connect-an-mcp-client)
- [Webhooks สำหรับ Pages](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-pages)
- [Webhooks สำหรับ Messenger](https://developers.facebook.com/docs/messenger-platform/webhook)
- [Page subscribed_apps](https://developers.facebook.com/docs/graph-api/reference/page/subscribed_apps)
- [Meta Agentic Tools สำหรับ Codex และ MCP](https://github.com/facebook/agentic-tools)

ตรวจเอกสารวันที่ 26 พฤศจิกายน 2026: Graph API ระบุเวอร์ชันล่าสุด `v27.0`; ท่อ webhook ปัจจุบันไม่ได้เรียก Graph API โดยตรง เมื่อเพิ่ม OAuth หรือ Page subscription ให้ pin เวอร์ชัน Graph API ในคำขอและทดสอบซ้ำตามเอกสารขณะปล่อยจริง เอกสารนี้เป็นแผนเส้นทาง ไม่ใช่หลักฐานว่าแอปได้รับ App Review หรือเปิด Production แล้ว
