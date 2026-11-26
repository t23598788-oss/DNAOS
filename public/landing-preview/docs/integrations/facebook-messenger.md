# Facebook Pages / Messenger event connector

คู่มือตั้งค่า Meta MCP และเส้นทางให้ร้าน/องค์กรเชื่อมเพจผ่าน DNA OS อยู่ที่ [meta-mcp-and-facebook-page-installation.md](./meta-mcp-and-facebook-page-installation.md)

สถานะตรวจล่าสุด 26 พฤศจิกายน 2026: `https://dnaos.dev/api/gateway/observe/meta` ตอบ 404 และบัญชี Cloudflare ปัจจุบันยังไม่มี Worker ชื่อ `dnaos-meta-webhook`; Worker ยังไม่อยู่บน Production. โค้ดใน repo รองรับท่อรับเหตุการณ์ แต่ OAuth รายผู้ใช้, การเลือก Page และการผูก Page เข้ากับองค์กรยังไม่เปิดใช้งาน (`userConnection: not_implemented`).

## ขอบเขตของท่อ

ท่อนี้รับ webhook จาก Facebook Page, ตรวจสอบว่าคำขอมาจาก Meta, แปลงเหตุการณ์เป็นรูปแบบกลางของ DNA OS แล้วส่งเข้า Integration Gateway ช่อง Observe จากนั้นตอบ HTTP 200 เพื่อยืนยันการรับเหตุการณ์กับ Meta

เส้นทาง:

```text
Facebook Page webhook
  → Cloudflare Worker route: dnaos.dev/api/gateway/observe/meta
  → GET/POST /api/gateway/observe/meta
  → ตรวจ challenge / X-Hub-Signature-256
  → engines/integration-gateway/adapters/meta.ts
  → Integration Gateway Observe event
  → integration_gateway_events
  → HTTP 200 acknowledgement
```

เหตุการณ์ที่ยอมรับ ได้แก่ `message.received`, `document.received` และ `interaction.received` จาก webhook object `page` เท่านั้น ข้อความที่เพจส่งเอง (`is_echo`), delivery/read receipt และ object ที่ไม่รองรับจะถูกข้าม ตัว adapter ไม่ส่งเนื้อหาข้อความหรือ URL ไฟล์ลง evidence event

**ขอบเขตปัจจุบัน:** เป็นท่อรับเหตุการณ์และตอบรับ webhook เท่านั้น ยังไม่ผูก OAuth/Page access token รายองค์กร ไม่เก็บข้อความสนทนาสำหรับประมวลผล และไม่ส่งข้อความตอบลูกค้าผ่าน Messenger Send API

## ไฟล์ในระบบ

- `app/api/gateway/observe/meta/route.ts` — callback GET/POST สำหรับ Meta
- `workers/meta-webhook/index.ts` — Cloudflare Worker callback ที่ผูกเฉพาะ path ของ webhook บน `dnaos.dev`
- `workers/meta-webhook/wrangler.jsonc` — production route pattern และ runtime config
- `engines/integration-gateway/adapters/meta.ts` — ตรวจลายเซ็น challenge และแปลง payload
- `engines/integration-gateway/event-bus/bus.ts` — ส่ง event เข้า event bus และ evidence store
- `engines/integration-gateway/contracts/event.ts` — รูปแบบ event กลาง
- `engines/integration-gateway/policy/gate.ts` — เปิดรับเฉพาะ channel ที่อนุญาต
- `engines/integration-gateway/evidence/store.ts` — เขียน event แบบ idempotent

## การติดตั้งสำหรับผู้ดูแลระบบ

1. ใช้ Meta App ที่องค์กรควบคุม และเพิ่มผลิตภัณฑ์ Webhooks
2. เลือก object `Page` และ field `messages` สำหรับ Messenger events
3. ตั้ง Worker secrets `META_VERIFY_TOKEN`, `META_APP_SECRET`, `SUPABASE_URL` และ `SUPABASE_SERVICE_ROLE_KEY` ใน Cloudflare; ห้ามใส่ค่าเหล่านี้ใน browser, source control หรือส่งผ่านแชท
4. Deploy Worker ด้วย `npx wrangler deploy --config workers/meta-webhook/wrangler.jsonc`
5. ตั้ง callback URL เป็น `https://dnaos.dev/api/gateway/observe/meta` ใน Meta Dashboard
6. ตั้ง Webhook ระดับแอปเป็น object `Page` และเลือก field `messages`; จากนั้นให้ผู้ดูแลเพจติดตั้งแอปและสมัคร Page เข้ากับแอปผ่าน `/{page-id}/subscribed_apps`. สำหรับการอ่าน/สร้าง Page subscription เอกสาร Graph API ปัจจุบันระบุ `pages_manage_metadata` และ `pages_show_list`; สำหรับ field `messages` ต้องมี `pages_messaging` และ Page access token จากผู้ที่มี task `MESSAGING` บนเพจ
7. กด Verify and Save; ระบบต้องตอบ challenge เดิมเป็น plain text
8. ตรวจการส่ง event จากเครื่องมือทดสอบของ Meta แล้วดู event ใน Integration Gateway

Meta กำหนดทั้งการสมัคร field ที่ระดับแอปและการติดตั้งแอปที่ระดับ Page; จะได้รับ webhook เฉพาะ field ที่สมัครไว้ทั้งสองระดับ เอกสาร Webhooks ระบุว่า Webhooks product เองไม่ต้องผ่าน App Review แต่สิทธิ์เข้าถึงข้อมูลและการเปิดแอปเป็น Live ยังต้องผ่านข้อกำหนด permission/App Review ของ Meta ตามกรณี

## การทดสอบในเครื่อง

```bash
npx tsx scripts/meta-messenger-adapter.test.ts
npx tsx scripts/meta-webhook-worker.test.ts
npx tsx scripts/connect-gateway-webhook-gate.test.ts
npx wrangler deploy --config workers/meta-webhook/wrangler.jsonc --dry-run
```

ผลที่คาดหวังในชุดทดสอบสัญญา Meta คือ signature ที่ถูกต้องผ่าน, body ที่ถูกแก้/ไม่มี secret ถูกปฏิเสธ, challenge ผิดถูกปฏิเสธ, message ถูกแปลงเป็น event กลาง, echo/receipt ถูกข้าม และ event ไม่ร้องขอ side effect

ไม่ต้องสร้างโดเมนหรือ URL แยก Worker route นี้จับเฉพาะ path `/api/gateway/observe/meta` บน `dnaos.dev` และปล่อยหน้าเว็บส่วนอื่นให้ Pages ทำงานตามเดิม ก่อน deploy ต้องตรวจว่า schema production อนุญาต provider `facebook` ใน `integration_gateway_events` แล้ว แหล่งที่มีใน branch Production คือ `supabase/migrations/20261007000001_propose_meta_gateway_providers.sql` ซึ่งระบุในหัวไฟล์ว่า DRAFT / NOT APPLIED; สถานะ migration บนฐานข้อมูลจริงยังตรวจไม่ได้เพราะ Supabase project ไม่ได้ link ใน workspace นี้ จึงห้ามถือว่า production schema พร้อมจนกว่าจะตรวจ migration ledger ของ project เป้าหมาย

## เอกสาร Meta สำหรับนักพัฒนา

- [Webhooks for Pages](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-pages)
- [Webhooks from Meta](https://developers.facebook.com/docs/graph-api/webhooks)
- [Messenger Page Messages API](https://developers.facebook.com/docs/graph-api/reference/page/messages)
- [Messenger Send API Quick Start](https://developers.facebook.com/docs/messenger-platform/getting-started/quick-start)

ตรวจเอกสารเมื่อ 26 พฤศจิกายน 2026: Graph API docs แสดงเวอร์ชันล่าสุด `v27.0`. ท่อ webhook นี้ไม่ได้เรียก Graph API จึงไม่มีเลขเวอร์ชัน Graph API ฝังใน Worker; เมื่อเพิ่มขั้นตอน OAuth หรือ Page subscription ให้ระบุและทดสอบเวอร์ชัน Graph API ที่ใช้ในคำขอจริง

การส่งข้อความตอบลูกค้าเป็นงานพัฒนาขั้นถัดไป ต้องเพิ่มการผูก Page กับองค์กร, เก็บ credential ฝั่ง server, กำหนด policy/สิทธิ์การส่ง และทดสอบ delivery ก่อนเปิด Send API
