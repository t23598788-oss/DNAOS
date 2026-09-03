/**
 * หน้าที่: ให้ LINE adapter ที่มีอยู่จริงแล้วใน `engine-prototypeไลน์/` มีตัวตนใน
 * ทะเบียน canonical เป็นครั้งแรก เพื่อให้ DNA OS ค้นหาและเรียกมันได้ผ่านชั้น
 * capability route (Owner, 2026-09-02).
 *
 * ไม่ได้เขียน adapter ใหม่. โค้ดทั้งหมดที่อธิบายไว้ข้างล่างมีอยู่แล้วและไม่ถูกแตะ
 * — `line-adapter.ts` ตรวจลายเซ็น HMAC-SHA256 ด้วย timingSafeEqual, กัน replay
 * ด้วย `webhookEventId`, เก็บ `replyToken` ต่อผู้ใช้ และ `server.ts` เปิด
 * `POST /webhook/line` การลงทะเบียนครั้งนี้เพิ่ม "ตัวตน" ไม่ได้เพิ่มพฤติกรรม
 *
 * ทำไมยังไม่มี runtime identity. `loadLineConfig` บังคับว่า LINE_MODE=real ต้องมี
 * LINE_CHANNEL_SECRET และ LINE_CHANNEL_ACCESS_TOKEN ที่ไม่ว่าง วัดแล้ววันที่
 * 2026-09-02: ทั้งสองค่าใน `.env.local` ยาว 0 อักขระ engine จึงสตาร์ทโหมดจริง
 * ไม่ได้ และไม่มีพอร์ตให้ประกาศ การประกาศ RuntimeTarget ทั้งที่ยังไม่มีอะไรรัน
 * จะทำให้ route ชี้ไปที่อยู่ที่ไม่มีใครฟัง ซึ่งแย่กว่าการบอกตรง ๆ ว่ายังไม่มี
 * ที่อยู่ — ชั้น route จะตอบ NO_RUNTIME_BINDING พร้อมเหตุผล และนั่นคือความจริง
 *
 * Input: none (ค่าคงที่ค่าเดียว)
 * Output: `LINE_MESSAGING_INGRESS_CANDIDATE`
 * Dependency ที่อนุญาต: registration-contract (type เท่านั้น)
 * สิ่งที่ห้ามแตะ: ห้ามใส่ค่า credential จริงลงในไฟล์นี้, ห้ามอ้าง evidence ที่ยังไม่เกิด.
 */

import type { RegistrationCandidate } from "../../../control/event-pipeline/registration-contract";

export const LINE_MESSAGING_INGRESS_CANDIDATE: RegistrationCandidate = {
  candidate_id: "candidate-line-messaging-ingress-v1",
  name: "line-messaging-ingress",
  kind: "capability",
  source_location: "engine-prototypeไลน์/ (line-adapter.ts, server.ts, core-bus.ts, config.ts, contract.ts)",
  owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/line-messaging-ingress.ts",

  input: [
    "HTTP POST /webhook/line — raw body plus the x-line-signature header, exactly as LINE sends it",
    "LINE_MODE, LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN from the process environment",
  ],
  output: [
    "EngineMessage { eventId, correlationId, source, type, payload, replyTo } dispatched onto the CoreBus",
    "HTTP 200 on an accepted webhook; a non-200 when the signature does not verify",
    "an outbound LINE reply sent with the stored replyToken for a given user",
  ],
  side_effects: [
    "outbound HTTPS to the LINE Messaging API when replying",
    "in-memory retention of seen webhookEventIds and per-user replyTokens for the life of the process",
  ],
  dependencies: [
    "LINE Messaging API channel credentials (channel secret + channel access token)",
    "engine-prototypeไลน์/core-bus.ts — the in-process bus adapters register on",
  ],

  behavior:
    "verify_line_signature_then_dispatch_one_message_per_webhook_event: computes HMAC-SHA256 of the raw body with the channel secret and compares it to x-line-signature using timingSafeEqual, so a forged or tampered webhook is rejected before any parsing. An event whose webhookEventId has already been seen is dropped rather than dispatched twice, which makes LINE's at-least-once delivery safe to accept. Each accepted event becomes exactly one EngineMessage on the CoreBus carrying its own correlationId, and the replyToken is retained per user so a reply can be sent back on the same conversation. It executes nothing itself: it is an ingress boundary that turns a verified external message into an internal one.",

  version: "1.0.0",

  evidence_refs: [
    "engine-prototypeไลน์/line-adapter.ts — RealLineAdapter, createHmac/timingSafeEqual signature check, seenWebhookEventIds, replyTokens",
    "engine-prototypeไลน์/server.ts — createEngineServer exposes POST /webhook/line, listens on PORT (default 3000)",
    "engine-prototypeไลน์/config.ts — loadLineConfig requires LINE_MODE=real plus a non-empty channel secret and access token",
    "engine-prototypeไลน์/contract.ts — EngineMessage / EngineAdapter shapes",
    "engine-prototypeไลน์/closed-loop.test.ts — the adapter's own closed-loop test",
    "measured 2026-09-02: pgrep engine-prototype -> not running; canonical rows for engine-prototype -> 0",
    "measured 2026-09-02: .env.local declares both credential keys with 0-character values, so LINE_MODE=real cannot start",
  ],

  domain: "SOFTWARE_CONTROL_PLANE",
  resource_type: "CAPABILITY",
  data_classification: "INTERNAL",
  source_system: "dna-os-infrastructure",
  scope: "connections/line-messaging-ingress",

  origin: {
    origin_kind: "OWNER_DIRECTIVE",
    origin_reference: "TASK:REGISTER_EXISTING_LINE_CAPABILITY_AFTER_ROUTE_LAYER",
    introduced_by: "software/capability-registrar/register-line-messaging-ingress.ts",
  },
};
