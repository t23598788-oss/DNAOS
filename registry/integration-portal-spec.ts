/**
 * registry/integration-portal-spec.ts
 *
 * The narrative layer of the DNA OS Developer Portal — one continuous story
 * from a real business symptom to the exact HTTP pipe that fixes it.
 *
 * Why this file exists (and does not duplicate developer-portal-spec.ts):
 *   - developer-portal-spec.ts holds the reference docs (architecture, engines,
 *     settings) and the canonical EndpointSpec objects for the public surface.
 *   - This file holds the JOURNEY: problem → why a gateway → real endpoints at
 *     the seam. Where an endpoint already exists in developer-portal-spec.ts it
 *     is REUSED by id (reuse()), never copied.
 *   - app/admin/docs/page.tsx renders STORY_SECTIONS. It is the only consumer.
 *
 * Every endpoint below was read from its real handler at the path named in
 * registryRefs[]. Nothing here is aspirational: where a capability is not wired
 * (no AWS adapter; contractor intake paused; KBank sandbox pending) the copy
 * says so instead of drawing a fake box.
 */
import {
  DOCS,
  type EndpointSpec,
  type ParamLocation,
  type ParamSpec,
} from "./developer-portal-spec";

export const PORTAL_STORY_VERSION = "2.3";

export interface StoryTable {
  columns: string[];
  rows: string[][];
}

export interface StoryCode {
  language: string;
  content: string;
}

export interface StorySection {
  id: string;
  kicker: string;
  title: string;
  titleEn: string;
  lead?: string;
  paragraphs?: string[];
  bullets?: string[];
  table?: StoryTable;
  code?: StoryCode;
  /** Left-to-right wiring: provider → gateway → canonical writer → table. */
  chain?: string[];
  endpoints?: EndpointSpec[];
}

const rp = (
  name: string,
  location: ParamLocation,
  type: string,
  required: boolean,
  description: string,
  example?: string,
): ParamSpec => ({ name, location, type, required, description, example });

/** Reuse a real endpoint from the reference spec instead of re-declaring it. */
function reuse(docSlug: string, endpointId: string): EndpointSpec {
  const doc = DOCS.find((entry) => entry.slug === docSlug);
  const endpoint = doc?.sections
    .flatMap((section) => section.endpoints ?? [])
    .find((entry) => entry.id === endpointId);
  if (!endpoint) {
    throw new Error(
      `[integration-portal-spec] endpoint "${endpointId}" not found in doc "${docSlug}" — the reference spec changed; update the journey rather than inlining a copy.`,
    );
  }
  return endpoint;
}

// ─────────────────────────────────────────────────────────────────────────────
// Endpoints read from the real handlers
// ─────────────────────────────────────────────────────────────────────────────

const observeLine: EndpointSpec = {
  id: "gateway-observe-line",
  method: "POST",
  path: "/api/gateway/observe/line",
  auth: "ลายเซ็น x-line-signature (HMAC-SHA256 base64 ของ raw body) — ไม่ใช้ session; secret ต่อ destination อ่านจาก connect_external_account_credentials",
  summary:
    "ทางเข้าของ LINE event เข้า Integration Gateway (Observe Channel เท่านั้น) — ตรวจลายเซ็นก่อน แล้วแปลเป็น GatewayEvent กลางส่งเข้า event bus ไม่รันอะไรเลย",
  params: [
    rp("x-line-signature", "header", "string (base64)", true, "HMAC-SHA256 ของ raw body ด้วย channel secret ของ destination นั้น"),
    rp("destination", "body", "string", true, "บัญชี LINE ที่ event เข้ามา ใช้เลือก secret ของร้านนั้น", "Uxxxxxxxxxxxxxxxx"),
    rp("events", "body", "GatewayEvent[]", true, "รายการ event ตามสเปก LINE ที่ adapter แปลงได้"),
    rp("events[].type", "body", "string", true, "message | follow | unfollow | postback | join | leave", "message"),
  ],
  requestSample: `curl -X POST https://<host>/api/gateway/observe/line \\
  -H "Content-Type: application/json" \\
  -H "x-line-signature: <base64-hmac>" \\
  -d '{
    "destination": "Uxxxxxxxxxxxxxxxx",
    "events": [{
      "type": "message",
      "timestamp": 1794000000000,
      "source": { "userId": "Uxxxxxxxxxxxxxxxx", "type": "user" },
      "message": { "type": "text", "id": "1", "text": "ส่งของถึงไหนแล้ว" }
    }]
  }'`,
  responseSample: `{
  "ok": true,
  "accepted": 1,
  "skipped": []
}`,
  verification: [
    "ไม่ตั้ง secret ของบัญชีและ LINE_CHANNEL_SECRET → 503 (ไม่เดา secret แทน)",
    "ลายเซ็นไม่ตรง → 401 และไม่มีการอ่านหรือเขียนข้อมูลใด ๆ",
    "body ไม่ใช่ JSON → 400",
    "event bus ปฏิเสธ (channel ปิด/สัญญาไม่ครบ) → 500 ไม่ ack ปลอม",
    "ยืนยันว่า route นี้ไม่เรียก dispatcher และไม่เขียนตารางธุรกิจ — เป็น Observe เท่านั้น",
  ],
  registryRefs: [
    "app/api/gateway/observe/line/route.ts",
    "engines/integration-gateway/adapters/line.ts",
    "engines/connect/accounts.ts",
    "engines/integration-gateway/policy/gate.ts",
  ],
};

const connectEvent: EndpointSpec = {
  id: "connect-event",
  method: "POST",
  path: "/api/internal/connect/event",
  auth: "header x-connect-internal-secret = CONNECT_INTERNAL_SECRET (server-to-server เท่านั้น ไม่มี session)",
  summary:
    "ประตูเดียวที่ provider tier ใช้สร้าง/ขยับ Business Event — รับเฉพาะคำสั่งที่ประกาศไว้ และ map ทีละฟิลด์เข้า canonical writer ไม่ spread object ของผู้เรียกเข้า DB",
  params: [
    rp("x-connect-internal-secret", "header", "string", true, "secret ของConnect boundary (503 ถ้ายังไม่ตั้งค่า, 401 ถ้าไม่ตรง)"),
    rp("command", "body", "enum", true, "business_event.create | business_event.transition | business_event.enrich | business_event.link_transaction", "business_event.create"),
    rp("actor", "body", "string", true, "ผู้กระทำที่ถูกบันทึกใน audit", "line:Uxxxxxxxx"),
    rp("payload.event_code", "body", "string", true, "รหัสเหตุการณ์ทางธุรกิจ (create)", "EVT-2026-0001"),
    rp("payload.title", "body", "string", true, "ชื่อเหตุการณ์ (create)", "ส่งหิน 10 ล้อ ไปหนองคาย"),
    rp("payload.event_date", "body", "string (date)", true, "วันที่เกิดเหตุการณ์ (create)", "2026-11-11"),
    rp("payload.source_provider", "body", "string", true, "ผู้ให้บริการต้นทาง (create)", "line"),
  ],
  requestSample: `curl -X POST https://<host>/api/internal/connect/event \\
  -H "Content-Type: application/json" \\
  -H "x-connect-internal-secret: $CONNECT_INTERNAL_SECRET" \\
  -d '{
    "command": "business_event.create",
    "actor": "line:Uxxxxxxxx",
    "payload": {
      "event_code": "EVT-2026-0001",
      "title": "ส่งหิน 10 ล้อ ไปหนองคาย",
      "event_date": "2026-11-11",
      "event_type": "delivery",
      "source_provider": "line",
      "source_external_subject_id": "Uxxxxxxxx",
      "partner_id": null,
      "material_text": "หินคลุก",
      "quantity": 10,
      "quantity_unit": "ล้อ",
      "destination": "หนองคาย",
      "confidence": 0.82
    }
  }'`,
  responseSample: `{
  "ok": true,
  "id": "<business_events.id>",
  "event_code": "EVT-2026-0001",
  "status": "created"
}`,
  verification: [
    "ไม่ตั้ง CONNECT_INTERNAL_SECRET → 503 ก่อนอ่าน body",
    "secret ไม่ตรง → 401",
    "command นอกรายการ หรือ actor ว่าง → 400",
    "event_code/title/event_date/source_provider หาย → 400",
    "writer ปฏิเสธสถานะที่ไม่รู้จัก → 422 { ok:false, error:'EVENT_UNKNOWN_STATE:...' }",
    "ตรวจว่าไม่มีเส้นอื่นเขียน public.business_events จากภายนอกได้",
  ],
  registryRefs: [
    "app/api/internal/connect/event/route.ts",
    "engines/canonical/event-write.ts",
    "registry/events.json",
  ],
};

const kbankWebhook: EndpointSpec = {
  id: "kbank-webhook",
  method: "POST",
  path: "/api/connectors/webhook/kbank",
  auth: "connector ต้องอยู่ในสถานะ connected + enabled และมี webhook secret ตั้งค่าแล้ว (evaluateWebhookRequest แบบ fail-closed)",
  summary:
    "รับ webhook จาก KBank: ตรวจขนาด body → ตรวจลายเซ็น → เก็บ raw payload ลง kbank_webhook_events → แปลงเป็น GatewayEvent → publish เข้า Observe Channel",
  params: [
    rp("content-length", "header", "number", false, "ถ้ามาเกิน MAX_WEBHOOK_BODY_BYTES → 413 ก่อน buffer ทั้งก้อน"),
    rp("x-kbank-signature", "header", "string", true, "ลายเซ็นของ KBank ตามที่ connector ตั้งค่าไว้ (ขาด/ผิด → 401)"),
    rp("body", "body", "object", true, "payload ตามสเปก KBank ที่ normalizer อ่านได้"),
  ],
  requestSample: `curl -X POST https://<host>/api/connectors/webhook/kbank \\
  -H "Content-Type: application/json" \\
  -H "x-kbank-signature: <provider-signature>" \\
  -d '{
    "eventId": "KB-20261111-0001",
    "eventType": "TRANSFER_IN",
    "amount": 12500.00,
    "currency": "THB",
    "reference": "REF-88231"
  }'

# สถานะจริง: KBank sandbox ยังรอผู้ดูแลตรวจ (ยื่น 26/10/2026, เลขคำขอ 1792988917)
# route นี้จึงเป็น skeleton แบบ mock-mode — ยังไม่ควรใช้กับเงินจริงจนกว่าจะได้ secret`,
  responseSample: `{ "received": true, "published": 1 }`,
  verification: [
    "ไม่มี connector ที่ connected+enabled → 404",
    "body ใหญ่เกินกำหนด → 413",
    "ยังไม่ตั้ง webhook secret → 503",
    "ลายเซ็นขาด/ผิด → 401 และไม่เขียน kbank_webhook_events",
    "เขียน raw payload ไม่สำเร็จ → 500 (ไม่ ack ทั้งที่หลักฐานหาย)",
    "normalizer แปลงไม่ได้เลย → 400",
  ],
  registryRefs: [
    "app/api/connectors/webhook/kbank/route.ts",
    "app/api/connectors/webhook/[slug]/_lib/webhookGate.ts",
    "engines/integration-gateway/adapters/kbank.ts",
    "registry/connector-lifecycle.json",
  ],
};

const paymentConfirm: EndpointSpec = {
  id: "connect-payment-confirm",
  method: "POST",
  path: "/api/internal/connect/payment-confirm",
  auth: "header x-payment-confirm-internal-secret = PAYMENT_CONFIRM_INTERNAL_SECRET",
  summary:
    "เส้นเดียวที่ provider tier ใช้ยืนยันรับเงิน — ผู้เรียกส่งได้แค่ receipt_document_id กับ actor; ยอดเงินทุกตัวอ่านจาก canonical ภายใน ไม่มีทางใส่ตัวเลขเอง",
  params: [
    rp("x-payment-confirm-internal-secret", "header", "string", true, "secret ของ payment bridge (503 ถ้าไม่ตั้ง, 401 ถ้าไม่ตรง)"),
    rp("receipt_document_id", "body", "string (uuid)", true, "เอกสารใบเสร็จ/สลิปที่ต้องการยืนยัน", "0f0c...-..."),
    rp("actor", "body", "string", true, "ผู้ยืนยัน ใช้บันทึก audit", "line:Uxxxxxxxx"),
  ],
  requestSample: `curl -X POST https://<host>/api/internal/connect/payment-confirm \\
  -H "Content-Type: application/json" \\
  -H "x-payment-confirm-internal-secret: $PAYMENT_CONFIRM_INTERNAL_SECRET" \\
  -d '{
    "receipt_document_id": "0f0c2c1e-6a3e-4b1f-9d2a-6f0b7c9e1a11",
    "actor": "line:Uxxxxxxxx"
  }'`,
  responseSample: `{
  "ok": true,
  "data": {
    "already_reconciled": false,
    "new_outstanding": 0,
    "debt_event_id": "<debt_events.id>",
    "acknowledgement": { "ok": true }
  }
}`,
  verification: [
    "ไม่ตั้ง secret → 503; secret ผิด → 401",
    "ไม่มี receipt_document_id หรือ actor → 400",
    "เอกสารไม่เข้าเกณฑ์/guard B-04 ปฏิเสธ → 422 { ok:false } และไม่มีการเขียนเงินใด ๆ",
    "ยืนยันซ้ำรายการเดิม → already_reconciled = true ไม่สร้างรายการซ้ำ",
    "ตรวจว่าไม่มียอดเงินจาก body ถูกใช้ในการคำนวณ (อ่าน canonical เท่านั้น)",
  ],
  registryRefs: [
    "app/api/internal/connect/payment-confirm/route.ts",
    "engines/canonical/receipt-confirm-flow.ts",
    "gateway/payment-acknowledgement.ts",
  ],
};

const connectExpense: EndpointSpec = {
  id: "connect-expense",
  method: "POST",
  path: "/api/internal/connect/expense",
  auth: "header x-expense-internal-secret = EXPENSE_INTERNAL_SECRET",
  summary:
    "ประตูเงินออก: บันทึกค่าใช้จ่ายบริษัทและคำขอจ่ายพาร์ทเนอร์ผ่าน canonical writer — คำขอเริ่มเป็น pending เสมอ และการเปลี่ยนสถานะรับเฉพาะค่าที่ประกาศไว้",
  params: [
    rp("x-expense-internal-secret", "header", "string", true, "secret ของเงินออก (503/401 แบบ fail-closed)"),
    rp("command", "body", "enum", true, "expense.record | payable.request | payable.transition", "expense.record"),
    rp("actor", "body", "string", true, "ผู้บันทึก", "line:Uxxxxxxxx"),
    rp("payload.document_type", "body", "string", true, "ชนิดเอกสาร (expense.record)", "fuel_bill"),
    rp("payload.amount", "body", "number", true, "ยอดเงิน (expense.record / payable.request)", "1850.00"),
    rp("payload.partner_name", "body", "string", true, "ชื่อพาร์ทเนอร์ (payable.request)", "หจก. ทรายทอง"),
    rp("payload.payable_id", "body", "string", true, "รายการที่ต้องขยับ (payable.transition)"),
    rp("payload.to", "body", "enum", true, "owner_acknowledged | completed | paid_confirmed"),
  ],
  requestSample: `curl -X POST https://<host>/api/internal/connect/expense \\
  -H "Content-Type: application/json" \\
  -H "x-expense-internal-secret: $EXPENSE_INTERNAL_SECRET" \\
  -d '{
    "command": "expense.record",
    "actor": "line:Uxxxxxxxx",
    "payload": {
      "document_type": "fuel_bill",
      "amount": 1850.00,
      "vendor_name": "ปั๊มน้ำมัน",
      "expense_date": "2026-11-11",
      "receipt_document_id": "0f0c2c1e-6a3e-4b1f-9d2a-6f0b7c9e1a11",
      "submitted_by_line_user_id": "Uxxxxxxxx"
    }
  }'`,
  responseSample: `{
  "ok": true,
  "data": { "id": "<company_expenses.id>" }
}`,
  verification: [
    "command ที่ไม่อยู่ในรายการ → 400 พร้อมรายการที่รองรับ",
    "payable.transition ที่ to ไม่อยู่ใน 3 ค่าที่ประกาศ → 400",
    "writer ปฏิเสธ (Rule 72 / สถานะผิด) → 422 { ok:false }",
    "ยืนยันว่า payable ที่สร้างใหม่มีสถานะ pending ไม่ใช่ paid",
  ],
  registryRefs: [
    "app/api/internal/connect/expense/route.ts",
    "engines/canonical/expense-write.ts",
  ],
};

const equipmentTelemetry: EndpointSpec = {
  id: "equipment-telemetry",
  method: "POST",
  path: "/api/internal/equipment/telemetry",
  auth: "header x-equipment-telemetry-secret = EQUIPMENT_TELEMETRY_SECRET (ไม่ได้ตั้งค่า → 500 ตาม handler จริง)",
  summary:
    "รับสัญญาณจากกล่อง GPS/รีเลย์: แปลง VCC เป็น engine_running ที่จุดเดียว (≥ 13.5V) บันทึก ping และสะสมชั่วโมงเครื่องให้สินทรัพย์",
  params: [
    rp("x-equipment-telemetry-secret", "header", "string", true, "secret ของ ingestion (401 ถ้าไม่ตรง)"),
    rp("imei", "body", "string", true, "IMEI ของเครื่องจักร ใช้หา equipment_assets", "356938035643809"),
    rp("vccVoltage", "body", "number", true, "แรงดันไฟเลี้ยง ใช้ตัดสินว่าเครื่องติดอยู่หรือไม่", "13.8"),
    rp("recordedAt", "body", "string (ISO)", false, "เวลาที่วัดได้ (ไม่ส่ง = ใช้เวลาปัจจุบัน)"),
  ],
  requestSample: `curl -X POST https://<host>/api/internal/equipment/telemetry \\
  -H "Content-Type: application/json" \\
  -H "x-equipment-telemetry-secret: $EQUIPMENT_TELEMETRY_SECRET" \\
  -d '{
    "imei": "356938035643809",
    "vccVoltage": 13.8,
    "recordedAt": "2026-11-11T08:30:00.000Z"
  }'`,
  responseSample: `{
  "ok": true,
  "engine_running": true,
  "delta_hours": 0.75,
  "capped_from_hours": null,
  "new_total_hours": 248.25
}`,
  verification: [
    "IMEI ไม่มีใน equipment_assets → 404 (ไม่สร้างเครื่องให้เอง)",
    "ไม่ส่ง imei หรือ vccVoltage → 400",
    "VCC 13.4 → engine_running = false และไม่บวกชั่วโมง",
    "ยืนยันว่า delta_hours ถูก cap ตาม accumulateEngineHours เมื่อ ping ขาดช่วง",
    "ตรวจว่า raw_payload ถูกเก็บไว้เพื่อ audit",
  ],
  registryRefs: [
    "app/api/internal/equipment/telemetry/route.ts",
    "engines/equipment/engine-hours.ts",
    "docs/equipment-maintenance-lock-module.md",
  ],
};

const resourceTransaction: EndpointSpec = {
  id: "connect-resource-transaction",
  method: "POST",
  path: "/api/internal/connect/resource-transaction",
  auth: "header x-resource-transaction-internal-secret = RESOURCE_TRANSACTION_INTERNAL_SECRET",
  summary:
    "บันทึกการใช้ทรัพยากร (ชั่วโมงเครื่อง/เที่ยววิ่ง) จาก producer ช่องทางใดก็ได้ — ประตูเดียวที่สร้าง resource_transactions พร้อม idempotency และ canonical audit",
  params: [
    rp("x-resource-transaction-internal-secret", "header", "string", true, "secret ของ bridge"),
    rp("source", "body", "string", true, "ช่องทางที่มา เช่น telemetry / sim-gps", "telemetry"),
    rp("source_event_id", "body", "string", true, "รหัสเหตุการณ์ต้นทาง ใช้กันข้อมูลซ้ำ", "ping-88231"),
    rp("resource_label", "body", "string", true, "ชื่อทรัพยากรที่ใช้", "รถบรรทุก 10 ล้อ"),
    rp("job_id", "body", "string", true, "งานที่ผูกกับการใช้ทรัพยากร", "<job_id>"),
    rp("started_at", "body", "string (ISO)", true, "เวลาเริ่มใช้งาน"),
    rp("duration_hours", "body", "number", true, "ระยะเวลาที่ใช้ (ชั่วโมง)", "3.5"),
    rp("evidence_ref", "body", "string", true, "หลักฐานอ้างอิง"),
    rp("received_at", "body", "string (ISO)", true, "เวลาที่ระบบได้รับ"),
    rp("actor", "body", "string", true, "ผู้ส่ง/ระบบที่ส่ง"),
    rp("supply.pit_profile_id", "body", "string (uuid)", false, "บ่อที่วัสดุถูกใช้ (เมื่อประกาศ supply)"),
    rp("supply.material_type_id", "body", "string (uuid)", false, "วัสดุที่ถูกใช้"),
    rp("supply.quantity", "body", "number", false, "จำนวนที่ตัด (มากกว่า 0)", "6"),
    rp("supply.unit", "body", "enum", false, "CUBIC | TON — ต้องตรงกับหน่วยสต็อก"),
  ],
  requestSample: `curl -X POST https://<host>/api/internal/connect/resource-transaction \\
  -H "Content-Type: application/json" \\
  -H "x-resource-transaction-internal-secret: $RESOURCE_TRANSACTION_INTERNAL_SECRET" \\
  -d '{
    "source": "telemetry",
    "source_event_id": "ping-88231",
    "resource_label": "รถบรรทุก 10 ล้อ",
    "job_id": "<job_id>",
    "started_at": "2026-11-11T08:00:00.000Z",
    "duration_hours": 3.5,
    "evidence_ref": "gps:356938035643809",
    "received_at": "2026-11-11T11:35:00.000Z",
    "actor": "telemetry:sim-gps",
    "supply": {
      "pit_profile_id": "<pit_profiles.id>",
      "material_type_id": "<material_types.id>",
      "quantity": 6,
      "unit": "CUBIC"
    }
  }'`,
  responseSample: `{ "ok": true, "data": { "id": "<resource_transactions.id>" } }`,
  verification: [
    "field ใดหายจากชุดบังคับ → 400 พร้อมรายชื่อ field ที่ขาด",
    "writer ปฏิเสธ (config authority / job / duration / เวลา) → 422",
    "ส่ง source_event_id เดิมซ้ำ → ได้ผล idempotent ไม่สร้างแถวซ้ำ",
    "ประกาศ supply แล้วสต็อกไม่พอ/หน่วยไม่ตรง → 422 STOCK_* และไม่สร้าง resource_transactions",
    "ตรวจว่าไม่มี money field รับจากผู้เรียก",
  ],
  registryRefs: [
    "app/api/internal/connect/resource-transaction/route.ts",
    "engines/canonical/resource-transaction-write.ts",
  ],
};

const materialPrice: EndpointSpec = {
  id: "connect-material-price",
  method: "POST",
  path: "/api/internal/connect/material-price",
  auth: "header x-material-price-internal-secret = MATERIAL_PRICE_INTERNAL_SECRET",
  summary:
    "บันทึก 'ข้อเสนอราคาของผู้ขาย' เป็นหลักฐานเท่านั้น — ไม่เปลี่ยนราคากลางที่ประกาศใช้ (คำสั่งเดียว: price.offer.record)",
  params: [
    rp("x-material-price-internal-secret", "header", "string", true, "secret ของ price bridge"),
    rp("command", "body", "enum", true, "price.offer.record", "price.offer.record"),
    rp("payload.request_id", "body", "string", true, "คำขอราคาที่ผู้ขายตอบกลับ"),
    rp("payload.price", "body", "number", true, "ราคาที่ผู้ขายเสนอ (บาท/หน่วย)", "420"),
    rp("payload.source_message_id", "body", "string", false, "ข้อความต้นทางที่มาของราคา"),
    rp("actor", "body", "string", true, "ผู้บันทึก"),
  ],
  requestSample: `curl -X POST https://<host>/api/internal/connect/material-price \\
  -H "Content-Type: application/json" \\
  -H "x-material-price-internal-secret: $MATERIAL_PRICE_INTERNAL_SECRET" \\
  -d '{
    "command": "price.offer.record",
    "actor": "line:Uxxxxxxxx",
    "payload": {
      "request_id": "<pit_price_requests.id>",
      "price": 420,
      "reply_text": "หินคลุก 420/คิว",
      "source_message_id": "LINE-msg-1"
    }
  }'`,
  responseSample: `{ "ok": true, "data": { "id": "<pit_price_requests.id>" } }`,
  verification: [
    "command อื่นที่ไม่ใช่ price.offer.record → 400 (ไม่มี price.write ตั้งใจ)",
    "request_id หรือ price หาย → 400",
    "writer ปฏิเสธ → 422 และผู้เรียกต้องปล่อยให้มนุษย์ตัดสิน ไม่ retry มั่ว",
    "ตรวจว่าราคากลาง (published price) ไม่เปลี่ยนจากคำขอนี้",
  ],
  registryRefs: [
    "app/api/internal/connect/material-price/route.ts",
    "engines/canonical/material-price-write.ts",
  ],
};

const maintenanceTickets: EndpointSpec = {
  id: "maintenance-tickets",
  method: "GET",
  path: "/api/admin/equipment/maintenance-tickets",
  auth: "Session ระดับ ADMIN_TIER",
  summary:
    "รายการใบงานซ่อมบำรุงพร้อมข้อมูลเครื่องจักรจริง (ชั่วโมงสะสม สถานะ) และธง overdue_locked ที่ล็อกเครื่องเมื่อเลยกำหนด",
  params: [],
  responseSample: `{
  "tickets": [
    {
      "id": "<maintenance_tickets.id>",
      "equipment_id": "<equipment_assets.id>",
      "trigger_hours": 250,
      "status": "open",
      "opened_at": "2026-11-10T02:00:00.000Z",
      "closed_at": null,
      "closed_by": null,
      "overdue_locked": false,
      "overdue_locked_at": null,
      "equipment_assets": {
        "asset_code": "TRK-01",
        "name": "รถบรรทุก 10 ล้อ",
        "total_engine_hours": 251.5,
        "current_status": "RUNNING"
      }
    }
  ]
}`,
  verification: [
    "เรียกด้วย session ที่ไม่ถึง ADMIN_TIER → 401/403 จาก requireAuth",
    "ยืนยันว่า trigger_hours มาจากรอบสะสมจริง ไม่ใช่ค่าว่าง",
    "ใบงานที่เลยกำหนดต้องมี overdue_locked = true และ current_status เปลี่ยนตามนโยบายล็อก",
  ],
  registryRefs: [
    "app/api/admin/equipment/maintenance-tickets/route.ts",
    "app/api/admin/equipment/maintenance-tickets/[id]/close/route.ts",
    "docs/equipment-maintenance-lock-module.md",
  ],
};

const aiGateway: EndpointSpec = {
  id: "ai-gateway",
  method: "POST",
  path: "/api/internal/ai/gateway",
  auth: "header x-dna-os-ai-gateway-secret = AI_GATEWAY_INTERNAL_SECRET และ x-dna-os-ai-origin ต้องตรงกับ request.origin",
  summary:
    "ขอบเขตฝั่ง server เดียวสำหรับผู้เรียก AI ระยะไกล — รับเฉพาะ analysis / classification / draft; การเลือก provider และ credential ไม่เคยออกจาก server",
  params: [
    rp("x-dna-os-ai-gateway-secret", "header", "string", true, "secret ของ gateway (503 ถ้าไม่ตั้ง, 401 ถ้าไม่ตรง)"),
    rp("x-dna-os-ai-origin", "header", "string", true, "ต้องเท่ากับ request.origin ใน body ไม่งั้น 400"),
    rp("request.capability", "body", "string", true, "ความสามารถที่ขอ เช่น analysis / classification / draft"),
    rp("request.sessionId", "body", "string", true, "session ที่ใช้ผูกบริบทและหลักฐาน"),
    rp("request.origin", "body", "enum", true, "ผู้เรียก (edge-function / local-worker ฯลฯ) ต้องตรงกับ header"),
  ],
  requestSample: `curl -X POST https://<host>/api/internal/ai/gateway \\
  -H "Content-Type: application/json" \\
  -H "x-dna-os-ai-gateway-secret: $AI_GATEWAY_INTERNAL_SECRET" \\
  -H "x-dna-os-ai-origin: edge-function" \\
  -d '{
    "request": {
      "origin": "edge-function",
      "capability": "classification",
      "sessionId": "line:Uxxxxxxxx",
      "input": { "text": "ใบเสร็จค่าน้ำมัน 1,850 บาท" }
    }
  }'`,
  responseSample: `{
  "ok": true,
  "request_id": "ai_...",
  "output": { "...": "ผลตาม capability ที่ขอ" }
}`,
  verification: [
    "ไม่ตั้ง AI_GATEWAY_INTERNAL_SECRET → 503",
    "secret ผิด → 401",
    "header origin ไม่ตรงกับ body.request.origin → 400 (กันการยืมบริบทข้ามผู้เรียก)",
    "provider ล้มเหลว → 502 + ok:false พร้อมหลักฐาน dev-loop problem report",
    "ตรวจว่า response ไม่มีชื่อ provider credential หรือคีย์ใด ๆ",
  ],
  registryRefs: [
    "app/api/internal/ai/gateway/route.ts",
    "services/ai/gateway.ts",
    "registry/ai-adapter-registry.json",
  ],
};

const aiAgents: EndpointSpec = {
  id: "ai-agents",
  method: "GET",
  path: "/api/admin/workspace/ai-agents",
  auth: "Session ระดับ ADMIN_TIER",
  summary:
    "แหล่งข้อมูลจริงของเครื่องมือ AI Agents: roster จาก registry + session ที่ยังมีชีวิต + สถานะช่อง Observe/Propose/Execute ของ Integration Gateway",
  params: [],
  responseSample: `{
  "registered_agents": [
    { "id": "claude-code", "vendor": "Anthropic", "role": "development / repair worker" }
  ],
  "static_sessions": [],
  "dev_loop_sessions": [],
  "execute_capability": {
    "status": "NOT_IMPLEMENTED",
    "reason": "Integration Gateway Execution Channel is closed ...",
    "observe_channel_enabled": true,
    "propose_channel_enabled": true,
    "execute_channel_enabled": false
  }
}`,
  verification: [
    "เรียกด้วย session ผู้ใช้ทั่วไป → 401/403",
    "ยืนยันว่า execute_capability.status = NOT_IMPLEMENTED ตาม gate จริง ไม่ใช่ 'success' ปลอม",
    "roster ต้องตรงกับ registry/AI_REGISTRY.json ไม่ใช่รายการที่หน้าเว็บ hardcode",
  ],
  registryRefs: [
    "app/api/admin/workspace/ai-agents/route.ts",
    "registry/AI_REGISTRY.json",
    "registry/AI_SESSIONS.json",
    "engines/integration-gateway/policy/gate.ts",
  ],
};

const mcpManifest: EndpointSpec = {
  id: "mcp-manifest",
  method: "GET",
  path: "/api/v1/mcp/manifest",
  auth: "public (อ่านอย่างเดียว)",
  summary:
    "ดัชนีเครื่องมือ MCP ที่ผูกกับ HTTP endpoint จริง — passthrough จาก registry/mcp-planned-manifest.json และ mcp-resource-registry.json by design",
  params: [],
  responseSample: `{
  "schema_version": "1.0",
  "system": "DNA OS",
  "tools": [
    { "name": "business.dispatch", "endpoint": "/api/v1/mcp/business/dispatch", "status": "active" }
  ],
  "resources": [],
  "meta": { "source_files": ["registry/mcp-planned-manifest.json"] }
}`,
  verification: [
    "เพิ่ม/ถอด tool ต้องแก้ที่ registry ไม่ใช่ที่ route",
    "ยืนยันว่าไม่มี tool ที่ประกาศว่า active แต่ endpoint ตอบ 404",
  ],
  registryRefs: [
    "app/api/v1/mcp/manifest/route.ts",
    "registry/mcp-planned-manifest.json",
    "registry/mcp-resource-registry.json",
  ],
};

const businessDispatch: EndpointSpec = {
  id: "mcp-business-dispatch",
  method: "POST",
  path: "/api/v1/mcp/business/dispatch",
  auth: "Session ระดับ ADMIN_TIER (worker ใช้ session ของ owner ไม่ถือ authority ของตัวเอง)",
  summary:
    "ทางเดียวที่ agent ภายนอกใช้เรียก dispatcher ธุรกิจได้ — รับเฉพาะคำสั่งอ่านใน whitelist; คำสั่งเขียนถูกปฏิเสธ 403 ก่อนถึง engine",
  params: [
    rp("command", "body", "string", true, "คำสั่งอ่านใน READ_COMMANDS เช่น debt.list, job.active, document.preview", "debt.list"),
    rp("payload", "body", "object", false, "พารามิเตอร์ของคำสั่ง", "{}"),
  ],
  requestSample: `curl -X POST https://<host>/api/v1/mcp/business/dispatch \\
  -H "Content-Type: application/json" \\
  --cookie "session=<admin-session>" \\
  -d '{"command":"debt.list","payload":{}}'`,
  responseSample: `{
  "ok": true,
  "command": "debt.list",
  "data": [],
  "violations": []
}`,
  verification: [
    "คำสั่งที่ไม่อยู่ใน whitelist (เช่น debt.create) → 403 COMMAND_NOT_PERMITTED",
    "ไม่มี session → 401 จาก requireAuth",
    "document.preview ที่ไม่มี document_id → 400",
    "dispatcher throw → ok:false + violations ไม่ใช่ 500 เปล่า ๆ",
  ],
  registryRefs: [
    "app/api/v1/mcp/business/dispatch/route.ts",
    "engines/validation/dispatcher.ts",
    "registry/mcp-planned-manifest.json",
  ],
};

const contractorClaim: EndpointSpec = {
  id: "contractor-task-claim",
  method: "POST",
  path: "/api/v1/mcp/contractor/task-claim",
  auth: "API token ที่มี scope governance:propose (กลไก token เดิมของ governance ไม่ใช่ของใหม่)",
  summary:
    "รับงานของ contractor ผ่าน MCP: สร้าง JobContract จากขอบเขตที่ให้มา แล้วเปิด worker job — ขอบเขตเขียนว่าง = read-only ไม่ถูกขยายให้เอง",
  params: [
    rp("ownerId", "body", "string", true, "เจ้าของงาน", "owner@example.com"),
    rp("capabilityRequired", "body", "string", true, "ความสามารถขั้นต่ำของ worker", "code.repair"),
    rp("taskDescription", "body", "string", true, "งานที่ต้องทำ"),
    rp("acceptanceCriteria", "body", "string[]", false, "เกณฑ์ตรวจรับ"),
    rp("permittedReadScope", "body", "string[]", false, "ไฟล์/ข้อมูลที่อ่านได้ (ว่าง = ไม่ได้อ่านเพิ่ม)"),
    rp("permittedWriteScope", "body", "string[]", false, "ไฟล์/ข้อมูลที่เขียนได้ (ว่าง = read-only)"),
  ],
  requestSample: `curl -X POST https://<host>/api/v1/mcp/contractor/task-claim \\
  -H "Content-Type: application/json" \\
  -H "X-DNA-Token: $DNA_OS_API_TOKEN" \\
  -d '{
    "ownerId": "owner@example.com",
    "capabilityRequired": "code.repair",
    "taskDescription": "แก้ validation ของใบงานซ่อม",
    "acceptanceCriteria": ["tsc ผ่าน", "ไม่มี assertion ถูกลด"],
    "permittedReadScope": ["engines/equipment/*"],
    "permittedWriteScope": []
  }'`,
  responseSample: `{
  "ok": true,
  "jobId": "<queue job id>",
  "jobContractId": "<JobContract id>",
  "workerRequest": { "workerRequestId": "<JobContract id>", "privacyLevel": "CLOUD_ALLOWED", "approvalPolicy": "OWNER_APPROVAL_REQUIRED" }
}`,
  verification: [
    "token ไม่มี scope governance:propose → 401/403 จาก authenticate()",
    "ขาด ownerId/capabilityRequired/taskDescription → 400",
    "permittedWriteScope ที่ไม่ส่งมาต้องกลายเป็น [] ไม่ใช่ทั้งระบบ",
    "สถานะ runtime: PAUSED / INCOMPLETE ตาม registry/TASK_QUEUE.json#TASK-082 — ยังไม่เปิดใช้จริงจนกว่าจะมี Owner Settings/Credential surface",
  ],
  registryRefs: [
    "app/api/v1/mcp/contractor/task-claim/route.ts",
    "app/api/admin/ide/_lib/workerTaskOrchestrator.ts",
    "registry/TASK_QUEUE.json",
    "registry/CANONICAL_JOB_CONTRACT.json",
  ],
};

const proposalDecision: EndpointSpec = {
  id: "gateway-proposal-decide",
  method: "POST",
  path: "/api/gateway/proposals/[id]/decide",
  auth: "Session ADMIN_TIER + owner_verification_artifact (Touch ID / device passcode จาก owner-authentication) สำหรับการอนุมัติ",
  summary:
    "ทางเดียวที่เปลี่ยน proposal เป็นการรันจริง และรันได้เฉพาะคำสั่ง automation ที่อยู่ใน whitelist — การอนุมัติต้องมีหลักฐานยืนยันตัวเจ้าของ ไม่ใช่แค่ session แอดมิน",
  params: [
    rp("id", "path", "string", true, "proposal id ที่ยัง pending"),
    rp("decision", "body", "enum", true, "approved | rejected"),
    rp("owner_verification_artifact", "body", "object", true, "หลักฐานจาก owner-authentication (บังคับเฉพาะ approved)"),
  ],
  requestSample: `curl -X POST https://<host>/api/gateway/proposals/<proposal-id>/decide \\
  -H "Content-Type: application/json" \\
  --cookie "session=<admin-session>" \\
  -d '{
    "decision": "approved",
    "owner_verification_artifact": { "...": "single-use challenge result" }
  }'`,
  responseSample: `{
  "ok": true,
  "proposal": { "id": "<proposal-id>", "status": "approved" },
  "run_result": { "exit_code": 0 },
  "release": { "recorded": true }
}`,
  verification: [
    "approved ที่ไม่มี artifact → 403 OWNER_VERIFICATION_REQUIRED และ proposal ยัง pending",
    "artifact ปลอม/หมดอายุ → 403 OWNER_VERIFICATION_FAILED พร้อม code จาก infrastructure",
    "คำสั่งที่หลุด whitelist → 409 และไม่รัน",
    "rejected → บันทึกผลโดยไม่ต้องมี artifact (การปฏิเสธไม่ได้ให้อำนาจ)",
  ],
  registryRefs: [
    "app/api/gateway/proposals/[id]/decide/route.ts",
    "engines/integration-gateway/automationCommands.ts",
    "core/owner-verification-client.ts",
  ],
};

const telegramObserve: EndpointSpec = {
  id: "gateway-observe-telegram",
  method: "POST",
  path: "/api/gateway/observe/telegram",
  auth: "header X-Telegram-Bot-Api-Secret-Token = TELEGRAM_WEBHOOK_SECRET — ไม่ใช้ session; Telegram ส่ง secret ที่ตั้งไว้ตอน setWebhook กลับมาเอง",
  summary:
    "ทางเข้าของ Telegram update เข้า Observe Channel — ตรวจ secret token แล้วแปลเป็น GatewayEvent กลางส่งเข้า event bus ไม่ตอบลูกค้าและไม่เขียนตารางธุรกิจ",
  params: [
    rp("X-Telegram-Bot-Api-Secret-Token", "header", "string", true, "secret ที่ตั้งตอน setWebhook (503 ถ้ายังไม่ตั้งค่า, 401 ถ้าไม่ตรง)"),
    rp("update_id", "body", "number", true, "รหัส update ของ Telegram", "900001"),
    rp("message.message_id", "body", "number", true, "รหัสข้อความ", "12"),
    rp("message.from.id", "body", "number", true, "ผู้ส่ง ใช้ผูกเป็น sender identity", "123456789"),
    rp("message.text", "body", "string", false, "ข้อความ (ถ้าเป็นไฟล์/รูปจะถูกข้ามตาม adapter)"),
  ],
  requestSample: `curl -X POST https://<host>/api/gateway/observe/telegram \\
  -H "Content-Type: application/json" \\
  -H "X-Telegram-Bot-Api-Secret-Token: <telegram-webhook-secret>" \\
  -d '{
    "update_id": 900001,
    "message": {
      "message_id": 12,
      "date": 1794000000,
      "from": { "id": 123456789, "is_bot": false, "first_name": "Somchai" },
      "chat": { "id": 123456789, "type": "private" },
      "text": "ส่งของถึงไหนแล้ว"
    }
  }'`,
  responseSample: `{
  "ok": true,
  "accepted": 1,
  "skipped": 0
}`,
  verification: [
    "ไม่ตั้ง TELEGRAM_WEBHOOK_SECRET → 503 ก่อนอ่าน body",
    "header secret ขาด/ผิด → 401",
    "body ไม่ใช่ JSON → 400",
    "event bus ปฏิเสธ → 500 (Telegram จะ retry; event_id คงที่จึงไม่เก็บซ้ำ)",
    "ตรวจว่า route นี้ไม่ตอบข้อความและไม่เขียนตารางธุรกิจ — Observe เท่านั้น",
  ],
  registryRefs: [
    "app/api/gateway/observe/telegram/route.ts",
    "engines/integration-gateway/adapters/telegram.ts",
    "engines/integration-gateway/event-bus/bus.ts",
  ],
};

const whatsappObserve: EndpointSpec = {
  id: "gateway-observe-whatsapp",
  method: "POST",
  path: "/api/gateway/observe/whatsapp",
  auth: "header X-Hub-Signature-256 = sha256=<hex HMAC-SHA256 ของ raw body ด้วย WHATSAPP_APP_SECRET> — ไม่ใช้ session",
  summary:
    "ทางเข้าของ WhatsApp Business (Cloud API) เข้า Observe Channel — ตรวจลายเซ็นของ Meta แล้วแปลข้อความ/สื่อเป็น GatewayEvent กลาง",
  params: [
    rp("X-Hub-Signature-256", "header", "string (sha256=...)", true, "ลายเซ็น HMAC ของ raw body (503 ถ้ายังไม่ตั้ง secret, 401 ถ้าไม่ตรง)"),
    rp("entry[].changes[].value.metadata.phone_number_id", "body", "string", true, "เบอร์ธุรกิจปลายทาง ใช้เป็น channel identity", "PN1"),
    rp("entry[].changes[].value.messages[].id", "body", "string", true, "รหัสข้อความ ใช้เป็น event id", "wamid.1"),
    rp("entry[].changes[].value.messages[].from", "body", "string", true, "ผู้ส่ง (wa_id)", "1555"),
    rp("entry[].changes[].value.messages[].type", "body", "enum", true, "text | image | document | ...", "text"),
  ],
  requestSample: `curl -X POST https://<host>/api/gateway/observe/whatsapp \\
  -H "Content-Type: application/json" \\
  -H "X-Hub-Signature-256: sha256=<hex-hmac>" \\
  -d '{
    "object": "whatsapp_business_account",
    "entry": [{
      "changes": [{
        "field": "messages",
        "value": {
          "metadata": { "phone_number_id": "PN1" },
          "contacts": [{ "wa_id": "1555", "profile": { "name": "ลูกค้า" } }],
          "messages": [{ "id": "wamid.1", "from": "1555", "timestamp": "1794000000", "type": "text", "text": { "body": "สวัสดี" } }]
        }
      }]
    }]
  }'`,
  responseSample: `{
  "ok": true,
  "accepted": 1,
  "skipped": 0
}`,
  verification: [
    "ไม่ตั้ง WHATSAPP_APP_SECRET → 503",
    "ลายเซ็นไม่ตรงหรือขาด → 401 และไม่ publish",
    "body ไม่ใช่ JSON → 400",
    "status callback ที่ไม่ใช่ข้อความถูกนับใน skipped ไม่กลายเป็น event ธุรกิจ",
  ],
  registryRefs: [
    "app/api/gateway/observe/whatsapp/route.ts",
    "engines/integration-gateway/adapters/whatsapp.ts",
    "engines/integration-gateway/event-bus/bus.ts",
  ],
};

const documentExtract: EndpointSpec = {
  id: "ai-document-extract",
  method: "POST",
  path: "/api/internal/ai/document-extract",
  auth: "header x-dna-os-ai-gateway-secret = AI_GATEWAY_INTERNAL_SECRET และ x-dna-os-ai-origin ต้องตรงกับ body.origin",
  summary:
    "ขอบเขตเดียวสำหรับ OCR สลิป/บิลค่าน้ำมัน/ใบเสร็จ: AI Gateway อ่านภาพแล้วสกัดเป็น JSON ตาม whitelist — ค่าที่ผู้เรียกส่งมาไม่ถูกใช้เป็นผลลัพธ์",
  params: [
    rp("x-dna-os-ai-gateway-secret", "header", "string", true, "secret ของ AI Gateway (503 ถ้าไม่ตั้ง, 401 ถ้าไม่ตรง)"),
    rp("x-dna-os-ai-origin", "header", "string", true, "ต้องเท่ากับ body.origin"),
    rp("origin", "body", "string", true, "ผู้เรียก", "line-webhook-v2"),
    rp("owner_id", "body", "string", true, "เจ้าของบริบท"),
    rp("session_id", "body", "string", true, "session ที่ใช้ผูกหลักฐาน", "line:Uxxxxxxxx"),
    rp("image.base64", "body", "string", true, "ภาพ/PDF เป็น base64"),
    rp("image.media_type", "body", "enum", true, "image/jpeg | image/png | image/gif | image/webp | application/pdf", "image/jpeg"),
    rp("persist.actor", "body", "string", false, "ถ้าจะบันทึกเป็น inbound source ต้องมี actor"),
    rp("persist.channel", "body", "enum", false, "line | upload | email | bank | drive"),
  ],
  requestSample: `curl -X POST https://<host>/api/internal/ai/document-extract \\
  -H "Content-Type: application/json" \\
  -H "x-dna-os-ai-gateway-secret: <ai-gateway-internal-secret>" \\
  -H "x-dna-os-ai-origin: line-webhook-v2" \\
  -d '{
    "origin": "line-webhook-v2",
    "owner_id": "<owner profile id>",
    "session_id": "line:Uxxxxxxxx",
    "image": { "base64": "<base64-image>", "media_type": "image/jpeg" },
    "persist": { "actor": "line:Uxxxxxxxx", "channel": "line" }
  }'`,
  responseSample: `{
  "ok": true,
  "extraction": {
    "document_type": "slip",
    "vendor_name": null,
    "amount": 1850,
    "document_date": "2026-11-11",
    "transaction_datetime": "2026-11-11T08:30:00.000Z",
    "reference_number": null,
    "description": null,
    "confidence": 0.82
  },
  "ocr_text": "...",
  "receipt_document_id": "<receipt_documents.id>",
  "provenance": { "ocr": { "...": "..." }, "extract": { "...": "..." } }
}`,
  verification: [
    "ไม่ตั้ง AI_GATEWAY_INTERNAL_SECRET → 503; secret ผิด → 401",
    "origin/header ไม่ตรง或缺 owner_id/session_id → 400",
    "media_type นอกรายการ → 400",
    "AI Gateway ล้มเหลว/ค่าว่าง/ไม่ใช่ JSON → 502 พร้อม stage ที่ล้ม",
    "persist ไม่ครบหรือ writer ปฏิเสธ → 422 และไม่บันทึกเป็นหลักฐาน",
    "ยืนยันว่าการบันทึกเป็น ai_read / verification_level 1 ไม่ใช่การยืนยันรับเงิน",
  ],
  registryRefs: [
    "app/api/internal/ai/document-extract/route.ts",
    "services/ai/gateway.ts",
    "engines/canonical/inbound-write.ts",
  ],
};

const gatewayExecute: EndpointSpec = {
  id: "gateway-execute",
  method: "POST",
  path: "/api/gateway/execute",
  auth: "Session ADMIN_TIER + owner_verification_artifact จาก owner-authentication และ INTEGRATION_GATEWAY_EXECUTE_ENABLED=true",
  summary:
    "Execution Channel: รันเฉพาะคำสั่งใน AUTOMATION_COMMANDS หลังเจ้าของยืนยันตัวจริง — ไม่มีคำสั่งอิสระ ไม่มี shell string จากผู้เรียก และปิดทันทีเมื่อ env flag ไม่ใช่ true",
  params: [
    rp("command", "body", "enum", true, "คีย์ใน AUTOMATION_COMMANDS (type-check | sync | deploy-gate | architecture-check | guard | dead-code | duplicates | test)", "type-check"),
    rp("owner_verification_artifact", "body", "object", true, "ผลยืนยันตัวเจ้าของจาก infrastructure (Touch ID / device passcode) — session แอดมินอย่างเดียวไม่พอ"),
  ],
  requestSample: `curl -X POST https://<host>/api/gateway/execute \\
  -H "Content-Type: application/json" \\
  --cookie "session=<admin-session>" \\
  -d '{
    "command": "type-check",
    "owner_verification_artifact": { "...": "single-use owner-authentication result" }
  }'`,
  responseSample: `{
  "ok": true,
  "event_id": "EVT-execute-...",
  "command": "type-check",
  "run_result": { "command": "type-check", "exit_code": 0, "output": "...", "duration_ms": 12000 }
}`,
  verification: [
    "INTEGRATION_GATEWAY_EXECUTE_ENABLED ไม่ใช่ 'true' → 503 EXECUTE_CHANNEL_DISABLED ก่อนตรวจ session",
    "ไม่มี session ADMIN_TIER → 401 จาก requireAuth",
    "command ไม่อยู่ใน AUTOMATION_COMMANDS → 403 และไม่รัน",
    "ไม่มี artifact → 403 OWNER_VERIFICATION_REQUIRED",
    "artifact ปลอม/หมดอายุ → 403 ตาม code จาก owner-verification (ไม่กลายเป็น 500)",
    "publish หลักฐานไม่สำเร็จ → 500 และไม่รันคำสั่ง",
  ],
  registryRefs: [
    "app/api/gateway/execute/route.ts",
    "engines/integration-gateway/automationCommands.ts",
    "engines/integration-gateway/event-bus/bus.ts",
    "core/owner-verification-client.ts",
  ],
};

const dailyReconciliation: EndpointSpec = {
  id: "daily-reconciliation",
  method: "GET",
  path: "/api/cron/daily-reconciliation",
  auth: "Authorization: Bearer <CRON_SECRET> (รูปแบบเดียวกับ cron อื่น)",
  summary:
    "สรุปกระทบยอดเงินรายวันตามเวลาไทยจาก payment_allocations + receipt_documents จริง แล้วส่งLineให้ผู้รับที่ตั้งใน app_configs['executive-report'] — วันละครั้งด้วย audit guard",
  params: [],
  responseSample: `{
  "ok": true,
  "date": "2026-11-11",
  "status": "sent",
  "sent": 2,
  "allocated_total": 18500,
  "verified_total": 18500
}`,
  verification: [
    "CRON_SECRET ไม่ตั้งหรือ Authorization ไม่ตรง → 401",
    "ไม่มี app_configs['executive-report'].line_user_ids → 503 EXECUTIVE_REPORT_CONFIG_MISSING (ไม่เดาผู้รับ)",
    "เรียกซ้ำในวันเดียวกัน → { status:'already_sent' } ไม่ส่งซ้ำ",
    "ส่งไม่สำเร็จทุกคน → 502 status:'failed' และยังบันทึก audit ว่า failed",
    "ยอดทั้งหมดมาจาก payment_allocations/receipt_documents ของวันนั้น ไม่ใช่ค่าประมาณ",
  ],
  registryRefs: [
    "app/api/cron/daily-reconciliation/route.ts",
    "registry/communication.ts",
  ],
};

const tripDelivery: EndpointSpec = {
  id: "connect-trip-delivery",
  method: "POST",
  path: "/api/internal/connect/trip-delivery",
  auth: "header x-trip-delivery-internal-secret = TRIP_DELIVERY_INTERNAL_SECRET",
  summary:
    "ปิดเที่ยววิ่งเป็น delivered และตัดสต็อกใน transaction เดียว — arrived เท่านั้น, สต็อกไม่พอ/หน่วยผิด = ปฏิเสธทั้งใบ ไม่มีเที่ยวส่งถึงที่สต็อกไม่ถูกตัด",
  params: [
    rp("x-trip-delivery-internal-secret", "header", "string", true, "secret ของ transport bridge (503/401 แบบ fail-closed)"),
    rp("trip_id", "body", "string (uuid)", true, "public.trips.id ที่อยู่ในสถานะ arrived"),
    rp("actor", "body", "string", true, "ผู้ปิดเที่ยว ใช้บันทึก audit", "dispatch:bridge"),
    rp("material_type_id", "body", "string (uuid)", false, "ระบุเมื่อเที่ยววิ่งยังไม่มี material_type_id"),
    rp("source_event_id", "body", "string", false, "idempotency key (default = trip_id)"),
  ],
  requestSample: `curl -X POST https://<host>/api/internal/connect/trip-delivery \\
  -H "Content-Type: application/json" \\
  -H "x-trip-delivery-internal-secret: <trip-delivery-internal-secret>" \\
  -d '{
    "trip_id": "<trips.id>",
    "material_type_id": "<material_types.id>",
    "actor": "dispatch:bridge"
  }'`,
  responseSample: `{
  "ok": true,
  "data": {
    "trip_id": "<trips.id>",
    "status": "delivered",
    "duplicate": false,
    "movement_id": "<stock_movements.id>",
    "quantity_before": 10,
    "quantity_after": 4
  }
}`,
  verification: [
    "ไม่ตั้ง secret → 503; secret ผิด → 401",
    "ขาด trip_id/actor → 400",
    "สถานะไม่ใช่ arrived → 422 TRIP_STATUS_NOT_ARRIVED และไม่ตัดสต็อก",
    "ไม่มี material_type_id/ pit_profile_id / quantity → 422 และไม่เปลี่ยนสถานะ",
    "สต็อกไม่พอ/หน่วยไม่ตรง → 422 STOCK_* และ rollback ทั้ง transaction",
    "ส่งซ้ำใบเดิม → duplicate:true ไม่ตัดสต็อกรอบสองและไม่แตะสถานะ terminal",
  ],
  registryRefs: [
    "app/api/internal/connect/trip-delivery/route.ts",
    "engines/canonical/trip-delivery-write.ts",
    "supabase/migrations/20261111104000_trip_delivery_stock.sql",
  ],
};

const partnerPortalTokens: EndpointSpec = {
  id: "partner-portal-tokens",
  method: "POST",
  path: "/api/admin/partner-portal/tokens",
  auth: "Session ระดับ ADMIN_TIER",
  summary:
    "ออกลิงก์พอร์ทัลให้คู่ค้ารายเดียว: เก็บเฉพาะ sha256 ของ token, บังคับวันหมดอายุ และ scope จาก closed allow-list — token ดิบเห็นได้ครั้งเดียวใน response นี้ (GET ดู metadata, DELETE เพิกถอน)",
  params: [
    rp("partner_business_profile_id", "body", "string (uuid)", true, "คู่ค้าที่ token นี้ถูกผูกไว้"),
    rp("scopes", "body", "string[]", false, "read | orders:read | debt:read | stock:read | price:propose (ค่าเริ่มต้น read)"),
    rp("expires_in_days", "body", "number", false, "อายุ token (ต้องอยู่ในช่วงที่ service ยอมรับ)", "30"),
    rp("label", "body", "string", false, "ชื่อเรียกเพื่อให้แอดมินจำ", "ลิงก์ประจำปี 2569"),
  ],
  requestSample: `curl -X POST https://<host>/api/admin/partner-portal/tokens \\
  -H "Content-Type: application/json" \\
  --cookie "session=<admin-session>" \\
  -d '{
    "partner_business_profile_id": "<partner_business_profiles.id>",
    "scopes": ["read", "stock:read", "price:propose"],
    "expires_in_days": 30,
    "label": "ลิงก์ประจำปี 2569"
  }'`,
  responseSample: `{
  "ok": true,
  "token": "<raw-token-shown-once>",
  "record": {
    "id": "<partner_portal_tokens.id>",
    "partner_business_profile_id": "<partner_business_profiles.id>",
    "label": "ลิงก์ประจำปี 2569",
    "scopes": ["read", "stock:read", "price:propose"],
    "expires_at": "2026-12-11T00:00:00.000Z",
    "revoked_at": null,
    "created_by": "owner@example.com",
    "last_used_at": null,
    "created_at": "2026-11-11T00:00:00.000Z"
  }
}`,
  verification: [
    "ไม่มี session ADMIN_TIER → 401/403",
    "ไม่มี partner_business_profile_id → 400",
    "scope นอกรายการ → 400 พร้อม rejected + allowed (ไม่ตัดทิ้งเงียบ ๆ)",
    "expires_in_days ไม่ถูกต้อง → 400 จาก service (ไม่มี token ที่ไม่มีวันหมดอายุ)",
    "GET ต้องไม่คืน token ดิบหรือ hash; DELETE ที่ token ถูกเพิกถอนแล้ว → 404",
  ],
  registryRefs: [
    "app/api/admin/partner-portal/tokens/route.ts",
    "services/partner-portal/tokens.ts",
    "supabase/migrations/20261111103000_partner_portal_tokens.sql",
  ],
};

const partnerPortalRead: EndpointSpec = {
  id: "partner-portal-read",
  method: "GET",
  path: "/api/portal/[token]",
  auth: "token ใน path (เทียบ sha256, ต้องไม่หมดอายุ/ไม่ถูกเพิกถอน) — ไม่ใช้ session",
  summary:
    "พอร์ทัลอ่านข้อมูลของคู่ค้ารายเดียว: สต็อก ราคาปัจจุบัน เที่ยววิ่ง ยอดหนี้จาก company_debt_current และข้อเสนอราคา — ทุก query ถูกกรองด้วย partner profile ที่ token ผูกไว้",
  params: [
    rp("token", "path", "string", true, "token ดิบที่ออกให้คู่ค้า (ผิด/หมดอายุ/ถูกเพิกถอน = 401 เหมือนกันทั้งหมด)"),
  ],
  responseSample: `{
  "ok": true,
  "scopes": ["read", "stock:read"],
  "expires_at": "2026-12-11T00:00:00.000Z",
  "profile": {
    "id": "<partner_business_profiles.id>",
    "pit_profile_id": "<pit_profiles.id>",
    "pit_name": "บ่อทรายตัวอย่าง",
    "address": null,
    "phone": null,
    "is_open": true,
    "business_category": "sand_pit",
    "readiness_status": "READY",
    "company_id": null,
    "company_name": null
  },
  "stock": [
    { "material_type_id": "<material_types.id>", "material_name": "หินคลุก", "quantity_available": 4, "unit": "CUBIC", "current_price": 420 }
  ],
  "deliveries": [
    { "id": "<trips.id>", "job_id": null, "status": "delivered", "material_quantity": 6, "material_unit": "CUBIC", "distance_km": 18.5, "dispatch_at": null, "planned_arrival_at": null, "actual_arrival_at": "2026-11-11T09:00:00.000Z" }
  ],
  "debt": null,
  "price_offers": []
}`,
  verification: [
    "token ผิด/หมดอายุ/ถูกเพิกถอน → 401 ด้วย reason เดียวกัน (ไม่บอกว่า token มีอยู่จริงหรือไม่)",
    "profile ที่ถูกเพิกถอน/ไม่พบ → 404 PARTNER_PROFILE_NOT_FOUND",
    "ยืนยันว่า response ไม่มี token hash, secret หรือแถวของคู่ค้ารายอื่น",
    "debt เป็น null เมื่อบ่อไม่ได้ผูก company — ไม่เติมเลข 0 ปลอม",
  ],
  registryRefs: [
    "app/api/portal/[token]/route.ts",
    "services/partner-portal/read.ts",
    "services/partner-portal/tokens.ts",
  ],
};

const partnerPriceOffer: EndpointSpec = {
  id: "partner-portal-price-offer",
  method: "POST",
  path: "/api/portal/[token]/price-offer",
  auth: "token ใน path + scope price:propose",
  summary:
    "ให้คู่ค้า 'เสนอ' ราคาวัสดุที่บ่อของตนขายจริง — บันทึกเป็น offer สถานะ pending เท่านั้น ไม่แตะ pit_materials จนแอดมินอนุมัติ",
  params: [
    rp("token", "path", "string", true, "token ที่มี scope price:propose"),
    rp("material_type_id", "body", "string (uuid)", true, "วัสดุที่ต้องมีอยู่ใน pit_materials ของบ่อนี้"),
    rp("price", "body", "number", true, "ราคาที่เสนอ (มากกว่า 0)", "420"),
    rp("note", "body", "string", false, "หมายเหตุ (ตัดที่ 500 ตัวอักษร)"),
  ],
  requestSample: `curl -X POST https://<host>/api/portal/<raw-token>/price-offer \\
  -H "Content-Type: application/json" \\
  -d '{
    "material_type_id": "<material_types.id>",
    "price": 420,
    "note": "ราคาหน้าบ่อ เดือน พ.ย."
  }'`,
  responseSample: `{
  "ok": true,
  "offer": {
    "id": "<partner_portal_price_offers.id>",
    "status": "pending",
    "proposed_price": 420,
    "created_at": "2026-11-11T00:00:00.000Z"
  }
}`,
  verification: [
    "token ผิด/หมดอายุ → 401; ไม่มี scope price:propose → 403 SCOPE_REQUIRED",
    "material_type_id หายหรือ price <= 0 → 400",
    "วัสดุที่บ่อไม่ได้ขาย → 403 MATERIAL_NOT_SUPPLIED_BY_PARTNER",
    "ยืนยันว่า pit_materials ไม่เปลี่ยนจากคำขอนี้ (ราคากลางยังเป็นของ canonical authority)",
  ],
  registryRefs: [
    "app/api/portal/[token]/price-offer/route.ts",
    "services/partner-portal/tokens.ts",
    "supabase/migrations/20261111103000_partner_portal_tokens.sql",
  ],
};

const partnerPriceDecision: EndpointSpec = {
  id: "partner-price-offer-decision",
  method: "POST",
  path: "/api/admin/partner-portal/price-offers/[offerId]",
  auth: "Session ระดับ ADMIN_TIER + authority context ของผู้ตัดสิน",
  summary:
    "ทางเดียวที่เปลี่ยน offer ของคู่ค้าเป็นราคากลาง — อนุมัติเรียก applyMaterialPrice ด้วย actor/grants จริง; ปฏิเสธแก้เฉพาะสถานะ offer",
  params: [
    rp("offerId", "path", "string (uuid)", true, "ข้อเสนอที่ยัง pending"),
    rp("decision", "body", "enum", true, "approved | rejected"),
  ],
  requestSample: `curl -X POST https://<host>/api/admin/partner-portal/price-offers/<offer-id> \\
  -H "Content-Type: application/json" \\
  --cookie "session=<admin-session>" \\
  -d '{ "decision": "approved" }'`,
  responseSample: `{
  "ok": true,
  "offer": {
    "id": "<partner_portal_price_offers.id>",
    "status": "approved",
    "decided_by": "owner@example.com",
    "decided_at": "2026-11-11T00:00:00.000Z",
    "applied_price_id": "<material_prices.id>"
  },
  "changed": true,
  "revalidated": true
}`,
  verification: [
    "ไม่มี session ADMIN_TIER → 401/403",
    "decision ไม่ใช่ approved/rejected → 400",
    "ไม่พบ offer → 404; offer ถูกตัดสินแล้ว → 409 (ไม่เขียนทับ)",
    "applyMaterialPrice ปฏิเสธสิทธิ์ → 403 PRICE_FORBIDDEN และ offer ยัง pending",
    "เมื่อ approved ต้องมี applied_price_id และราคากลางเปลี่ยนผ่าน canonical writer เท่านั้น",
  ],
  registryRefs: [
    "app/api/admin/partner-portal/price-offers/[offerId]/route.ts",
    "engines/canonical/material-price-write.ts",
    "engines/authority/load.ts",
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// The journey
// ─────────────────────────────────────────────────────────────────────────────

export const STORY_SECTIONS: StorySection[] = [
  {
    id: "overview",
    kicker: "00 · เริ่มตรงนี้",
    title: "ท่อเดียวจากปัญหาธุรกิจ ถึง endpoint จริง",
    titleEn: "One Fabric, Four Real Problems",
    lead: "พอร์ทัลนี้ไม่ใช่คู่มือเมนู — มันเริ่มจากอาการเสียที่เกิดขึ้นจริงในธุรกิจ แล้วเดินไปจนถึงท่อ HTTP ที่ต้องลากสายมาเสียบ ทุก payload ด้านล่างคัดจาก route handler ในเรพอนี้",
    paragraphs: [
      "ระบบภายนอก (LINE, ธนาคาร, กล่อง GPS, คลาวด์) ไม่รู้จักคำว่าใบงาน หนี้ หรือชั่วโมงเครื่อง มันรู้จักแค่ event กับตัวเลขดิบ ดังนั้นทุกจุดเชื่อมจึงต้องมีเกตเวย์ที่ทำสามอย่างเท่านั้น: พิสูจน์ว่าข้อมูลมาจากต้นทางจริง, แปลงเป็นคำสั่งกลาง, และส่งต่อให้เจ้าของความจริงเพียงคนเดียวเป็นคนตัดสิน",
      "DNA OS จึงไม่เปิดให้ใครเขียนฐานข้อมูลตรงจากภายนอก ทุกเส้นที่รับข้อมูลจากข้างนอกวิ่งเข้า canonical writer หรือ dispatcher ฝั่ง server ซึ่งตรวจสิทธิ์ ตรวจรัฐธรรมนูญของระบบ และปฏิเสธแบบ fail-closed เมื่อหลักฐานไม่ครบ",
    ],
    table: {
      columns: ["ชั้น", "ทำอะไร", "ของจริงในเรพอ"],
      rows: [
        ["Edge Gateway", "ตรวจลายเซ็นของผู้ให้บริการก่อนแตะข้อมูล แล้วแปลเป็น event กลาง", "app/api/gateway/observe/{line,telegram,whatsapp,meta,github,vercel,railway}"],
        ["Connect Boundary", "ประตูเดียวที่ provider tier ใช้เขียนความจริงทางธุรกิจ", "app/api/internal/connect/*"],
        ["Canonical Writers", "เจ้าของ state และการเงิน ตัดสินรับ/ปฏิเสธเอง", "engines/canonical/*"],
        ["AI Gateway", "ขอบเขตเดียวของโมเดล — provider และ credential อยู่ฝั่ง server", "POST /api/internal/ai/gateway"],
        ["MCP + Dispatch", "ให้ agent อ่าน registry และสั่งอ่านเฉพาะ whitelist", "/api/v1/mcp/*, /api/v1/query"],
        ["Integration Gateway", "Observe + Propose เปิดจริง; Execute ปิดโดยค่าเริ่มต้น (ต้องเปิดด้วย env + owner proof)", "engines/integration-gateway/policy/gate.ts"],
      ],
    },
    code: {
      language: "text",
      content: `provider event
  → Edge Gateway        พิสูจน์ลายเซ็น + แปลง event
  → Connect Boundary    คำสั่งกลาง (field-by-field)
  → Canonical Writer    ตรวจกฎ + เขียนความจริง + audit
  → public.*            ตารางที่ทุกหน้าจออ่าน

ฝั่งอ่าน/AI
  → /api/v1/query หรือ /api/v1/mcp/business/dispatch
  → engines/validation/dispatcher   registry gate + Rule 72
  → presenter                       ผลที่คำนวณเสร็จแล้วเท่านั้น`,
    },
    bullets: [
      "เรื่อง AWS: เรพอยังไม่มี AWS adapter — คลาวด์ที่ Observe ต่อจริงวันนี้คือ GitHub, Vercel, Railway, Meta และ LINE พอร์ทัลนี้จะไม่วาดกล่อง AWS ปลอมขึ้นมา; เมื่อ adapter จริงถูกเพิ่ม endpoint จะโผล่ที่นี่พร้อมกัน",
      "เกตเวย์ทุกตัวแยก 'หลักฐาน' ออกจาก 'อำนาจ': รับ event ได้ ไม่ได้แปลว่าสั่งงานได้",
      "การเขียนเงินและ state ธุรกิจไม่เคยมีเส้นที่สอง — ถ้า canonical writer ปฏิเสธ ผู้เรียกต้องปล่อยให้มนุษย์ตัดสิน",
    ],
  },
  {
    id: "settings",
    kicker: "01 · ตั้งค่า",
    title: "ก่อนเดินเรื่อง: secret, lifecycle และประตูที่ปิดไว้",
    titleEn: "Settings Before the Story",
    lead: "คู่มือนี้แยกสองชั้นให้ชัด — Settings คือสิ่งที่ต้องตั้งให้ครบก่อนยิงจริง และ Docs คือสัญญา endpoint/payload ที่ต้องเรียก หน้านี้เป็นฝั่ง Docs แต่ทุกหัวข้ออ้างถึง Settings จริงของระบบ ไม่มีหน้าตั้งค่าใหม่ถูกสร้างขึ้นมา และไม่แสดงค่า secret ใด ๆ",
    paragraphs: [
      "Connector ทุกตัวเดินตามลำดับเดียวที่ล็อกไว้ใน registry/connector-lifecycle.json (version 2 · LOCKED) และถูกบังคับด้วย scripts/check-connector-lifecycle.sh ใน pre-commit (Guard 8) ไม่ใช่แค่ธรรมเนียม — ข้าม Test หรือ Enable เมื่อไหร่ เส้น Run จะปฏิเสธทันที",
    ],
    chain: ["Connect", "Register", "Test", "Enable", "Run"],
    table: {
      columns: ["ขั้น", "ทำอะไรจริง", "บังคับด้วย"],
      rows: [
        ["connect", "กรอก config/secret ตามประเภทการเชื่อมต่อ (login / oauth / api_key / token / uri / mcp / webhook)", "app/admin/connectors/page.tsx → POST /api/admin/connectors"],
        ["register", "บันทึกลงตาราง connectors ทันทีที่ Connect สำเร็จ — Dynamic Registry ไม่ต้อง deploy ใหม่", "gateway/connectors.ts · createConnector"],
        ["test", "ยิง network request จริงตาม auth_type ตรวจว่าเชื่อมได้จริง ไม่มี mock/fake", "engines/connectors/tester.ts · testConnector"],
        ["enable", "มนุษย์ต้องกดเปิดเองเสมอ ไม่มี auto-enable แม้ Test ผ่าน; ปฏิเสธถ้า status ไม่ใช่ connected", "gateway/connectors.ts · setConnectorEnabled"],
        ["run", "จุดเดียวที่ AI/API/MCP/Webhook/Plugin/Service เรียก connector จริงได้ — ไม่ผ่าน Test/Enable = ปฏิเสธ", "core/connector-loader.ts · requireConnector"],
      ],
    },
    bullets: [
      "เมื่อ network call ล้ม: status = 'error', enabled = false ในธุรกรรมเดียว, เขียน audit_logs (entity_type='connector') และเห็นสถานะผ่าน GET /api/admin/connectors — ไม่มี auto-enable กลับเอง",
      "webhook connector ที่ไม่ระบุ signature_header ถูกปฏิเสธตั้งแต่ createConnector (SIGNATURE_HEADER_REQUIRED) — ไม่มีแถวที่ตรวจลายเซ็นไม่ได้ค้างอยู่ในระบบ",
      "secret มีหนึ่งดอกต่อ bridge: ไม่ตั้ง = 503, ไม่ตรง = 401 และไม่มีโหมด 'ข้ามการตรวจ'; รายชื่อ header/ตัวแปรอยู่ในหัวข้อ 07 โดยไม่แสดงค่า",
      "provider tier ห้ามเขียนตารางธุรกิจตรง ๆ — ทุกเส้นต้องผ่าน engines/canonical/* writer ซึ่งเป็นเจ้าของ allow-list, สถานะที่อนุญาต และ audit row",
      "Execution Channel ยังปิด (channelIsEnabled('execute') === false): ระบบรายงาน NOT_IMPLEMENTED ไม่ใช่สำเร็จหลอก และการอนุมัติแตะ production ต้องมี owner_verification_artifact",
    ],
  },
  {
    id: "problem-line",
    kicker: "02 · ปัญหา",
    title: "แชทลูกค้าไม่เคยกลายเป็นงาน",
    titleEn: "The Chat That Never Becomes Work",
    lead: "ลูกค้าส่งที่อยู่ รูปสลิป และคำสั่งซื้อเข้ามาทาง LINE — ปลายทางคือแชทที่ไม่มีใครตอบ และข้อมูลที่ต้องคีย์ซ้ำอีกสามระบบ",
    paragraphs: [
      "การต่อ LINE ตรงเข้าฐานข้อมูลคือทางลัดที่พังเร็ว: ไม่มีใครรู้ว่า event ไหนซ้ำ, รูปที่ส่งมาเป็นของงานไหน, และข้อความ 'ส่งเลย' ของใครคนหนึ่งกลายเป็นการเขียนเงินโดยไม่มีหลักฐาน เกตเวย์จึงต้องแยกหน้าที่เป็นสองท่อ — ท่อรับ event ที่ตรวจลายเซ็นแล้ว กับท่อสั่งงานที่ต้องผ่าน canonical writer",
    ],
    chain: [
      "LINE Platform",
      "POST /api/gateway/observe/line",
      "Integration Gateway bus",
      "POST /api/internal/connect/event",
      "public.business_events",
    ],
    bullets: [
      "ลายเซ็นถูกตรวจกับ secret ของ destination นั้น (multi-storefront) ไม่ใช่ secret เดียวของทุกเพจ",
      "Observe Channel ไม่รันคำสั่งใด ๆ — publish ไม่ผ่านเมื่อไหร่ก็ตอบ 500 ไม่ ack ปลอม",
      "ตัวแปลง event สำหรับตอบลูกค้าโดยตรงอยู่ที่ Supabase Edge Function line-webhook-v2 ซึ่งเรียก cognitive pipeline ผ่าน internal bridge ที่มี secret ของตัวเอง",
    ],
    endpoints: [observeLine, telegramObserve, whatsappObserve, connectEvent, reuse("line-webhook", "line-webhook")],
  },
  {
    id: "problem-money",
    kicker: "03 · ปัญหา",
    title: "สลิปโอนเงินไม่เคยกระทบยอด",
    titleEn: "Money That Never Reconciles",
    lead: "เงินเข้าจริง แต่ระบบไม่รู้ว่าเข้าของใบไหน ยอดค้างจึงโตขึ้นเรื่อย ๆ และปิดงบไม่ได้ — ปัญหาไม่ใช่หน้าจอ แต่คือการไม่มีจุดเดียวที่รับผิดชอบตัวเลขเงิน",
    paragraphs: [
      "เกตเวย์เงินจึงห้ามเป็นทางลัดเขียน DB: มันรับ 'ข้อเท็จจริงว่ามีคนจ่าย' แล้วส่งคำสั่งที่ผู้เรียกใส่ยอดเงินเองไม่ได้ ทุกจำนวนอ่านจาก canonical ภายใน และการยืนยันซ้ำต้องคืน already_reconciled แทนการสร้างรายการใหม่",
    ],
    chain: [
      "KBank webhook",
      "kbank_webhook_events (raw)",
      "normalizeKBankWebhook",
      "Observe bus",
      "POST /api/internal/connect/payment-confirm",
      "payment_allocations",
    ],
    table: {
      columns: ["หลักฐาน", "นับเป็นเงินหรือไม่", "ที่มา"],
      rows: [
        ["payment_allocations", "ใช่ — แถวคือความจริง", "canonical payment flow"],
        ["payment_verified (ธง)", "ไม่ — เป็นสถานะ/หลักฐาน", "receipt_documents"],
        ["สลิปที่ยังไม่ยืนยัน", "ไม่ — รายงานแยก", "unverified_transfer_slips"],
        ["company_debt_current", "ยอดค้างจาก ledger ไม่คำนวณซ้ำที่หน้าจอ", "ledger projection"],
      ],
    },
    bullets: [
      "สถานะจริงของ KBank: ยื่นขอ sandbox 26/10/2026 เลขคำขอ 1792988917 และยังรอเจ้าหน้าที่ตรวจ — route นี้จึงยังเป็น skeleton แบบ mock-mode ไม่ควรใช้กับเงินจริง",
      "ผู้เรียกส่งได้แค่ receipt_document_id + actor; ไม่มีช่องให้ใส่ amount หรือ outstanding",
      "เงินออกมีเส้นเดียวคือ /api/internal/connect/expense และคำขอจ่ายทุกใบเริ่มที่ pending เสมอ",
    ],
    endpoints: [kbankWebhook, paymentConfirm, connectExpense, dailyReconciliation, partnerPriceDecision, reuse("query-endpoint", "query")],
  },
  {
    id: "problem-logistics",
    kicker: "04 · ปัญหา",
    title: "ชั่วโมงเครื่องกับเที่ยววิ่ง เป็นตัวเลขที่ไม่มีใครรู้",
    titleEn: "The Fleet That Reports Nothing",
    lead: "ค่าเที่ยว ค่าน้ำมัน และค่าสึกหรอ คำนวณจากตัวเลขที่ไม่มีใครเก็บ — เกตเวย์ฮาร์ดแวร์ต้องเป็นคนเดียวที่ตัดสินว่า 'เครื่องติดอยู่'",
    paragraphs: [
      "สัญญาณ VCC จากกล่อง GPS เป็นข้อมูลเดียวที่โกหกยาก แต่ละผู้ให้บริการกล่องส่งรูปแบบไม่เหมือนกัน จึงเก็บจุดตัดสินใจไว้ที่เดียว: ≥ 13.5V = engine_running แล้วให้ทุกช่องทางส่งเข้า shape กลางเดียวกัน ไม่แยกเส้นเขียน DB ต่อผู้ให้บริการ",
    ],
    chain: [
      "GPS / relay box",
      "POST /api/internal/equipment/telemetry",
      "equipment_telemetry_pings",
      "accumulateEngineHours",
      "POST /api/internal/connect/resource-transaction",
      "public.resource_transactions",
    ],
    bullets: [
      "imei ที่ไม่รู้จัก → 404 ไม่สร้างเครื่องให้เอง",
      "ping ที่ขาดช่วงถูก cap ตามกติกาของ accumulateEngineHours ไม่ปล่อยให้ชั่วโมงพอง",
      "ราคาที่ผู้ขายเสนอเป็นได้แค่ 'ข้อเสนอ' (price.offer.record) — ไม่แตะราคากลาง",
    ],
    endpoints: [equipmentTelemetry, resourceTransaction, tripDelivery, materialPrice, partnerPortalTokens, partnerPortalRead, partnerPriceOffer],
  },
  {
    id: "problem-maintenance",
    kicker: "05 · ปัญหา",
    title: "ซ่อมบำรุงตามปฏิทิน ทั้งที่ของจริงนับชั่วโมง",
    titleEn: "Maintenance by Guesswork",
    lead: "รอบซ่อมที่เขียนไว้บนกระดาษไม่ตรงกับเครื่องที่เดินจริง — เมื่อชั่วโมงสะสมกลายเป็นข้อมูลจริง ใบงานซ่อมจึงเกิดที่ 250 ชม. และล็อกเครื่องได้เมื่อเลยกำหนด",
    paragraphs: [
      "ไม่มีหน้าใหม่แยกออกมา: ใบงานซ่อมอ่านจากตาราง maintenance_tickets ที่ผูกกับ equipment_assets โดยตรง และชั่วโมงสะสมถูกป้อนจาก telemetry เส้นเดียวกับข้อ 03 — ตัวเลขจึงตรงกันทั้งหน้าซ่อมและหน้าเดินรถ",
    ],
    chain: [
      "telemetry ping (VCC)",
      "accumulateEngineHours",
      "equipment_assets.total_engine_hours",
      "maintenance_tickets @ 250h",
      "GET /api/admin/equipment/maintenance-tickets",
    ],
    bullets: [
      "trigger_hours บันทึก ณ ตอนเปิดใบงาน ไม่ใช่คำนวณย้อนหลังที่หน้าจอ",
      "overdue_locked / overdue_locked_at คือหลักฐานการล็อก ไม่ใช่แค่สีเตือน",
      "การปิดใบงานมี route เฉพาะ ([id]/close) เพื่อให้มีผู้ปิดและเวลาปิดจริง",
    ],
    endpoints: [maintenanceTickets, equipmentTelemetry],
  },
  {
    id: "agents",
    kicker: "06 · สถาปัตยกรรม",
    title: "Multi-Agent Routing & Handoff — หลายตัว แต่ประตูเดียว",
    titleEn: "Many Agents, One Authority",
    lead: "เอเจนต์หลายตัวทำงานคนละช่วง (เข้าใจปัญหา → วิเคราะห์ → ลงมือ → ตรวจรับ) แต่ไม่มีตัวไหนถือสิทธิ์ของตัวเอง ทุกตัวยืมบริบทจากประตูกลางและถูกบันทึกเป็นหลักฐาน",
    paragraphs: [
      "การ route ไม่ได้เกิดจากชื่อโมเดล แต่เกิดจากความสามารถที่ขอ: คำขอบทสนทนาเดินผ่าน cognitive pipeline, งานวิเคราะห์/จำแนก/ร่างเดินผ่าน AI Gateway ที่เลือก provider ฝั่ง server, งานอ่านข้อมูลเดินผ่าน dispatch ที่มี whitelist และงานภายนอกที่ต้องลงมือทำจริงต้องรับ JobContract พร้อมขอบเขตอ่าน/เขียนที่ระบุชัด",
      "Handoff จึงเป็นการส่ง 'สัญญางาน' ไม่ใช่การส่ง 'สิทธิ์': contractor ได้ JobContract + WorkerRequest ที่มี permittedReadScope/permittedWriteScope และ approvalPolicy ติดไปด้วย ส่วนการอนุมัติที่แตะ production ยังต้องมีหลักฐานยืนยันตัวเจ้าของ (Touch ID / device passcode) ไม่ใช่แค่ session แอดมิน",
    ],
    table: {
      columns: ["ช่วงของงาน", "ใครทำ", "ประตูที่ใช้", "เพดานอำนาจ"],
      rows: [
        ["เข้าใจ + ตอบลูกค้า", "cognitive pipeline", "runCognitivePipeline (LINE bridge)", "ไม่เขียนเงิน; Rule 72 ยังบังคับ"],
        ["วิเคราะห์ / จำแนก / ร่าง", "AI adapter ตาม registry", "POST /api/internal/ai/gateway", "provider + credential อยู่ฝั่ง server"],
        ["อ่านข้อมูลธุรกิจ", "agent ภายนอก / MCP", "POST /api/v1/mcp/business/dispatch", "เฉพาะคำสั่งอ่านใน whitelist"],
        ["ลงมือแก้โค้ด", "coding agent (Claude Code, Gemini CLI, Codex, Cline …)", "MCP registry.* / architecture.* / runtime.query", "scope ต่อ job ตาม CANONICAL_JOB_CONTRACT"],
        ["รับงานภายนอก", "contractor worker", "POST /api/v1/mcp/contractor/task-claim", "ขอบเขตเขียนว่าง = read-only; runtime ยัง PAUSED"],
        ["อนุมัติแตะ production", "เจ้าของเท่านั้น", "POST /api/gateway/proposals/[id]/decide", "ต้องมี owner_verification_artifact"],
      ],
    },
    bullets: [
      "Execution Channel ปิดโดยค่าเริ่มต้น — เปิดเฉพาะเมื่อ INTEGRATION_GATEWAY_EXECUTE_ENABLED=true และทุกคำสั่งต้องมี owner_verification_artifact; ไม่มีคำสั่งนอก whitelist",
      "contractor intake ยัง PAUSED / INCOMPLETE ตาม registry/TASK_QUEUE.json#TASK-082 จนกว่าจะมี Owner Settings / Credential Authorization surface",
      "AI ทุกตัวที่เป็น DNA OS Compatible ต้องอ่าน registry, ทำตาม Constitution, เขียน CHANGELOG, อัปเดต CURRENT_STATE, รับ Handoff และผ่าน Validation",
    ],
    endpoints: [aiGateway, aiAgents, documentExtract, gatewayExecute, mcpManifest, businessDispatch, contractorClaim, proposalDecision],
  },
  {
    id: "connect",
    kicker: "07 · ลากสาย",
    title: "Token, secret และรหัสที่ต้องเจอ",
    titleEn: "Wiring Checklist",
    lead: "ทุกเส้นใช้ secret คนละดอกและ fail-closed คนละแบบ — ตารางนี้บอกชื่อ header กับชื่อตัวแปรให้ตรงก่อนเริ่มยิงจริง (ไม่แสดงค่าใด ๆ)",
    table: {
      columns: ["เส้นทาง", "Header", "ตัวแปรสภาพแวดล้อม", "เมื่อไม่ผ่าน"],
      rows: [
        ["POST /api/v1/query", "X-DNA-Token", "— (ออก token ที่ /admin/api-tokens)", "401 / 403"],
        ["POST /api/gateway/observe/line", "x-line-signature", "LINE_CHANNEL_SECRET หรือ secret ต่อ destination", "503 / 401 / 400"],
        ["POST /api/internal/connect/event", "x-connect-internal-secret", "CONNECT_INTERNAL_SECRET", "503 / 401 / 422"],
        ["POST /api/internal/connect/payment-confirm", "x-payment-confirm-internal-secret", "PAYMENT_CONFIRM_INTERNAL_SECRET", "503 / 401 / 422"],
        ["POST /api/internal/connect/expense", "x-expense-internal-secret", "EXPENSE_INTERNAL_SECRET", "503 / 401 / 422"],
        ["POST /api/internal/connect/material-price", "x-material-price-internal-secret", "MATERIAL_PRICE_INTERNAL_SECRET", "503 / 401 / 422"],
        ["POST /api/internal/connect/resource-transaction", "x-resource-transaction-internal-secret", "RESOURCE_TRANSACTION_INTERNAL_SECRET", "503 / 401 / 422"],
        ["POST /api/internal/connect/trip-delivery", "x-trip-delivery-internal-secret", "TRIP_DELIVERY_INTERNAL_SECRET", "503 / 401 / 422"],
        ["POST /api/gateway/observe/telegram", "X-Telegram-Bot-Api-Secret-Token", "TELEGRAM_WEBHOOK_SECRET", "503 / 401 / 400"],
        ["POST /api/gateway/observe/whatsapp", "X-Hub-Signature-256", "WHATSAPP_APP_SECRET", "503 / 401 / 400"],
        ["POST /api/gateway/execute", "session ADMIN_TIER + owner_verification_artifact", "INTEGRATION_GATEWAY_EXECUTE_ENABLED=true", "503 / 401 / 403"],
        ["GET /api/cron/daily-reconciliation", "Authorization: Bearer", "CRON_SECRET", "401 / 503 / 502"],
        ["POST /api/internal/equipment/telemetry", "x-equipment-telemetry-secret", "EQUIPMENT_TELEMETRY_SECRET", "500 (ยังไม่ตั้ง) / 401"],
        ["POST /api/internal/line/command", "x-line-command-internal-secret", "LINE_COMMAND_INTERNAL_SECRET", "401 / 400"],
        ["POST /api/internal/ai/gateway", "x-dna-os-ai-gateway-secret + x-dna-os-ai-origin", "AI_GATEWAY_INTERNAL_SECRET", "503 / 401 / 400"],
        ["POST /api/gateway/observe/vercel", "x-vercel-signature", "VERCEL_WEBHOOK_SECRET", "503 / 401"],
      ],
    },
    code: {
      language: "bash",
      content: `# 1) ออก token สำหรับ client ภายนอก (ต้องมี session แอดมิน)
curl -X POST https://<host>/api/admin/api-tokens \\
  -H "Content-Type: application/json" \\
  --cookie "session=<admin-session>" \\
  -d '{"label":"partner-runtime","scopes":["read"]}'

# 2) ใช้ token นั้นเรียกคำสั่งอ่าน
curl -X POST https://<host>/api/v1/query \\
  -H "Content-Type: application/json" \\
  -H "X-DNA-Token: $DNA_OS_API_TOKEN" \\
  -d '{"command":"debt.list","args":{}}'

# 3) ฝั่ง server-to-server ใช้ secret ของ bridge นั้น ๆ
#    (ค่าจริงอยู่ใน .env.local / environment ของแพลตฟอร์มเท่านั้น)`,
    },
    bullets: [
      "ห้ามเอา token หรือ secret ไปฝังใน client/Mini App — ให้ proxy ผ่าน route handler ของคุณ",
      "token ถูกประเมิน role ใหม่ทุกคำขอ; หลุดจาก admin tier = ใช้ไม่ได้ทันที",
      "ทุก bridge คืน 503 เมื่อยังไม่ตั้ง secret และ 401 เมื่อ secret ไม่ตรง — ไม่มีโหมด 'ข้ามการตรวจ'",
      "migration 20261111100000–20261111104000 APPLIED 2026-11-11 แล้ว — ตรวจหลัง apply: 4 ตารางใหม่ + 2 RPC (service_role เท่านั้น) + RLS ทุกตาราง + RULE_MAINTENANCE_DUE; ค่า secret ยังต้องตั้งใน environment ก่อนยิงจริง",
    ],
    endpoints: [reuse("api-tokens", "create-token"), reuse("api-tokens", "list-tokens"), reuse("query-endpoint", "query")],
  },
  {
    id: "index",
    kicker: "08 · ดัชนี",
    title: "Endpoint ทั้งหมดที่พอร์ทัลนี้อ้างถึง",
    titleEn: "Complete Endpoint Index",
    lead: "รวม endpoint จากสเปกอ้างอิงและจากเรื่องเล่าข้างบน โดยตัดรายการซ้ำตาม method + path — ใช้เป็น checklist ตอนต่อระบบจริง",
    bullets: [
      "endpoint ที่ต้องมี session แอดมินไม่ใช่ API สำหรับพาร์ทเนอร์ — ต้องเรียกผ่าน proxy ของคุณ",
      "เส้นที่ยังไม่เปิดใช้งานจริง (KBank sandbox, contractor intake, execute channel) ระบุสถานะไว้ในหัวข้อของมันแล้ว",
    ],
    endpoints: [],
  },
];

/** Every endpoint referenced by the journey, deduplicated by method + path. */
export const STORY_ENDPOINTS: EndpointSpec[] = (() => {
  const seen = new Set<string>();
  const unique: EndpointSpec[] = [];
  for (const endpoint of STORY_SECTIONS.flatMap((section) => section.endpoints ?? [])) {
    const key = `${endpoint.method} ${endpoint.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(endpoint);
  }
  return unique;
})();

/** Settings vs Docs: what must be configured, what is merely documented. */
export type SectionKind = "settings" | "journey" | "reference";

export const SECTION_KINDS: Record<string, SectionKind> = {
  overview: "journey",
  settings: "settings",
  "problem-line": "journey",
  "problem-money": "journey",
  "problem-logistics": "journey",
  "problem-maintenance": "journey",
  agents: "journey",
  connect: "reference",
  index: "reference",
};

export const STORY_NAV = STORY_SECTIONS.map((section) => ({
  id: section.id,
  kicker: section.kicker,
  title: section.title,
  kind: SECTION_KINDS[section.id] ?? "journey",
}));

// ─────────────────────────────────────────────────────────────────────────────
// End-to-end flow traces
//
// One entry per real pipe: what triggers it, which gate can refuse it (and with
// which status/code), where it is normalized, and which canonical writer is the
// only allowed mutation path. Every `evidence` string is a real file (and, where
// useful, the function) in this repository.
// ─────────────────────────────────────────────────────────────────────────────

export interface PipelineStage {
  label: string;
  detail: string;
  /** Real file · function that implements this stage. */
  evidence: string;
  /** Fail-closed outcome at this stage, if it can refuse. */
  refuses?: string;
}

export interface FlowPipeline {
  id: string;
  sectionId: string;
  title: string;
  titleEn: string;
  summary: string;
  stages: PipelineStage[];
}

export const FLOW_PIPELINES: FlowPipeline[] = [
  {
    id: "line-ingress",
    sectionId: "problem-line",
    title: "LINE → GatewayEvent → canonical evidence log",
    titleEn: "Inbound LINE Observe",
    summary:
      "จุดเดียวที่อ่าน payload ดิบของ LINE คือ adapter; ปลายทางเป็น event กลางที่ทุก engine ใช้ร่วมกัน ไม่มีตารางธุรกิจถูกแตะในเส้นนี้",
    stages: [
      {
        label: "Trigger — LINE ยิง event เข้ามา",
        detail:
          "LINE ส่ง POST /api/gateway/observe/line พร้อม destination + events[] โดยไม่มี session; route อ่าน body เท่านั้นเพื่อรู้ว่ามาจากบัญชีไหน ยังไม่แตะฐานข้อมูล",
        evidence: "app/api/gateway/observe/line/route.ts · POST",
      },
      {
        label: "Gate — เลือก secret ของบัญชีปลายทาง",
        detail:
          "destination ถูกใช้ resolve channel secret จาก public.connect_external_account_credentials; ถ้าไม่พบจึงถอยไปใช้ LINE_CHANNEL_SECRET ของบัญชีหลัก",
        evidence: "engines/connect/accounts.ts · resolveExternalAccountCredential",
        refuses: "ไม่มี secret เลย → 503",
      },
      {
        label: "Gate — ตรวจลายเซ็นก่อนอ่าน/เขียนใด ๆ",
        detail:
          "HMAC-SHA256 ของ raw body เข้ารหัส base64 แล้วเทียบ x-line-signature ด้วย timingSafeEqual — body ที่ยังไม่ผ่านไม่ถูกตีความต่อ",
        evidence: "engines/integration-gateway/adapters/line.ts · verifyLineSignature",
        refuses: "ลายเซ็นผิด/หาย → 401 · JSON เสีย → 400",
      },
      {
        label: "Normalize — LINE event → GatewayEvent",
        detail:
          "แต่ละ event แปลเป็น capability กลาง (message / document / location / identity signal / interaction) และ evidence ถูกจำกัดด้วย key whitelist 9 คีย์ — ข้อความลูกค้าและ reply token ไม่มีช่องเดินทางเข้า core",
        evidence: "engines/integration-gateway/adapters/line.ts · normalizeLineWebhook / EVIDENCE_KEYS",
        refuses: "ชนิด event ที่ยังไม่รองรับ → นับ skipped ไม่แต่ง capability ขึ้นเอง",
      },
      {
        label: "Gate + Bus — สัญญาและช่องทาง",
        detail:
          "publish() ตรวจ isGatewayEvent ก่อน แล้วตรวจ channelIsEnabled (observe/propose เท่านั้น) จากนั้น dispatchEvent('gateway.<capability>') และเขียน integration_gateway_events; ช่อง propose มีแถว proposal รอเจ้าของตัดสิน",
        evidence: "engines/integration-gateway/event-bus/bus.ts · publish · policy/gate.ts",
        refuses: "สัญญาไม่ครบ/ช่องปิด → ok:false แล้ว route ตอบ 500",
      },
      {
        label: "Ack — เฉพาะเมื่อเขียนสำเร็จ",
        detail: "ตอบ { ok, accepted, skipped } หลังทุก event ผ่าน bus เท่านั้น ไม่ ack ล่วงหน้า",
        evidence: "app/api/gateway/observe/line/route.ts · NextResponse.json",
      },
    ],
  },
  {
    id: "kbank-ingest",
    sectionId: "problem-money",
    title: "KBank webhook → staging → Observe",
    titleEn: "Bank Inbound Ingest",
    summary:
      "เส้นนี้ยังเป็น mock-mode เพราะยังไม่ได้ secret จาก KBank (ยื่น 26/10/2026 เลขคำขอ 1792988917) แต่ประตูความปลอดภัยถูกใช้ตัวเดียวกับ connector webhook จริงแล้ว",
    stages: [
      {
        label: "Trigger — ธนาคารยิง webhook",
        detail:
          "POST /api/connectors/webhook/kbank รับเฉพาะ body ที่ผ่าน gate; ระหว่างรอ sandbox ยังไม่มี secret จริง จึงยังไม่มีการรับ event จากธนาคารได้",
        evidence: "app/api/connectors/webhook/kbank/route.ts",
      },
      {
        label: "Gate — สถานะ connector",
        detail:
          "getConnectedConnector ต้องได้ connector ที่ status = 'connected' และ enabled = true เท่านั้น; connector ที่ปิดหรือ error หยุดรับทันทีโดยไม่ต้อง deploy",
        evidence: "core/connector-loader.ts · getConnectedConnector",
        refuses: "404 connector_not_found / connector_not_enabled",
      },
      {
        label: "Gate — ขนาด body",
        detail: "ปฏิเสธก่อน buffer เมื่อ content-length หรือ byte จริงเกิน 64KB",
        evidence: "app/api/connectors/webhook/[slug]/_lib/webhookGate.ts · MAX_WEBHOOK_BODY_BYTES",
        refuses: "413 body_too_large",
      },
      {
        label: "Gate — ลายเซ็น (fail-closed สองชั้น)",
        detail:
          "ถ้า connector ไม่ได้ตั้ง signature_header หรือ signing_secret ระบบปฏิเสธ (ไม่ใช่ข้ามการตรวจ); เมื่อตั้งแล้วต้องมี header และ HMAC ต้องตรง timingSafeEqual ก่อน parse body",
        evidence: "app/api/connectors/webhook/[slug]/_lib/webhookGate.ts · evaluateWebhookRequest",
        refuses: "503 signature_not_configured · 401 signature_missing / signature_invalid",
      },
      {
        label: "Staging — เก็บ raw ก่อนแปล",
        detail:
          "เขียน kbank_webhook_events (raw_body + allow-listed headers, status 'received') ก่อน normalize เพื่อให้ reconcile/payout มีหลักฐานระดับไบต์ ไม่ใช่แค่ evidence ที่แปลงแล้ว",
        evidence: "app/api/connectors/webhook/kbank/route.ts · PHASE 1 (kbank_webhook_events insert)",
        refuses: "เขียน staging ไม่ได้ → 500 ไม่ ack body ที่ผ่านลายเซ็นแล้ว",
      },
      {
        label: "Normalize + Publish",
        detail:
          "normalizeKBankWebhook แปลงเป็น capability กลาง payment.* / payout.* / transfer.* แล้ว publish เข้า Observe Channel",
        evidence: "engines/integration-gateway/adapters/kbank.ts · normalizeKBankWebhook",
        refuses: "ไม่มี event ที่แปลงได้ → 400 · publish ล้ม → 500",
      },
      {
        label: "Ack — { received: true, published }",
        detail: "ตอบหลัง publish สำเร็จทุก event เท่านั้น; ไม่มี published ก็ไม่ตอบว่ารับแล้ว",
        evidence: "app/api/connectors/webhook/kbank/route.ts · NextResponse.json",
      },
    ],
  },
  {
    id: "connect-event",
    sectionId: "problem-line",
    title: "GatewayEvent → Connect → canonical business event",
    titleEn: "Business Event Bridge",
    summary:
      "Transport ฝั่ง provider ส่ง 'คำสั่ง' ไม่ใช่ 'แถวข้อมูล' — writer เป็นเจ้าของทุกคอลัมน์ที่เปลี่ยนได้",
    stages: [
      {
        label: "Trigger — transport ส่ง canonical command",
        detail:
          "POST /api/internal/connect/event รับเฉพาะคำสั่งที่ normalize แล้ว (ไม่มี payload ของ LINE ติดมา, ไม่มีการ branch ตาม provider)",
        evidence: "app/api/internal/connect/event/route.ts",
      },
      {
        label: "Gate — secret ของ bridge",
        detail: "header x-connect-internal-secret ต้องตรงกับ CONNECT_INTERNAL_SECRET",
        evidence: "app/api/internal/connect/event/route.ts · process.env.CONNECT_INTERNAL_SECRET",
        refuses: "ไม่ตั้ง secret → 503 · ไม่ตรง → 401",
      },
      {
        label: "Gate — คำสั่งปิด + actor",
        detail:
          "รับ 4 คำสั่งเท่านั้น: business_event.create / .transition / .enrich / .link_transaction และต้องมี actor ทุกครั้ง",
        evidence: "app/api/internal/connect/event/route.ts · COMMANDS",
        refuses: "คำสั่งนอกชุด/ไม่มี actor → 400",
      },
      {
        label: "Write — canonical event writer เท่านั้น",
        detail:
          "createBusinessEvent / transitionBusinessEvent / enrichBusinessEvent / linkBusinessEventTransaction เป็นเจ้าของ allow-list ของ field และชุดสถานะ; ผู้เรียกส่ง row shape เข้ามาไม่ได้",
        evidence: "engines/canonical/event-write.ts",
        refuses: "422 EVENT_UNKNOWN_STATE / EVENT_TRANSITION_REFUSED / EVENT_FIELD_NOT_ALLOWED",
      },
      {
        label: "Audit — metadata ที่บอกที่มา",
        detail:
          "ทุกแถวที่สร้างพก written_by = canonical:event-write@<actor> และ source_provider ไว้ใน metadata เพื่อตรวจย้อนได้โดยไม่ต้องเดา",
        evidence: "engines/canonical/event-write.ts · createBusinessEvent",
      },
    ],
  },
  {
    id: "payment-confirm",
    sectionId: "problem-money",
    title: "สลิป → canonical payment (guards → RPC เดียว)",
    titleEn: "Money In",
    summary:
      "ผู้เรียกบอกได้แค่ว่า 'สลิปใบไหน' — ตัวเลขเงินทุกตัวอ่านจาก canonical ข้างในและ commit ใน transaction เดียว",
    stages: [
      {
        label: "Trigger — transport แจ้งว่าพบหลักฐานการจ่าย",
        detail:
          "POST /api/internal/connect/payment-confirm รับเฉพาะ receipt_document_id + actor; ไม่รับ amount/outstanding เพราะผู้เรียกใส่ตัวเลขเงินเองไม่ได้",
        evidence: "app/api/internal/connect/payment-confirm/route.ts",
      },
      {
        label: "Gate — secret ของ bridge",
        detail: "header x-payment-confirm-internal-secret เทียบ PAYMENT_CONFIRM_INTERNAL_SECRET",
        evidence: "app/api/internal/connect/payment-confirm/route.ts · process.env.PAYMENT_CONFIRM_INTERNAL_SECRET",
        refuses: "ไม่ตั้ง → 503 · ไม่ตรง → 401 · body ผิดรูป → 400",
      },
      {
        label: "Flow + guards — ตรวจก่อนแตะเงิน",
        detail:
          "confirmReceiptPayment → confirmPayment: receipt ต้องเป็น transfer_slip/payment_advice, ต้องยังไม่ถูกจัดสรร, Σ allocation ≤ ยอด receipt, invoice ต้องไม่ VOID บริษัทตรง และไม่เกินยอดคงค้าง",
        evidence: "engines/canonical/receipt-confirm-flow.ts · engines/canonical/payment-write.ts",
        refuses: "throw เป็นรหัส PAYMENT_* (เช่น PAYMENT_OVERPAYMENT_NOT_ALLOWED, PAYMENT_ALREADY_ALLOCATED)",
      },
      {
        label: "Commit — RPC เดียว ไม่มี fallback",
        detail:
          "confirm_payment_allocation เขียน allocations + ledger + invoice projection + receipt state + snapshot + audit ใน transaction เดียว; writer ไม่เขียนแถวเงินเองเลย และไม่มีเส้นสำรอง",
        evidence: "engines/canonical/payment-write.ts · confirmPayment → db.rpc('confirm_payment_allocation')",
        refuses: "RPC หาย/ปฏิเสธ → fail closed (mapPaymentRpcError)",
      },
      {
        label: "Ack — ผลจริง ไม่ใช่ผลที่หวัง",
        detail:
          "ตอบ 200 { already_reconciled, new_outstanding, debt_event_id, acknowledgement }; acknowledgement เป็นส่วนเสริมและล้มได้โดยไม่ทำให้การยืนยันเงินล้ม",
        evidence: "app/api/internal/connect/payment-confirm/route.ts · acknowledgePayment",
      },
    ],
  },
  {
    id: "expense-payable",
    sectionId: "problem-money",
    title: "เงินออก → canonical expense / payable",
    titleEn: "Money Out",
    summary:
      "ไม่มี approval ใหม่ถูกสร้างที่ bridge: คำขอเริ่ม pending เสมอ และการขยับสถานะถูกกรองด้วยสถานะต้นทางจริง",
    stages: [
      {
        label: "Trigger — transport แจ้งค่าใช้จ่าย/คำขอจ่าย",
        detail:
          "POST /api/internal/connect/expense รับ 3 คำสั่ง: expense.record, payable.request, payable.transition",
        evidence: "app/api/internal/connect/expense/route.ts · COMMANDS",
      },
      {
        label: "Gate — secret ของ bridge",
        detail: "header x-expense-internal-secret เทียบ EXPENSE_INTERNAL_SECRET",
        evidence: "app/api/internal/connect/expense/route.ts",
        refuses: "ไม่ตั้ง → 503 · ไม่ตรง → 401",
      },
      {
        label: "Write — writer ตัดสิน ไม่ใช่ผู้เรียก",
        detail:
          "recordCompanyExpense ตรวจ source (line_chat / subscription_email_sync / admin_manual) และ amount > 0; requestPartnerPayable ตั้ง status 'pending' เอง; transitionPartnerPayable อัปเดตแบบกรองสถานะต้นทาง",
        evidence: "engines/canonical/expense-write.ts",
        refuses: "0 แถวถูกอัปเดต → PAYABLE_TRANSITION_INVALID · 422 EXPENSE_* / PAYABLE_*",
      },
      {
        label: "Policy — เวลาเสร็จมาจากหลักฐาน",
        detail:
          "completed_at ถูก derive จาก bank_email_verified เท่านั้น — ผู้เรียกตั้งเวลาเสร็จเองไม่ได้",
        evidence: "engines/canonical/expense-write.ts · transitionPartnerPayable",
      },
      {
        label: "Audit — ทุกแถวเงินออกมีร่องรอย",
        detail: "recordCanonicalAudit เขียน expense.recorded / payable.requested / payable.transitioned ทุกครั้ง",
        evidence: "engines/canonical/audit.ts · recordCanonicalAudit",
      },
    ],
  },
  {
    id: "telemetry-hours",
    sectionId: "problem-logistics",
    title: "VCC → engine hours → total_engine_hours",
    titleEn: "Telemetry to Engine Hours",
    summary:
      "ชั่วโมงเครื่องไม่ได้มาจากการเดา แต่มาจาก ping สองตัวที่บอกว่าเครื่องติดทั้งคู่ — ค่าที่ cap ได้ถูกคืนกลับมาเป็นหลักฐาน ไม่ใช่ซ่อน",
    stages: [
      {
        label: "Trigger — กล่อง GPS/รีเลย์ยิง ping",
        detail:
          "POST /api/internal/equipment/telemetry รับ { imei, vccVoltage, recordedAt? } จากฮาร์ดแวร์โดยตรง — ไม่มี session เพราะกล่องไม่ได้ล็อกอิน และยังไม่มีผู้ให้บริการกล่อง/SMS gateway รายใดถูกเลือก จึงใช้ shape กลางนี้แทนการเดา wire format ของ vendor",
        evidence: "app/api/internal/equipment/telemetry/route.ts",
      },
      {
        label: "Gate — bearer secret ของฮาร์ดแวร์",
        detail:
          "header x-equipment-telemetry-secret ต้องตรงกับ EQUIPMENT_TELEMETRY_SECRET; ถ้ายังไม่ตั้งค่า ระบบตอบ 500 (ไม่ใช่ 503 แบบ bridge ธุรกิจ) ตามโค้ดจริง",
        evidence: "app/api/internal/equipment/telemetry/route.ts · process.env.EQUIPMENT_TELEMETRY_SECRET",
        refuses: "ไม่ตั้งค่า → 500 · ไม่ตรง → 401",
      },
      {
        label: "Validate — IMEI ต้องเป็นเครื่องที่รู้จัก",
        detail:
          "imei และ vccVoltage ต้องมาและมีชนิดถูกต้อง; ค้น equipment_assets ด้วย imei ถ้าไม่พบคือปฏิเสธ ไม่สร้างเครื่องใหม่ให้เอง",
        evidence: "app/api/internal/equipment/telemetry/route.ts · equipment_assets lookup by imei",
        refuses: "ข้อมูลไม่ครบ → 400 · ไม่พบ IMEI → 404",
      },
      {
        label: "Decision — VCC ≥ 13.5V คือเครื่องติด",
        detail:
          "engine_running = vccVoltage >= 13.5 โดยค่าคงที่ ENGINE_RUNNING_THRESHOLD_VCC อยู่ที่เดียว ไม่กระจายไปตามผู้ให้บริการกล่อง",
        evidence: "app/api/internal/equipment/telemetry/route.ts · ENGINE_RUNNING_THRESHOLD_VCC",
      },
      {
        label: "Evidence — เก็บ ping ดิบก่อนสะสม",
        detail:
          "insert equipment_telemetry_pings (recorded_at, engine_running, vcc_voltage, raw_payload) — เก็บ payload ดิบไว้ตรวจย้อน",
        evidence: "app/api/internal/equipment/telemetry/route.ts · equipment_telemetry_pings insert",
        refuses: "เขียน ping ไม่ได้ → 500",
      },
      {
        label: "Accumulate — ชั่วโมงเกิดจาก ping คู่",
        detail:
          "accumulateEngineHours อ่าน ping ก่อนหน้า (strictly before) และบวกเฉพาะเมื่อทั้ง ping ก่อนและ ping ใหม่เป็น engine_running; delta ถูก cap ที่ MAX_GAP_HOURS = 0.5 ชม. เพราะ ping ปกติมาทุก 10–30 วินาที — ช่องว่างที่ใหญ่กว่านั้นคือสัญญาณขาด ไม่ใช่ชั่วโมงเดินเครื่องที่มองไม่เห็น และค่า gap จริงถูกคืนเป็น capped_from_hours",
        evidence: "engines/equipment/engine-hours.ts · computeEngineHoursDelta / accumulateEngineHours",
        refuses: "ping ย้อนหลัง/เวลาเสีย → delta 0 ไม่ลบชั่วโมง · accumulate ล้ม → 500 พร้อม telemetry_saved:true",
      },
      {
        label: "Ack + สถานะเครื่อง",
        detail:
          "ถ้า engine_running เป็นจริง อัปเดต current_status = RUNNING แล้วตอบ { ok, engine_running, delta_hours, capped_from_hours, new_total_hours } — ตัวเลขที่ตอบคือค่าที่เขียนจริง ไม่ใช่ค่าที่คำนวณลอย",
        evidence: "app/api/internal/equipment/telemetry/route.ts · NextResponse.json",
      },
    ],
  },
  {
    id: "resource-hours",
    sectionId: "problem-logistics",
    title: "ชั่วโมงเครื่อง → resource transaction (ราคาจาก config จริง)",
    titleEn: "Machinery Hours",
    summary:
      "ชั่วโมงที่สะสมได้แล้วถูกส่งเข้าเส้นเงินผ่าน bridge นี้เท่านั้น — ผู้ส่งให้มาแค่ชั่วโมงกับเวลา ส่วนเงินคำนวณจาก app_configs ที่เจ้าของตั้งไว้ ไม่มีเลข hardcode ในโค้ด",
    stages: [
      {
        label: "Trigger — telematics/อีเมลแจ้งชั่วโมงเดินเครื่อง",
        detail: "POST /api/internal/connect/resource-transaction พร้อม source_event_id และเวลาจริงจากต้นทาง",
        evidence: "app/api/internal/connect/resource-transaction/route.ts",
      },
      {
        label: "Gate — secret ของ bridge",
        detail: "header x-resource-transaction-internal-secret เทียบ RESOURCE_TRANSACTION_INTERNAL_SECRET",
        evidence: "app/api/internal/connect/resource-transaction/route.ts",
        refuses: "ไม่ตั้ง → 503 · ไม่ตรง → 401",
      },
      {
        label: "Validate — ต้องอ้างของจริง",
        detail:
          "job_id ต้องมีอยู่จริงใน jobs, duration_hours > 0, started_at ต้องไม่เกิน received_at และ evidence_ref ต้องมี",
        evidence: "engines/canonical/resource-transaction-write.ts · recordResourceTransaction",
        refuses: "RESOURCE_TRANSACTION_JOB_NOT_FOUND / INVALID_TIME / INVALID_DURATION",
      },
      {
        label: "Authority — ราคาอ่านจาก config",
        detail:
          "fuel-price และ machinery_rates (base_rate_per_hour, fuel_consumption_lph, markup_margin) อ่านจาก app_configs; ขาดหรือผิดรูปคือหยุด ไม่ถอยไปใช้เลขเดิมในโค้ด",
        evidence: "engines/canonical/resource-transaction-write.ts · readConfigAuthorities",
        refuses: "CONFIG_AUTHORITY_MISSING (zero rows written)",
      },
      {
        label: "Idempotency — event เดียวสร้างแถวเดียว",
        detail:
          "source_event_id เป็น unique; ซ้ำจะคืนแถวเดิมพร้อม duplicate: true และยังกัน race 23505 ได้",
        evidence: "engines/canonical/resource-transaction-write.ts · idempotency check",
        refuses: "ไม่ throw ซ้ำ — คืน duplicate: true แทนการเขียนทับ",
      },
      {
        label: "Compute + Write + Audit",
        detail:
          "unit_cost = base_rate_per_hour + fuel_consumption_lph × fuel_price; unit_price = unit_cost + markup; total = duration_hours × unit_cost แล้วเขียนพร้อม audit transaction.created",
        evidence: "engines/canonical/resource-transaction-write.ts · recordResourceTransaction",
      },
    ],
  },
  {
    id: "price-authority",
    sectionId: "problem-logistics",
    title: "ข้อเสนอผู้ขาย ≠ ราคากลาง",
    titleEn: "Price Authority",
    summary:
      "แยกสองคำสั่งที่โค้ดเดิมปนกัน: การบันทึกข้อเสนอ (หลักฐาน) กับการแก้ราคากลาง (อำนาจ)",
    stages: [
      {
        label: "Trigger — มีข้อความตอบราคาเข้ามา",
        detail: "ช่องทางใดก็ได้ส่งข้อความตอบกลับ; ข้อความนั้นเป็นหลักฐาน ไม่ใช่สิทธิ์แก้ราคา",
        evidence: "engines/canonical/material-price-write.ts · recordSellerOffer",
      },
      {
        label: "Evidence — บันทึกข้อเสนอพร้อม audit ใน transaction เดียว",
        detail:
          "record_seller_offer_atomic เขียนแถวคำขอ + audit พร้อมกัน และคืน price_changed: false เสมอ",
        evidence: "engines/canonical/material-price-write.ts · recordSellerOfferAtomic",
        refuses: "PRICE_REQUEST_NOT_FOUND / PRICE_REQUEST_NOT_PENDING / PRICE_INVALID",
      },
      {
        label: "Authority — ใครมีสิทธิ์เปลี่ยนราคากลาง",
        detail:
          "applyMaterialPrice ใช้ resolveAuthority(action 'price.write'): เจ้าของหรือ delegation ที่ระบุชัดเท่านั้น — ADMIN_TIER อย่างเดียวหรือชื่อในแชตไม่พอ",
        evidence: "core/authority/resolve.ts · resolveAuthority",
        refuses: "PRICE_FORBIDDEN:<reason>",
      },
      {
        label: "Atomic commit — ราคาและ audit ไปด้วยกัน",
        detail:
          "apply_material_price_atomic เขียนราคา + audit ใน transaction เดียว และไม่มีเส้น 'เขียนแล้วค่อยย้อน' เพราะ compensation รับประกันไม่ได้",
        evidence: "engines/canonical/material-price-write.ts · applyMaterialPriceAtomic",
        refuses: "RPC ยังไม่ apply → PRICE_ATOMIC_RPC_MISSING (ไม่ลดชั้นเป็นเขียนครึ่งเดียว)",
      },
    ],
  },
  {
    id: "agent-authority",
    sectionId: "agents",
    title: "Agent เรียกของจริงได้แค่ประตูที่เปิด",
    titleEn: "Agent Authority",
    summary:
      "ไม่มีเอเจนต์ตัวไหนถือสิทธิ์ของตัวเอง: ทุกคำขอผ่าน session, whitelist, ช่องทางที่เปิด และหลักฐานยืนยันเจ้าของ",
    stages: [
      {
        label: "Trigger — agent/MCP client เรียกคำสั่ง",
        detail: "คำขอเข้ามาที่ route ของ MCP/dispatch ตามชนิดงาน (อ่านข้อมูล / วิเคราะห์ / รับงาน / อนุมัติ)",
        evidence: "app/api/v1/mcp/business/dispatch/route.ts",
      },
      {
        label: "Gate — session แอดมิน",
        detail: "business.dispatch ใช้ requireAuth(ADMIN_TIER) เป็นประตูเดียวกับ route แอดมินอื่น",
        evidence: "app/api/v1/mcp/business/dispatch/route.ts · requireAuth(ADMIN_TIER)",
        refuses: "ไม่มี session/ชั้นไม่ถึง → ปฏิเสธก่อนอ่านข้อมูล",
      },
      {
        label: "Gate — whitelist คำสั่งอ่าน",
        detail: "รับเฉพาะคำสั่งอ่านที่อยู่ในรายการ; คำสั่งอื่นไม่ถูกส่งต่อให้ dispatcher",
        evidence: "app/api/v1/mcp/business/dispatch/route.ts · COMMAND_NOT_PERMITTED",
        refuses: "403 COMMAND_NOT_PERMITTED",
      },
      {
        label: "Gate — Execution Channel",
        detail:
          "channelIsEnabled('execute') ยังเป็น false ระบบจึงรายงานความสามารถตรง ๆ ว่า NOT_IMPLEMENTED แทนการจำลองสำเร็จ",
        evidence: "app/api/admin/workspace/ai-agents/route.ts · engines/integration-gateway/policy/gate.ts",
        refuses: "execute_capability.status = 'NOT_IMPLEMENTED'",
      },
      {
        label: "Gate — เจ้าของต้องยืนยันเอง",
        detail: "การอนุมัติที่แตะ production ต้องแนบ owner_verification_artifact; session แอดมินอย่างเดียวไม่พอ",
        evidence: "app/api/gateway/proposals/[id]/decide/route.ts",
        refuses: "403 OWNER_VERIFICATION_REQUIRED",
      },
      {
        label: "Handoff — ส่งสัญญางาน ไม่ใช่สิทธิ์",
        detail:
          "contractor ได้ JobContract + WorkerRequest พร้อม permittedReadScope/permittedWriteScope และ approvalPolicy; runtime ยัง PAUSED ตาม TASK-082",
        evidence: "app/api/v1/mcp/contractor/task-claim/route.ts · registry/TASK_QUEUE.json",
        refuses: "intake ปิด → ไม่จ่ายงานใหม่",
      },
    ],
  },
];
