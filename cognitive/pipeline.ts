import { supabase } from "@/services/supabase/queries";
import { invokeAiGateway } from "@/services/ai/gateway";
import { loadConfigs, getNum, getConfigUpdatedAt } from "@/core/config-loader";
import { getKhonKaenWeatherNow, getKhonKaenWeatherForDay } from "@/engines/weather";
import { getAllBangchakFuelPrices } from "@/engines/fuel-live";
import { getLatestExchangeRates } from "@/engines/bot-exchange-rate";
import { normalizeThaiColloquial } from "@/cognitive/normalize";
import { translate as translateEntities } from "@/services/ai/translator";
import { dispatch as dispatchCommand } from "@/engines/validation/dispatcher";
import { composeBoard, type BoardResponse } from "@/cognitive/board";
import { evaluate } from "@/cognitive/evaluation";
import { executePlan } from "@/cognitive/executor";
import { generateHypotheses } from "@/cognitive/hypothesis";
import { learn } from "@/cognitive/learning";
import { applyReflection, enrichWithMemory, getMemory, newSession, resetMemory } from "@/cognitive/memory";
import { resolveObjective, type EnrichedInput, type Session } from "@/cognitive/objective";
import { plan, type Decision, type WorkflowDefinition } from "@/cognitive/planner";
import { reason, type Goal } from "@/cognitive/reasoning";
import { reflect, type ExecutionResult } from "@/cognitive/reflection";
import { buildSituation } from "@/cognitive/situation";
import { answerDocumentQuestion } from "@/engines/documents/qa";
import { runOwnerRequestViaCline, type ClineWorkerTransport } from "@/app/api/chat/_lib/clineWorker";
import { runOwnerRequestViaRailwayTaskQueue } from "@/app/api/chat/_lib/clineTaskQueue";
import type { SituationInput } from "@/cognitive/state";

const INTENT_CATALOG: Record<string, string[]> = {
  open_profile: ["เปิดลูกค้า", "ดูลูกค้า", "ข้อมูลลูกค้า"],
  review_debt: ["ดูหนี้", "หนี้", "ลูกหนี้", "ค้างจ่าย", "ค้าง", "ค้างชำระ"],
  collect_debt: ["ทวงเงิน", "เก็บเงิน", "ตามหนี้", "ทวงหนี้", "เก็บหนี้"],
  create_invoice: ["ออกบิล", "สร้างใบแจ้งหนี้", "ทำบิล", "ออกใบแจ้งหนี้"],
  create_quotation: ["เสนอราคา", "สร้างใบเสนอราคา", "ออกใบเสนอราคา"],
  create_boq: ["สร้าง boq", "ออก boq", "สร้างใบประมาณปริมาณงาน", "ออกใบประมาณปริมาณงาน"],
  create_receipt: ["ออกใบเสร็จ", "สร้างใบเสร็จ", "ออกใบรับเงิน", "สร้างใบรับเงิน"],
  create_delivery: ["ออกใบส่งสินค้า", "สร้างใบส่งสินค้า", "ออกใบส่งของ", "ออก DO"],
  create_billing: ["ออกใบกำกับภาษี", "สร้างใบกำกับภาษี", "ออกใบวางบิล"],
  review_partner: ["โรงโม่", "โม่หิน", "บ่อทราย", "บ่อดิน", "ดูคู่ค้า"],
  review_customer: ["ลูกค้า", "รายการลูกค้า", "แสดงรายการลูกค้า", "ดูรายการลูกค้า"],
  review_material: ["ดูวัสดุ", "วัสดุ", "ราคาวัสดุ"],
  review_job: ["ดูงาน", "งาน", "จัดส่ง", "โปรเจกต์"],
  review_document: ["ดูเอกสาร", "เอกสาร"],
  review_receipt: ["ดูใบเสร็จ", "ใบเสร็จ", "ใบเสร็จทั้งหมด"],
  review_quotation: ["ดูใบเสนอราคา", "แสดงใบเสนอราคา", "ใบเสนอราคาทั้งหมด"],
  review_boq: ["ดู boq", "แสดง boq", "ดูใบประมาณปริมาณงาน", "แสดงใบประมาณปริมาณงาน"],
  send_line: ["ส่ง LINE", "ส่งไลน์"],
  execute_pending: ["ส่งเลย", "ทำเลย", "ดำเนินการ"],
  continue_workflow: ["เหมือนเดิม", "ลองใหม่", "คำนวณใหม่"],
  navigation: ["ล้าง", "เคลียร์"],
};

const WORKFLOW_INTENTS = new Set(["collect_debt", "continue_workflow"]);
const TRANSPORT_INTENTS = new Set(["send_line", "execute_pending"]);
type GatewayContext = { ownerId: string; sessionId: string };

const WORKFLOWS: Record<string, WorkflowDefinition> = {
  open_profile: {
    id: "open_profile",
    trigger: ["open_profile"],
    required_business_objects: ["customer"],
    required_inputs: [{ field: "who", source: "session", ask_if_missing: "" }],
    steps: [
      step(0, "identity.resolve", { name: "$who" }),
      step(1, "debt.query", { customer_id: "$0.id" }, 0, [2], true),
      step(2, "document.query", { customer_id: "$0.id" }, 0, [1], true),
    ],
    possible_next_workflows: ["create_invoice", "collect_debt"],
    rollback_strategy: "skip_failed",
  },
  review_debt: {
    id: "review_debt",
    trigger: ["review_debt"],
    required_business_objects: ["debt"],
    required_inputs: [{ field: "who", source: "session", ask_if_missing: "ดูหนี้ของใครครับ" }],
    steps: [step(0, "identity.resolve", { name: "$who" }), step(1, "debt.query", { customer_id: "$0.id" }, 0)],
    possible_next_workflows: ["collect_debt", "create_invoice"],
    rollback_strategy: "skip_failed",
  },
  create_invoice: {
    id: "create_invoice",
    trigger: ["create_invoice"],
    required_business_objects: ["invoice"],
    required_inputs: [{ field: "who", source: "session", ask_if_missing: "ออกบิลให้ใครครับ" }],
    steps: [
      step(0, "identity.resolve", { name: "$who" }),
      step(1, "debt.query", { customer_id: "$0.id" }, 0),
      step(2, "invoice.create", { customer_id: "$0.id", amount: "$1.total" }, 1, [], false, false),
      step(3, "document.present", { document_id: "$2.document_id" }, 2, [], false, false),
      step(4, "pdf.export", { document_id: "$2.document_id", document_number: "$2.document_number", html: "$2.html" }, 3, [], false, true, "retry"),
      step(5, "line.send", { customer_id: "$0.id", message: "$3.summary", pdf_url: "$4.pdf_url" }, 4, [], false, true, "retry"),
    ],
    possible_next_workflows: ["send_line"],
    rollback_strategy: "abort",
  },
  create_quotation: {
    id: "create_quotation",
    trigger: ["create_quotation"],
    required_business_objects: ["quotation"],
    required_inputs: [{ field: "who", source: "session", ask_if_missing: "ออกใบเสนอราคาให้ใครครับ" }],
    steps: [
      step(0, "identity.resolve", { name: "$who" }),
      step(1, "quotation.create", { customer_id: "$0.id" }, 0, [], false, false),
      step(2, "document.present", { document_id: "$1.document_id" }, 1, [], false, false),
      step(3, "pdf.export", { document_id: "$1.document_id", document_number: "$1.document_number", html: "$1.html" }, 2, [], false, true, "retry"),
      step(4, "line.send", { customer_id: "$0.id", message: "$2.summary", pdf_url: "$3.pdf_url" }, 3, [], false, true, "retry"),
    ],
    possible_next_workflows: ["send_line"],
    rollback_strategy: "abort",
  },
  create_boq: {
    id: "create_boq",
    trigger: ["create_boq"],
    required_business_objects: ["boq"],
    required_inputs: [{ field: "who", source: "session", ask_if_missing: "ออก BOQ ให้ใครครับ" }],
    steps: [
      step(0, "identity.resolve", { name: "$who" }),
      step(1, "boq.create", { customer_id: "$0.id" }, 0, [], false, false),
      step(2, "document.present", { document_id: "$1.document_id" }, 1, [], false, false),
      step(3, "pdf.export", { document_id: "$1.document_id", document_number: "$1.document_number", html: "$1.html" }, 2, [], false, true, "retry"),
      step(4, "line.send", { customer_id: "$0.id", message: "$2.summary", pdf_url: "$3.pdf_url" }, 3, [], false, true, "retry"),
    ],
    possible_next_workflows: ["send_line"],
    rollback_strategy: "abort",
  },
  create_receipt: {
    id: "create_receipt",
    trigger: ["create_receipt"],
    required_business_objects: ["receipt"],
    required_inputs: [{ field: "who", source: "session", ask_if_missing: "ออกใบเสร็จให้ใครครับ" }],
    steps: [
      step(0, "identity.resolve", { name: "$who" }),
      step(1, "debt.query", { customer_id: "$0.id" }, 0),
      step(2, "receipt.create", { customer_id: "$0.id", amount: "$1.total" }, 1, [], false, false),
      step(3, "document.present", { document_id: "$2.document_id" }, 2, [], false, false),
      step(4, "pdf.export", { document_id: "$2.document_id", document_number: "$2.document_number", html: "$2.html" }, 3, [], false, true, "retry"),
      step(5, "line.send", { customer_id: "$0.id", message: "$3.summary", pdf_url: "$4.pdf_url" }, 4, [], false, true, "retry"),
    ],
    possible_next_workflows: ["send_line"],
    rollback_strategy: "abort",
  },
  create_delivery: {
    id: "create_delivery",
    trigger: ["create_delivery"],
    required_business_objects: ["delivery_order"],
    required_inputs: [{ field: "who", source: "session", ask_if_missing: "ออกใบส่งสินค้าให้ใครครับ" }],
    steps: [
      step(0, "identity.resolve", { name: "$who" }),
      step(1, "delivery_order.create", { customer_id: "$0.id" }, 0, [], false, false),
      step(2, "document.present", { document_id: "$1.document_id" }, 1, [], false, false),
      step(3, "pdf.export", { document_id: "$1.document_id", document_number: "$1.document_number", html: "$1.html" }, 2, [], false, true, "retry"),
      step(4, "line.send", { customer_id: "$0.id", message: "$2.summary", pdf_url: "$3.pdf_url" }, 3, [], false, true, "retry"),
    ],
    possible_next_workflows: ["send_line"],
    rollback_strategy: "abort",
  },
  create_billing: {
    id: "create_billing",
    trigger: ["create_billing"],
    required_business_objects: ["billing"],
    required_inputs: [{ field: "who", source: "session", ask_if_missing: "ออกใบกำกับภาษีให้ใครครับ" }],
    steps: [
      step(0, "identity.resolve", { name: "$who" }),
      step(1, "debt.query", { customer_id: "$0.id" }, 0),
      step(2, "billing.create", { customer_id: "$0.id", amount: "$1.total" }, 1, [], false, false),
      step(3, "document.present", { document_id: "$2.document_id" }, 2, [], false, false),
      step(4, "pdf.export", { document_id: "$2.document_id", document_number: "$2.document_number", html: "$2.html" }, 3, [], false, true, "retry"),
      step(5, "line.send", { customer_id: "$0.id", message: "$3.summary", pdf_url: "$4.pdf_url" }, 4, [], false, true, "retry"),
    ],
    possible_next_workflows: ["send_line"],
    rollback_strategy: "abort",
  },
  collect_debt: {
    id: "collect_debt",
    trigger: ["collect_debt"],
    required_business_objects: ["debt"],
    required_inputs: [{ field: "who", source: "session", ask_if_missing: "ทวงหนี้ใครครับ" }],
    steps: [step(0, "identity.resolve", { name: "$who" }), step(1, "debt.query", { customer_id: "$0.id" }, 0)],
    possible_next_workflows: ["send_line"],
    rollback_strategy: "abort",
  },
  send_line: {
    id: "send_line",
    trigger: ["send_line", "execute_pending"],
    required_business_objects: [],
    required_inputs: [],
    steps: [step(0, "line.send", { customer_id: "$who_id" }, null, [], false, true, "retry")],
    possible_next_workflows: [],
    rollback_strategy: "retry_last",
  },
  review_partner: {
    id: "review_partner",
    trigger: ["review_partner"],
    required_business_objects: ["partner"],
    required_inputs: [],
    steps: [step(0, "partner.list", {})],
    possible_next_workflows: [],
    rollback_strategy: "retry_last",
  },
  review_customer: {
    id: "review_customer",
    trigger: ["review_customer"],
    required_business_objects: ["customer"],
    required_inputs: [],
    steps: [step(0, "customer.list", {})],
    possible_next_workflows: ["open_profile", "create_invoice", "collect_debt"],
    rollback_strategy: "retry_last",
  },
  review_material: {
    id: "review_material",
    trigger: ["review_material"],
    required_business_objects: ["material"],
    required_inputs: [],
    steps: [step(0, "material.list", {})],
    possible_next_workflows: [],
    rollback_strategy: "retry_last",
  },
  review_job: {
    id: "review_job",
    trigger: ["review_job"],
    required_business_objects: ["job"],
    required_inputs: [],
    steps: [step(0, "job.list", {})],
    possible_next_workflows: [],
    rollback_strategy: "retry_last",
  },
  review_document: {
    id: "review_document",
    trigger: ["review_document"],
    required_business_objects: ["document"],
    required_inputs: [],
    steps: [step(0, "document.query", {})],
    possible_next_workflows: ["send_line"],
    rollback_strategy: "retry_last",
  },
  review_invoice: {
    id: "review_invoice",
    trigger: ["review_invoice"],
    required_business_objects: [],
    required_inputs: [],
    steps: [step(0, "invoice.query", { document_type: "invoice" })],
    possible_next_workflows: ["send_line"],
    rollback_strategy: "retry_last",
  },
  review_quotation: {
    id: "review_quotation",
    trigger: ["review_quotation"],
    required_business_objects: [],
    required_inputs: [],
    steps: [step(0, "quotation.query", { document_type: "quotation" })],
    possible_next_workflows: ["send_line"],
    rollback_strategy: "retry_last",
  },
  review_boq: {
    id: "review_boq",
    trigger: ["review_boq"],
    required_business_objects: [],
    required_inputs: [],
    steps: [step(0, "boq.query", { document_type: "boq" })],
    possible_next_workflows: ["send_line"],
    rollback_strategy: "retry_last",
  },
  process_feedback: {
    id: "process_feedback",
    trigger: ["process_feedback"],
    required_business_objects: [],
    required_inputs: [],
    steps: [step(0, "action.execute", { action: "$pending_action" })],
    possible_next_workflows: [],
    rollback_strategy: "abort",
  },
  continue_workflow: {
    id: "continue_workflow",
    trigger: ["continue_workflow"],
    required_business_objects: [],
    required_inputs: [],
    steps: [step(0, "action.execute", { action: "$pending_action" })],
    possible_next_workflows: [],
    rollback_strategy: "retry_last",
  },
};

// Real Data Analysis Layer (owner, 2026-07-30): "ai ในเครื่องมันตัวเล็กมาก
// มันไม่สามารถประมวลผลด้วยตัวของมันเองและวิเคราะห์ได้รวดเร็ว เราต้องใช้
// ข้อมูลที่ถูกต้องจริงๆ เล็กๆ ไร้ขยะ สะอาดจริง ให้ ai มันค่อยวิเคราะห์แล้วก็
// ตอบ...มันจะไม่มั่วเลย" — every question that touches an external, checkable
// fact (fuel price, weather, exchange rate, today's date) must pass through
// a REAL analysis step (call the actual data source, verify the result)
// BEFORE any AI ever sees the question — never "AI thinks then answers" for
// things that are actually knowable facts. Moved here from
// app/api/chat/route.ts (owner correction, same conversation: "ทำไมไม่ย้าย
// เข้าไปเป็นส่วนหนึ่งของขั้นวิเคราะห์เจตนา") so EVERY caller of
// runCognitivePipeline (admin secretary chat, /ask route, anything future)
// goes through this same one real analysis layer — not duplicated per route.
// Returns null (never a guess) when the question isn't one of these facts,
// letting the normal intent/workflow pipeline continue as before.
// Real "Command Intercept" (owner, 2026-07-30): "คำสั่ง 'เปิดหน้าแอดมิน',
// 'เปิดหน้าผู้ช่วย', 'ไปหน้า...' ให้ซอร์สโค้ดเปลี่ยนหน้าจอทันที ห้ามปล่อยหลุด
// ไปให้ AI นั่งตอบปฏิเสธ" — covers every real admin route in this codebase
// (verified against the actual `ls app/admin` folder list, not guessed).
// Requires an explicit navigation verb (เปิด/ไป/พาไป/สลับ) alongside a
// screen keyword — not a bare keyword alone — since some keywords (เช่น
// "งาน") are short enough to appear inside unrelated real sentences.
const NAV_VERB_PATTERN = /เปิด|ไปหน้า|ไปที่|พาไป|สลับ.*หน้า|เข้าไปหน้า|ไปดู/;
const NAV_KEYWORDS: [RegExp, string][] = [
  [/ผู้ช่วย|เลขา/, "/admin/dashboard"],
  [/แอดมิน|หน้าหลัก/, "/admin/relationships"],
  [/คู่ค้า|พาร์ทเนอร์|บริษัทคู่ค้า/, "/admin/partners"],
  [/ลูกค้า|ความสัมพันธ์/, "/admin/relationships"],
  [/หนี้|ติดตามหนี้/, "/admin/debt-tracking"],
  [/ใบเสร็จ|เอกสาร/, "/admin/receipts"],
  [/บ่อ(วัสดุ|หิน|ทราย|ดิน)?/, "/admin/pits"],
  [/คิวเสนอราคา|รอเสนอราคา/, "/admin/quotation-queue"],
  [/ภาพรวมการเงิน|การเงิน/, "/admin/finance"],
  [/เครื่องยนต์|เครื่องจักร/, "/admin/equipment"],
  [/โปรไฟล์.*(ไลน์|line)/i, "/admin/line-profiles"],
  [/ตัวเชื่อมต่อ|connector/i, "/admin/connectors"],
  // Real gap, owner-reported 2026-07-31: "สถาปัตยกรรม" used to map only to
  // /admin/graph (the 3D node-cloud view) — but the new Flow View page the
  // owner asked to be built lives at /admin/architecture (extends the real,
  // pre-existing Registry Viewer, per Rule 101/103 — not a new page). Needs
  // its OWN distinct keywords so "เปิดผังการไหล"/"เปิดทะเบียนโมดูล" lands on
  // the right one instead of both colliding on "สถาปัตยกรรม".
  [/ผังการไหล|ทะเบียนโมดูล|registry viewer/i, "/admin/architecture"],
  [/กราฟ|โครงสร้างระบบ|สถาปัตยกรรม/, "/admin/graph"],
  [/เรียลไทม์|สถานะระบบสด|telemetry/i, "/admin/telemetry"],
  [/งาน/, "/admin/jobs"],
  [/ผู้ใช้งาน/, "/admin/users"],
];

function tryNavigationIntercept(text: string): { sender: "ai"; type: "text"; text: string; navigate_url: string; pulse_node: string } | null {
  if (!NAV_VERB_PATTERN.test(text)) return null;
  // FOLLOW-UP REFERENCE GUARD (Owner Workspace AI integration, 2026-10-11):
  // คำสั่งที่อ้างถึงสิ่งที่กำลังคุยอยู่ ("...ของบริษัทนี้", "...ล่าสุด") ไม่ใช่
  // คำสั่งเปิดหน้า — ปล่อยให้ชั้นถัดไป (workflow/reasoning/Cline) จัดการ
  if (/(?:ของ(?:บริษัท|คน|ราย|ลูกค้า|คู่ค้า|เอกสาร|งวด|งาน)?\s*นี้|ล่าสุด)/.test(text)) return null;
  for (const [pattern, url] of NAV_KEYWORDS) {
    if (pattern.test(text)) {
      // Real module id for the Live State Signal (owner, 2026-07-30): "ให้มัน
      // ส่ง Pulse ไฟวิ่งผ่านเส้น Node นั้นจริงๆ" — derived directly from the
      // real page file this navigation actually lands on, matching
      // registry/architecture.json's own "module:<path>" node id scheme —
      // never a decorative/guessed node.
      return { sender: "ai", type: "text", text: "เปิดหน้าให้แล้วครับ", navigate_url: url, pulse_node: `module:app${url}/page.tsx` };
    }
  }
  return null;
}

const FUEL_PRICE_PATTERN = /(ราคา|ค่า|เท่าไหร่|เท่าไร|ดึง|ขอ|เอา).*(น้ำมัน|ดีเซล|เบนซิน|diesel)|(\bน้ำมัน|ดีเซล|เบนซิน\b).*(ราคา|ค่า|เท่าไหร่|เท่าไร)/i;
const ALL_FUEL_TYPES_PATTERN = /ทุกชนิด|ทั้งหมด/;
const WEATHER_PATTERN = /สภาพอากาศ|อากาศ(วันนี้|เป็นไง|เป็นยังไง)|ฝน(ตก|ไหม|จะตก|หรือเปล่า)|จะมีฝน|พายุ|มีพายุ/;
const EXCHANGE_RATE_PATTERN = /อัตราแลกเปลี่ยน|เรทเงิน|ค่าเงิน(บาท|ดอลลาร์|ยูโร)?|(ดอลลาร์|USD|EUR|ยูโร|GBP|JPY|เยน).*(เท่าไหร่|เท่าไร|กี่บาท)/i;
const TODAY_DATE_PATTERN = /วันนี้.*วันที่เท่าไหร่|วันที่เท่าไหร่.*วันนี้|today.*date|^วันที่เท่าไหร่/i;

type ChatReply = { sender: "ai"; type: "text"; text: string };

async function answerExternalFact(rawText: string): Promise<ChatReply | null> {
  // Real fix, owner-reported 2026-07-30: "วันที่ห้ามีฝนมั้ย" matched nothing —
  // "มั้ย" isn't "ไหม" and "ห้า" isn't "5" to a literal regex. Normalize
  // spoken/informal Thai to a canonical form BEFORE any pattern below runs,
  // instead of patching one exact spelling at a time forever.
  const text = normalizeThaiColloquial(rawText);
  if (TODAY_DATE_PATTERN.test(text)) {
    const now = new Date();
    return {
      sender: "ai", type: "text",
      text: `วันนี้วันที่ ${now.toLocaleDateString("th-TH", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} ครับ`,
    };
  }

  if (FUEL_PRICE_PATTERN.test(text) && ALL_FUEL_TYPES_PATTERN.test(text)) {
    const all = await getAllBangchakFuelPrices();
    if (all) {
      const lines = all.prices.map((p) => `${p.name}: ${p.priceToday.toLocaleString("th-TH")} บาท/ลิตร`);
      return { sender: "ai", type: "text", text: `ราคาน้ำมันบางจากวันนี้ (ทุกชนิด):\n${lines.join("\n")}\n(ข้อมูลจริง real-time จาก Bangchak, มีผล ${all.effectiveDate})` };
    }
    return { sender: "ai", type: "text", text: "เรียกข้อมูลราคาน้ำมันไม่สำเร็จตอนนี้ครับ (แหล่งข้อมูลภายนอกไม่ตอบสนอง) ลองใหม่อีกครั้งครับ" };
  }

  if (FUEL_PRICE_PATTERN.test(text)) {
    const configs = await loadConfigs(supabase());
    const price = getNum(configs, "fuel-price");
    const updatedAt = getConfigUpdatedAt("fuel-price");
    if (price) {
      const dateStr = updatedAt ? new Date(updatedAt).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" }) : null;
      return { sender: "ai", type: "text", text: `ราคาน้ำมันดีเซล (B20) วันนี้อยู่ที่ ${price.toLocaleString("th-TH")} บาท/ลิตร${dateStr ? ` (ข้อมูลอัปเดตล่าสุด ${dateStr}, ซิงค์อัตโนมัติจากบางจากทุกวัน)` : ""}` };
    }
  }

  if (WEATHER_PATTERN.test(text)) {
    const isTomorrow = /พรุ่งนี้/.test(text);
    const isDayAfter = /มะรืนนี้/.test(text);

    const dayOfMonthMatch = text.match(/วันที่\s*(\d{1,2})(?!\s*บาท)/);
    let specificDayOffset: number | null = null;
    let specificDateLabel = "";
    if (dayOfMonthMatch && !isTomorrow && !isDayAfter) {
      const targetDay = Number(dayOfMonthMatch[1]);
      if (targetDay >= 1 && targetDay <= 31) {
        const now = new Date();
        const candidate = new Date(now.getFullYear(), now.getMonth(), targetDay);
        if (candidate.getDate() === targetDay && candidate < now) {
          candidate.setMonth(candidate.getMonth() + 1);
        }
        if (candidate.getDate() === targetDay) {
          const diffDays = Math.round((candidate.setHours(0, 0, 0, 0) - now.setHours(0, 0, 0, 0)) / 86_400_000);
          specificDayOffset = diffDays;
          specificDateLabel = candidate.toLocaleDateString("th-TH", { day: "numeric", month: "long" });
        }
      }
    }

    if (specificDayOffset !== null) {
      if (specificDayOffset < 0 || specificDayOffset > 15) {
        return { sender: "ai", type: "text", text: `วันที่ ${specificDateLabel} อยู่นอกช่วงที่พยากรณ์อากาศแม่นยำได้ (ทำนายล่วงหน้าได้จริงประมาณ 16 วัน) ยังตอบไม่ได้ตอนนี้ครับ ต้องรอใกล้วันนั้นก่อน` };
      }
      const forecast = await getKhonKaenWeatherForDay(specificDayOffset);
      if (forecast) {
        const rainLine = forecast.rainChancePct != null
          ? `โอกาสฝนตก ${forecast.rainChancePct}%${forecast.rainSumMm ? ` (คาดปริมาณฝนรวม ${forecast.rainSumMm} มม.)` : ""}`
          : null;
        return {
          sender: "ai", type: "text",
          text: [
            `พยากรณ์อากาศ จ.ขอนแก่น วันที่ ${specificDateLabel} (${forecast.date}): ${forecast.conditionTh} อุณหภูมิ ${forecast.tempMinC}–${forecast.tempMaxC}°C`,
            rainLine,
            "(ข้อมูลพยากรณ์จริงจาก Open-Meteo)",
          ].filter((s): s is string => Boolean(s)).join("\n"),
        };
      }
      return { sender: "ai", type: "text", text: "เรียกข้อมูลพยากรณ์อากาศไม่สำเร็จตอนนี้ครับ (แหล่งข้อมูลภายนอกไม่ตอบสนอง) ลองใหม่อีกครั้งครับ" };
    }

    if (isTomorrow || isDayAfter) {
      const dayOffset = isDayAfter ? 2 : 1;
      const forecast = await getKhonKaenWeatherForDay(dayOffset);
      if (forecast) {
        const rainLine = forecast.rainChancePct != null
          ? `โอกาสฝนตก ${forecast.rainChancePct}%${forecast.rainSumMm ? ` (คาดปริมาณฝนรวม ${forecast.rainSumMm} มม.)` : ""}`
          : null;
        return {
          sender: "ai", type: "text",
          text: [
            `พยากรณ์อากาศ จ.ขอนแก่น ${isDayAfter ? "มะรืนนี้" : "พรุ่งนี้"} (${forecast.date}): ${forecast.conditionTh} อุณหภูมิ ${forecast.tempMinC}–${forecast.tempMaxC}°C`,
            rainLine,
            "(ข้อมูลพยากรณ์จริงจาก Open-Meteo)",
          ].filter((s): s is string => Boolean(s)).join("\n"),
        };
      }
      return { sender: "ai", type: "text", text: "เรียกข้อมูลพยากรณ์อากาศไม่สำเร็จตอนนี้ครับ (แหล่งข้อมูลภายนอกไม่ตอบสนอง) ลองใหม่อีกครั้งครับ" };
    }

    const weather = await getKhonKaenWeatherNow();
    if (weather) {
      const rainLine = weather.rainChanceTodayPct != null
        ? `โอกาสฝนตกวันนี้ ${weather.rainChanceTodayPct}%${weather.rainTodayMm ? ` (คาดปริมาณฝนรวม ${weather.rainTodayMm} มม.)` : ""}`
        : null;
      return {
        sender: "ai", type: "text",
        text: [
          `สภาพอากาศ จ.ขอนแก่น ตอนนี้: ${weather.conditionTh} อุณหภูมิ ${weather.temperatureC}°C`,
          rainLine,
          "(ข้อมูลจริงจาก Open-Meteo, real-time)",
        ].filter((s): s is string => Boolean(s)).join("\n"),
      };
    }
    return { sender: "ai", type: "text", text: "เรียกข้อมูลอากาศไม่สำเร็จตอนนี้ครับ (แหล่งข้อมูลภายนอกไม่ตอบสนอง) ลองใหม่อีกครั้งครับ" };
  }

  if (EXCHANGE_RATE_PATTERN.test(text)) {
    const result = await getLatestExchangeRates();
    if (result) {
      const lines = result.rates.map((r) => `${r.currencyId}: ซื้อ ${r.buyingTransfer.toFixed(2)} / ขาย ${r.selling.toFixed(2)} บาท (เฉลี่ย ${r.midRate.toFixed(2)})`);
      return { sender: "ai", type: "text", text: `อัตราแลกเปลี่ยนล่าสุด (${result.period}):\n${lines.join("\n")}\n(ข้อมูลจริงจาก ธนาคารแห่งประเทศไทย)` };
    }
    return { sender: "ai", type: "text", text: "เรียกข้อมูลอัตราแลกเปลี่ยนไม่สำเร็จตอนนี้ครับ (แหล่งข้อมูลภายนอกไม่ตอบสนอง) ลองใหม่อีกครั้งครับ" };
  }

  return null;
}

// Central Intent Dispatcher (owner, 2026-07-30): "ห้ามให้ไฟล์ UI แต่ละหน้าไป
// นั่งดักจับคำสั่งเสียงกันเองแบบสะเปะสะปะ...ข้อความทั้งหมดจากเฮียต้องวิ่งเข้า
// Central Brain Pipeline ที่เดียว" — real bug this fixes: wake-word,
// back/home, window-control, and external-app-open detection used to live
// as separate regex piles inside components/admin/SecretaryChat.tsx (a UI
// file), completely disconnected from this pipeline's own separate
// classification (tryNavigationIntercept/answerExternalFact). ONE
// classification function now covers all of it, here, server-side — the
// client becomes a thin executor that just carries out whatever this
// function decided, for the few actions that genuinely can ONLY run in the
// browser/Tauri process (window minimize/maximize, opening an external URL,
// taking a screenshot) and can never run on a Node server.
//
// Real module IDs below match the actual real architecture graph nodes
// (registry/architecture.json's node id scheme, "module:<path>") — used to
// drive a REAL pulse signal on the 3D graph overlay (owner: "ให้มันส่ง Pulse
// ไฟวิ่งผ่านเส้น Node นั้นจริงๆ...เพื่อให้เฮียเห็นกระแสสมองของมันจริงๆ")
// instead of the overlay just decoratively appearing with no connection to
// what actually ran.
export type ClientDirective = {
  back?: boolean;
  window_action?: "minimize" | "maximize" | "close";
  external_url?: string;
  screen_vision?: boolean;
  // Vision-Guided Step Assistant (owner, 2026-07-30): "เป็นหูเป็นตาเป็น
  // ประสาทสัมผัสช่วย...บอกว่าช่องนี้คืออะไร กดตรงไหน" — the owner explicitly
  // does NOT want a hardcoded/scripted automation ("เขียนโค้ดล็อกไว้ตายตัว")
  // that breaks the moment a website changes its UI, and does NOT want
  // synthetic clicking either (same declined risk as Accessibility API,
  // #25) — what he wants is live, adaptive narration: he clicks himself,
  // guided by what the vision model actually sees on screen right now,
  // toward a goal he states once. This carries that stated goal through to
  // the vision prompt so each read is actionable ("กดปุ่มสีฟ้ามุมขวาบน
  // เขียนว่า Get API Key") instead of a generic description.
  screen_vision_goal?: string;
  open_app?: string;
  // Chain Action / "line.copilot" (owner, 2026-07-31): "มันก็เป็นอีกโมเดล
  // ความสามารถหนึ่งที่ระบบเราต้องมี" — the real workflow shape already sat
  // unused in registry/commands/workflows.json (OPEN_APP → CAPTURE_WINDOW →
  // OCR_WINDOW → SEARCH_DATABASE → CALCULATE → GENERATE → PREVIEW → APPROVE
  // → EXECUTE) with zero trigger wired to it. Built from pieces that already
  // exist and were already verified working this session: open_app (real
  // native launch), Screen Vision (real OCR/translate, read-only), and the
  // normal cognitive reasoning pipeline (material.quote etc, already gated
  // by Rule 72's confirm-before-write). This directive only triggers the
  // CLIENT-side chain (open LINE, wait, screenshot, OCR) — the OCR'd text is
  // then fed back through the SAME /api/chat pipeline as an ordinary
  // message, so quoting/document-drafting reuses the real engine instead of
  // a second parallel one. EXECUTE (creating a real document) still always
  // requires the owner's explicit confirm click — same as every other
  // document.create flow — never happens automatically.
  line_copilot?: boolean;
  pulse_node?: string;
  /** OWNER WORKSPACE AI TOOL INTEGRATION (2026-10-11): structured result ที่
   * Cline คืนมาจาก business readers (sanitized แล้ว) — route ส่งต่อให้
   * Workspace result renderer เดิม ไม่ใช่ข้อความเปล่า */
  cline_result?: unknown;
};

const BACK_PATTERN = /^(กลับ|ย้อนกลับ|ปิดหน้านี้|back)[\s!.]*$/i;
const HOME_PATTERN = /^(กลับหน้าหลัก|หน้าหลัก|home)[\s!.]*$/i;
const MINIMIZE_PATTERN = /^(ย่อหน้าต่าง|ย่อแอป|ย่อ|minimize)[\s!.]*$/i;
const MAXIMIZE_PATTERN = /^(ขยายหน้าต่าง|ขยายแอป|ขยาย|เต็มจอ|maximize)[\s!.]*$/i;
const CLOSE_APP_PATTERN = /^(ปิดแอป|ปิดโปรแกรม|ปิดแอปพลิเคชัน|close app|quit)[\s!.]*$/i;
const EXTERNAL_APP_MAP: [RegExp, string][] = [
  [/tiktok/i, "https://www.tiktok.com"],
  [/facebook|เฟซบุ๊ก|เฟสบุ๊ก/i, "https://www.facebook.com"],
];
const GOOGLE_SEARCH_PATTERN = /(ค้น(หา)?|search).*(google|กูเกิล)|google.*(ค้น(หา)?|search)/i;
const OPEN_VERB_PATTERN = /^(เปิด|ไป(ที่)?)\s/;
// Loosened from an exact-phrase match to also capture an optional trailing
// goal (owner, 2026-07-30 — see screen_vision_goal above): "อ่านหน้าจอ หา
// API key ให้หน่อย" now carries "หา API key ให้หน่อย" through as the goal,
// while a bare "อ่านหน้าจอ" still works exactly as before (goal undefined).
const SCREEN_VISION_PATTERN = /^(อ่านหน้าจอ|อ่านจอ|ดูหน้าจอให้หน่อย|screen vision)\s*(.*)$/i;

// Native App Launch (owner, 2026-07-30): "เปิดแอปพลิเคชัน...open_app
// (app_name)" — real capability, scoped to "launch a named macOS app" (see
// src-tauri/src/lib.rs's open_app command + its comment for why the
// broader "AI controls the whole Mac" framing wasn't adopted). Checked only
// when the text does NOT match a real internal admin screen keyword
// (NAV_KEYWORDS, above) — otherwise "เปิดหน้าแอดมิน" would get misread as an
// attempt to launch an app literally named "หน้าแอดมิน". A small alias map
// covers common Thai spellings for apps the owner actually uses; anything
// else is passed through to macOS's own `open -a` as-is (safe: it's an argv
// element, never shell-interpreted — worst case macOS replies "app not
// found", never runs an arbitrary command).
const APP_NAME_ALIASES: [RegExp, string][] = [
  [/ไลน์|line/i, "LINE"],
  [/โครม|chrome/i, "Google Chrome"],
  [/เซฟารี|safari/i, "Safari"],
  [/ไฟน์เดอร์|finder/i, "Finder"],
  [/เทอร์มินอล|terminal/i, "Terminal"],
  [/เมล(์)?|mail/i, "Mail"],
  [/ปฏิทิน|calendar/i, "Calendar"],
  [/โน้ต|notes/i, "Notes"],
  [/แคลคูเลเตอร์|เครื่องคิดเลข|calculator/i, "Calculator"],
  [/พรีวิว|preview/i, "Preview"],
];
const OPEN_APP_PATTERN = /^(เปิด(แอป)?|เปิดโปรแกรม)\s+(.+)$/;

// Chain Action / "line.copilot" (owner, 2026-07-31) — see ClientDirective's
// own comment. Requires BOTH a LINE mention AND a real intent word (อ่าน/
// แชท/เสนอราคา/ราคา) so a plain "เปิดไลน์" (just launch the app) keeps going
// through the ordinary open_app path below, not this heavier chain.
const LINE_COPILOT_PATTERN = /(ไลน์|line).*(อ่าน|แชท|เสนอราคา|ราคา)|(อ่าน|แชท|เสนอราคา).*(ไลน์|line)/i;

function classifyClientCommand(text: string): ClientDirective {
  const directive: ClientDirective = {};
  if (LINE_COPILOT_PATTERN.test(text)) {
    directive.line_copilot = true;
    directive.pulse_node = "module:app/api/admin/screen-vision/route.ts";
    return directive;
  }
  if (BACK_PATTERN.test(text) || HOME_PATTERN.test(text)) {
    directive.back = HOME_PATTERN.test(text) ? undefined : true;
    directive.pulse_node = "module:components/admin/SecretaryChat.tsx";
  }
  if (MINIMIZE_PATTERN.test(text)) directive.window_action = "minimize";
  else if (MAXIMIZE_PATTERN.test(text)) directive.window_action = "maximize";
  else if (CLOSE_APP_PATTERN.test(text)) directive.window_action = "close";
  if (directive.window_action) directive.pulse_node = "module:src-tauri/src/lib.rs";
  if (GOOGLE_SEARCH_PATTERN.test(text)) {
    const query = text.replace(/ค้น(หา)?|search|google|กูเกิล/gi, "").trim();
    directive.external_url = `https://www.google.com/search?q=${encodeURIComponent(query || text)}`;
  } else if (OPEN_VERB_PATTERN.test(text)) {
    for (const [pattern, url] of EXTERNAL_APP_MAP) {
      if (pattern.test(text)) { directive.external_url = url; break; }
    }
  }
  const visionMatch = text.match(SCREEN_VISION_PATTERN);
  if (visionMatch) {
    directive.screen_vision = true;
    directive.screen_vision_goal = visionMatch[2]?.trim() || undefined;
    directive.pulse_node = "module:app/api/admin/screen-vision/route.ts";
  }
  if (!directive.external_url && !directive.window_action && !directive.screen_vision) {
    const isInternalNavCommand = NAV_VERB_PATTERN.test(text) && NAV_KEYWORDS.some(([pattern]) => pattern.test(text));
    const openMatch = text.match(OPEN_APP_PATTERN);
    if (openMatch && !isInternalNavCommand) {
      const raw = openMatch[3].trim();
      const alias = APP_NAME_ALIASES.find(([pattern]) => pattern.test(raw));
      directive.open_app = alias ? alias[1] : raw;
      directive.pulse_node = "module:src-tauri/src/lib.rs";
    }
  }
  return directive;
}

type PipelineResult = BoardResponse | ({ sender: "ai"; type: "command" | "text"; text?: string; command?: string; navigate_url?: string } & ClientDirective);

// ── Deterministic company-info routing (owner business routing fix, 2026-10-11) ──
// คำสั่งอย่าง "เปิดข้อมูลบริษัท ช.ธวัชชัยการช่าง" / "ดูบริษัท X" / "แสดงข้อมูลบริษัท X"
// เคยไม่มี matcher ตัวไหนใน INTENT_CATALOG/NAV_KEYWORDS จึงตกหลุม AI conversation
// fallback (answerWithAi → resolver เลือก openai ที่มี key ค้าง → AI_GATEWAY_OPENAI_HTTP_429
// บน production) — ทั้งที่ข้อมูลจริงอยู่ใน business readers เดิมครบแล้ว
// (partner.find / partner.profile / partner.timeline ผ่าน canonical dispatcher)
// ฟังก์ชันนี้: deterministic · READ-ONLY · ไม่เรียก AI Gateway ใด ๆ · ไม่ invent ข้อมูล —
// เรียกก่อน classifyIntentViaAi/answerWithAi จุดเดียวกับที่ answerDocumentQuestion วางไว้
// (owner mission 2026-10-10 deterministic document Q&A ก่อน AI — pattern เดิมเป๊ะ)
// deps.dispatch = test seam (fixture) — ค่าเริ่มต้นคือ dispatcher ตัวจริงตัวเดิม
// Cline with failover (DNA-000218): local binary ก่อน (Mac host) — ไม่มี
// (Railway Business Core) → task queue ไป Railway cline-worker (ai_tasks เดิม)
async function runOwnerClineWithFallback(
  message: string,
  opts: { sessionKey?: string | null; transport: ClineWorkerTransport; who?: string | null; whoId?: string | null },
) {
  const local = await runOwnerRequestViaCline(message, opts);
  const reply = local ?? (await runOwnerRequestViaRailwayTaskQueue(message, opts).catch(() => null));
  // DNA-000221: ตารางเอกสารจาก cline ใช้ title เทมเพลต "เอกสารล่าสุดของ <ชื่อ>" —
  // เก็บ identity ลง memory (สัญญาเดิม newSession) เพื่อให้คำสั่งต่อเนื่อง
  // ("แสดงเอกสารต้นฉบับของบริษัทนี้") มีบริบท ไม่ต้องถามซ้ำ
  if (reply?.result?.type === "table" && !opts.who && opts.sessionKey) {
    const m = /^(?:เอกสารล่าสุดของ|เอกสารของ)\s*(.+)$/.exec(reply.result.title ?? "");
    if (m && m[1].trim().length > 1) newSession(m[1].trim(), opts.sessionKey, null);
  }
  return reply;
}
export async function answerCompanyInfoQuestion(
  message: string,
  deps: { dispatch?: typeof dispatchCommand; sessionKey?: string | null } = {},
): Promise<{ sender: "ai"; type: "text"; text: string; pulse_node: string } | null> {
  const dispatch = deps.dispatch ?? dispatchCommand;
  // จับรูปแบบภาษาไทยของเจ้าของ: (verb ได้)? (ข้อมูล|โปรไฟล์)? (บริษัท|คู่ค้า|พาร์ทเนอร์) <ชื่อ>
  const match = message
    .trim()
    .match(/^(?:(?:เปิด|ดู|ขอดู|แสดง|ขอ|ค้นหา|หา)\s*)?(?:(?:ข้อมูล|โปรไฟล์)\s*)?(?:บริษัท|คู่ค้า|พาร์ทเนอร์)\s*(?:ชื่อ)?[:：]?\s*(.+)$/);
  if (!match) return null;
  const name = match[1].replace(/\s*(?:หน่อย|ด้วย|นะ|ครับ|ค่ะ|คะ|ให้หน่อย|ด้วยครับ|ด้วยค่ะ)\s*$/g, "").trim();
  // คำกลาง ๆ ที่ไม่ใช่ชื่อบริษัท → ไม่รับ (ปล่อยให้ path อื่นจัดการตามเดิม)
  if (!name || /^(?:ทั้งหมด|ทุกราย|ทุกบริษัท|ทั้งหลาย)$/i.test(name)) return null;

  const findResult = await dispatch("partner.find", { keyword: name }).catch(() => null);
  const rows =
    findResult?.ok && Array.isArray(findResult.data)
      ? (findResult.data as { id?: string; name?: string }[])
      : [];

  if (rows.length === 0) {
    // ไม่พบ = ตอบตรง ๆ ห้ามเดา ห้ามปล่อยไป AI (mission: explicit not-found)
    return {
      sender: "ai",
      type: "text",
      pulse_node: "module:cognitive/pipeline.answerCompanyInfoQuestion",
      text: `ไม่พบบริษัท/คู่ค้าชื่อ "${name}" ในระบบครับ — ลองพิมพ์ชื่อให้ตรงกับที่บันทึกไว้ หรือดูรายการทั้งหมดที่หน้าคู่ค้า (/admin/partners) ครับ`,
    };
  }

  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const exact = rows.filter((r) => norm(String(r.name ?? "")) === norm(name));
  const chosen = exact.length === 1 ? exact[0] : rows.length === 1 ? rows[0] : null;
  if (!chosen?.id) {
    // หลายราย = รายชื่อให้เลือก ห้ามเดารายแรก (owner rule: NEVER auto-pick)
    const names = rows.slice(0, 10).map((r) => `• ${r.name ?? "-"}`).join("\n");
    return {
      sender: "ai",
      type: "text",
      pulse_node: "module:cognitive/pipeline.answerCompanyInfoQuestion",
      text: `พบ ${rows.length} รายที่ตรงกับ "${name}" ครับ — ระบุชื่อเต็มเพื่อดูข้อมูล:\n${names}`,
    };
  }

  const [profileResult, timelineDispatch] = await Promise.all([
    dispatch("partner.profile", { partner_id: String(chosen.id) }).catch(() => null),
    dispatch("partner.timeline", { partner_id: String(chosen.id) }).catch(() => null),
  ]);
  const profile =
    profileResult?.ok && profileResult.data && typeof profileResult.data === "object"
      ? (profileResult.data as Record<string, unknown>)
      : {};
  const timelineItems =
    timelineDispatch?.ok && timelineDispatch.data && typeof timelineDispatch.data === "object"
      ? ((timelineDispatch.data as { timeline?: { date?: string; title?: string; amount?: number | null }[] }).timeline ?? [])
      : [];

  const label = String(profile.name ?? chosen.name);
  // OWNER WORKSPACE AI TOOL INTEGRATION: identity ที่ resolve แล้วเก็บลง
  // session memory (สัญญาเดิม cognitive/memory/newSession) เพื่อให้คำสั่ง
  // ต่อเนื่องของเจ้าของมีบริบท — ข้อมูลทุกชิ้นยังดึงจาก dispatcher เท่านั้น
  if (deps.sessionKey) newSession(label, deps.sessionKey, String(chosen.id));
  const lines: string[] = [`🏢 ${label}`];
  const phone = String(profile.phone ?? "").trim();
  const address = String(profile.address ?? "").trim();
  const taxId = String(profile.tax_id ?? "").trim();
  const typeLabel = String(profile.partner_type_label ?? "").trim();
  if (typeLabel) lines.push(`ประเภท: ${typeLabel}`);
  if (phone) lines.push(`📞 ${phone}`);
  if (address) lines.push(`📍 ${address}`);
  if (taxId) lines.push(`เลขประจำตัวผู้เสียภาษี: ${taxId}`);
  lines.push(`กิจกรรม/เอกสารในระบบ: ${timelineItems.length} รายการ`);
  for (const item of timelineItems.slice(0, 3)) {
    const amount = typeof item.amount === "number" ? ` ${item.amount.toLocaleString("th-TH")} บาท` : "";
    lines.push(`• ${item.date ?? "-"} — ${item.title ?? "-"}${amount}`);
  }
  lines.push("(อ่านจาก business readers เดิม: partner.find → partner.profile → partner.timeline — ไม่ผ่าน AI)");
  return { sender: "ai", type: "text", pulse_node: "module:cognitive/pipeline.answerCompanyInfoQuestion", text: lines.join("\n") };
}


export async function runCognitivePipeline(
  message: string,
  contactContext?: string | null,
  sessionKey?: string | null,
  knownCustomer?: { id: string; name: string } | null,
  gatewayContext?: GatewayContext,
  workerTransport?: ClineWorkerTransport,
): Promise<PipelineResult> {
  // Central Intent Dispatcher, checked first — see classifyClientCommand()'s
  // header comment.
  const clientDirective = classifyClientCommand(message);
  if (clientDirective.back || clientDirective.window_action || clientDirective.external_url || clientDirective.screen_vision || clientDirective.open_app || clientDirective.line_copilot) {
    const label = clientDirective.back ? "ย้อนกลับให้แล้วครับ"
      : clientDirective.window_action === "minimize" ? "ย่อหน้าต่างให้แล้วครับ"
      : clientDirective.window_action === "maximize" ? "ขยายเต็มจอให้แล้วครับ"
      : clientDirective.window_action === "close" ? "ปิดแอปให้แล้วครับ"
      : clientDirective.external_url ? "เปิดให้แล้วครับ"
      : clientDirective.screen_vision ? "กำลังอ่านหน้าจอให้ครับ..."
      : clientDirective.open_app ? `กำลังเปิด ${clientDirective.open_app} ให้ครับ...`
      : clientDirective.line_copilot ? "กำลังเปิด LINE และอ่านแชทให้ครับ..."
      : "รับทราบครับ";
    return { sender: "ai", type: "text", text: label, ...clientDirective };
  }
  if (HOME_PATTERN.test(message)) {
    return { sender: "ai", type: "text", text: "กลับหน้าหลักให้แล้วครับ", navigate_url: "/admin/relationships", pulse_node: clientDirective.pulse_node };
  }

  return runCognitiveCore(message, contactContext, sessionKey, knownCustomer, gatewayContext, workerTransport);
}

async function runCognitiveCore(
  message: string,
  contactContext?: string | null,
  sessionKey?: string | null,
  knownCustomer?: { id: string; name: string } | null,
  gatewayContext?: GatewayContext,
  workerTransport?: ClineWorkerTransport,
): Promise<PipelineResult> {
  // Owner directive (2026-08-01): "เกี่ยวกับเรื่องการเงินเอกสารไม่ต้องให้ ai
  // เข้ามาอยู่...มันเป็นตรรกะการบวกเลขเฉยๆ" — when the caller already knows
  // exactly which customer this is (e.g. an Action Bar button clicked from
  // inside that customer's own relationship view), seed the session with
  // that id BEFORE the AI ever sees the message. cognitive/planner/engine.ts
  // already skips identity.resolve entirely whenever objective.who_id is
  // set (`skipResolve = !!objective.who_id`) — this was already the
  // deterministic override path, it just never received a real id from any
  // UI button, so every document.create still went through AI name-matching
  // even when the identity was 100% known in code already (the real cause
  // of the 2026-07-31 wrong-company invoice/receipt incident).
  if (knownCustomer?.id) {
    newSession(knownCustomer.name, sessionKey, knownCustomer.id);
  }

  // Real bug, owner-reported 2026-07-30: "เปิดไปหน้าแอดมินหน่อย" fell through
  // to the LLM fallback entirely (no deterministic check recognized it as a
  // navigation command at all — the previous navigate_url logic only fired
  // AFTER the full cognitive pipeline resolved a business entity, e.g.
  // asking about a job/material), which then wrongly told the OWNER to
  // "contact the system owner." Real, deterministic intercept for ANY
  // "เปิดหน้า X / ไปหน้า X" phrasing across every real admin route, checked
  // before anything else — never let a screen-navigation request reach the
  // AI at all.
  const navIntercept = tryNavigationIntercept(message);
  if (navIntercept) return navIntercept;

  const factReply = await answerExternalFact(message);
  if (factReply) return factReply;

  if (/^DELETE:/.test(message)) {
    const [, table, id] = message.match(/^DELETE:(\w+):(.+)$/) ?? [];
    if (table && id) {
      return {
        sender: "ai",
        type: "text",
        text: `คำสั่งลบ ${table}:${id} ต้องผ่าน confirmation flow ก่อน execute`,
      };
    }
  }

  const enriched = enrichWithTranslator(operatingIntent(message, sessionKey), message);
  const memory = getMemory(sessionKey);

  if (enriched.intent_type === "navigation") {
    resetMemory(sessionKey);
    return { sender: "ai", type: "command", command: "CLEAR_SCREEN" };
  }

  const session = toSession(memory);
  const objective = resolveObjective(enriched, session);
  const dbResults = await fetchForSituation(enriched.who, enriched.what);
  const situationInput: SituationInput = {
    objective_id: objective.id,
    intent_type: enriched.intent_type,
    who: objective.who,
    who_id: objective.who_id,
    what: enriched.what,
    action: enriched.action,
    raw_input: enriched.raw_input,
    session_history: memory.previous_goals,
    db_results: dbResults,
  };

  const rawWorldState = buildSituation(situationInput);
  const worldState = enrichWithMemory(rawWorldState, sessionKey);
  const hypotheses = generateHypotheses(worldState);
  const reasoning = reason(toGoal(enriched), session);
  const decision: Decision = {
    decision: reasoning.decision,
    tools_needed: reasoning.plan.map((s) => s.tool),
    execution_mode: reasoning.plan.length > 1 ? "parallel" : "sequential",
    ask_user: reasoning.need_more_info,
    workspace_action: reasoning.workspace_action,
    next_actions: reasoning.next_actions,
  };
  const executionPlan = plan(decision, objective, WORKFLOWS);
  const executionResults = await executePlan(executionPlan, worldState);
  const evaluation = evaluate(executionResults, worldState, executionPlan.expected_result, objective.success_criteria);
  const reflection = reflect(executionResults as ExecutionResult[], worldState, decision.decision);
  const learned = learn(reflection, evaluation);

  applyReflection(reflection, sessionKey);

  if (executionPlan.ask_user) {
    // OWNER WORKSPACE AI TOOL INTEGRATION: reasoning ติดปัญหา "ของใครครับ"
    // (identity ขาดจาก memory) → ถ้ามี Cline transport ให้ Cline ลองจัดการ
    // ก่อน (มี session context ต่อเนื่อง + ask-back เมื่อกำกวมจริง) —
    // fail-closed: Cline ไม่ตอบ → คำถามเดิมถูกส่งกลับเหมือนทุกพฤติกรรมก่อนหน้า
    if (workerTransport) {
      const clineMemory = getMemory(sessionKey);
      const clineReply = await runOwnerClineWithFallback(message, {
        sessionKey,
        transport: workerTransport,
        who: clineMemory.who,
        whoId: clineMemory.who_id ?? null,
      });
      if (clineReply) {
        return {
          sender: "ai" as const,
          type: "text" as const,
          text: clineReply.text,
          pulse_node: "module:app/api/chat/_lib/clineWorker",
          cline_result: clineReply.result ?? null,
        };
      }
    }
    return { sender: "ai", type: "text", text: executionPlan.ask_user };
  }

  if (executionPlan.workflow_id === "none") {
    // DETERMINISTIC DOCUMENT Q&A FIRST (owner mission 2026-10-10): คำถามธุรกิจ
    // เรื่องเอกสารที่มีข้อมูลจริงอยู่แล้วต้องตอบจาก Business Engine ก่อน — ไม่ต้อง
    // ใช้ AI ไม่สร้างข้อมูลเอง ไม่แตะยอด (engines/documents/qa.ts อ่าน canonical
    // record อย่างเดียว และ null ทันทีถ้าไม่ใช่คำถามแนวนี้)
    const docAnswer = await answerDocumentQuestion(message);
    if (docAnswer) return { sender: "ai" as const, type: "text" as const, text: docAnswer };

    // OWNER BUSINESS ROUTING FIX (2026-10-11): คำสั่งดูข้อมูลบริษัท/คู่ค้าแบบ
    // ภาษาคน ("เปิดข้อมูลบริษัท ช.ธวัชชัยการช่าง") → business readers เดิม
    // (partner.find/profile/timeline ผ่าน dispatcher) — deterministic, READ-ONLY,
    // ไม่ผ่าน AI Gateway: เคยตกหลุม answerWithAi → openai 429 บน production
    const companyAnswer = await answerCompanyInfoQuestion(message, { sessionKey });
    if (companyAnswer) return companyAnswer;

    // OWNER WORKSPACE AI TOOL INTEGRATION (2026-10-11): คำสั่งที่ deterministic
    // paths ตอบไม่ได้ (บริบทหลายขั้น/ต้องค้นหลายคำสั่ง) → ส่งต่อให้ **Cline**
    // (AI ที่ owner ติดตั้งจริง) คิดและเรียก business.dispatch ผ่าน owner
    // session — ไม่มี AI runtime ใหม่ ไม่มี reader/writer ใหม่ · fail-closed:
    // ไม่มี cline binary (เช่นบน Railway) / timeout / ตอบไม่เป็น JSON → null
    // → เส้นทางเดิม (classifyIntentViaAi/answerWithAi/bridge/owner-runtime) ต่อตามเดิม
    if (workerTransport) {
      const clineMemory = getMemory(sessionKey);
      const clineReply = await runOwnerClineWithFallback(message, {
        sessionKey,
        transport: workerTransport,
        who: clineMemory.who,
        whoId: clineMemory.who_id ?? null,
      });
      if (clineReply) {
        return {
          sender: "ai" as const,
          type: "text" as const,
          text: clineReply.text,
          pulse_node: "module:app/api/chat/_lib/clineWorker",
          cline_result: clineReply.result ?? null,
        };
      }
    }

    // Real gap, owner-reported 2026-07-30 — see classifyIntentViaAi()'s own
    // comment: before just talking about the message, check whether it
    // actually intends one of the real, already-built client actions
    // (open_app/external_url/window_action/screen_vision) that the exact-
    // regex Central Intent Dispatcher (classifyClientCommand) might have
    // missed due to looser phrasing. Only ever executes real capabilities —
    // never invents new ones.
    const aiAction = await classifyIntentViaAi(message, gatewayContext);
    if (aiAction?.action === "open_app" && aiAction.app_name) {
      return { sender: "ai", type: "text", text: `กำลังเปิด ${aiAction.app_name} ให้ครับ...`, open_app: aiAction.app_name, pulse_node: "module:src-tauri/src/lib.rs" };
    }
    if (aiAction?.action === "external_url" && aiAction.url) {
      return { sender: "ai", type: "text", text: "เปิดให้แล้วครับ", external_url: aiAction.url };
    }
    if (aiAction?.action === "window_action" && aiAction.window_action) {
      const label = aiAction.window_action === "minimize" ? "ย่อหน้าต่างให้แล้วครับ"
        : aiAction.window_action === "maximize" ? "ขยายเต็มจอให้แล้วครับ"
        : "ปิดแอปให้แล้วครับ";
      return { sender: "ai", type: "text", text: label, window_action: aiAction.window_action, pulse_node: "module:src-tauri/src/lib.rs" };
    }
    if (aiAction?.action === "screen_vision") {
      return { sender: "ai", type: "text", text: "กำลังอ่านหน้าจอให้ครับ...", screen_vision: true, screen_vision_goal: aiAction.goal, pulse_node: "module:app/api/admin/screen-vision/route.ts" };
    }
    return answerWithAi(message, contactContext, gatewayContext);
  }

  const board = composeBoard(worldState, hypotheses, executionResults, reflection, memory.turn_count + 1);
  board.debug = { ...board.debug, objective: objective.type, workflow: executionPlan.workflow_id, learning: learned };
  // OWNER WORKSPACE AI TOOL INTEGRATION: จุดนี้คือจุดทุก deterministic path
  // (client directive, navigation, board Q&A, workflow, capability dispatcher,
  // reasoning) "ตอบไม่ได้จริง" และกำลังจะ fallback เป็น board overview ชุด
  // เดิม — ถ้ามี Cline transport ให้ Cline ลองคิด/ค้นก่อน (สั่งอ่านอย่างเดียว
  // ผ่าน business.dispatch) แล้วค่อยตกกลับเป็น board เมื่อ Cline ไม่ตอบ
  // (fail-closed เหมือนเดิม) · objective "workspace" = ถามสถานะหน้าเวิร์กสเปซ
  // ตรง ๆ  board คือคำตอบที่ถูกต้องอยู่แล้ว ไม่ต้องส่งให้ Cline
  if (workerTransport && objective.type !== "workspace") {
    const clineMemory = getMemory(sessionKey);
    const clineReply = await runOwnerClineWithFallback(message, {
      sessionKey,
      transport: workerTransport,
      who: clineMemory.who,
      whoId: clineMemory.who_id ?? null,
    });
    if (clineReply) {
      return {
        sender: "ai" as const,
        type: "text" as const,
        text: clineReply.text,
        pulse_node: "module:app/api/chat/_lib/clineWorker",
        cline_result: clineReply.result ?? null,
      };
    }
  }
  return board;
}

// Real bug, owner-reported 2026-07-30: asking "ถาม AI" a free-text question
// ("พี่หนุ่มมีหน้าที่อะไร เป็นใครในระบบบริษัท DNA OS") crashed outright
// ("เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้งครับ") — this called the Anthropic SDK
// directly and synchronously with no try/catch, and ANTHROPIC_API_KEY was
// never actually set (confirmed: zero occurrences in .env.local). The
// LINE-webhook side of this exact problem was already fixed 2026-07-25 by
// moving to local Ollama via an async ai_tasks queue (owner: "ย้ายทุกอย่างมา
// ประมวลผลในเครื่อง Mac") — but that queue pattern doesn't fit here: this is
// an admin sitting in front of the screen waiting for an answer right now,
// not a customer who can wait for a 20-second poll cycle. Since this Next.js
// server itself now runs AS the desktop app on the owner's own Mac (Tauri
// wrap, 2026-07-30), it can reach http://localhost:11434 (Ollama) directly
// and synchronously — something a Supabase Edge Function never could.
// Real fallback chain: try cloud Claude only if a key is actually configured,
// otherwise (or on any failure) call the same local "thawatchai" model the
// LINE conversational-fallback already uses — never let this throw
// unhandled up to the frontend again.
// Real bug, owner-reported 2026-07-30: asked "วันนี้วันที่เท่าไหร่" and the
// LLM hallucinated a completely wrong date ("30 ตุลาคม 2566" — Oct 2023) —
// an LLM has no real clock, it only guesses from training data unless told.
// A narrow regex-matched "what's today's date" check (app/api/chat/route.ts)
// only catches ONE specific phrasing; this is the real, general fix — the
// actual current Thai date/time (real system clock, Buddhist Era via
// th-TH locale) is now injected into EVERY LLM system prompt here, so any
// question that touches date/time context (however it's phrased) is
// grounded in the real calendar instead of the model's own guess.
function currentThaiDateTimeContext(): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString("th-TH", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const timeStr = now.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
  return `วันที่/เวลาปัจจุบันจริง (ใช้ปีพ.ศ.): ${dateStr} เวลา ${timeStr} น. — ห้ามเดาหรือใช้วันที่อื่นเด็ดขาด`;
}

// Real bug, owner-reported 2026-07-30: asked "มีบริการให้เช่าเครื่องจักรไหม"
// and "ขอเบอร์โทรหน่อย" — the AI confidently answered BOTH (one flat "no,
// we don't do that," one invented "LINE only" policy) with zero real data
// behind either claim — this reached answerWithAi with nothing in
// answerExternalFact/operatingIntent to ground it, so the LLM just
// fabricated a definitive-sounding business fact. Same class of problem as
// the earlier date-hallucination bug, but for business capability/policy
// facts instead of dates — and this one is more dangerous since a wrong
// "we don't offer that" or a fake contact policy could actually mislead a
// real customer. Same fix pattern already proven safe on the LINE side
// (supabase/functions/line-webhook-v2/engines/thoughtful-fallback.ts's own
// "ห้ามบอกราคา/จำนวน/ข้อมูลธุรกิจใดๆ ที่ไม่ได้อยู่ในบริบทที่ให้มา" rule):
// forbid asserting ANY business fact not in the given context, explicitly.
// Note: unlike the LINE customer-facing side (where "check with the owner"
// is correct — a real customer isn't the owner), this admin-side prompt
// must never tell the person to check with "the owner," since they ARE the
// owner (see OWNER_IDENTITY_RULE below) — phrased as "say plainly you don't
// have real data for that" instead.
const NO_UNGROUNDED_FACTS_RULE = "ห้ามเด็ดขาด: ห้ามยืนยันหรือปฏิเสธข้อเท็จจริงทางธุรกิจใดๆ (บริการที่มี/ไม่มี, นโยบายติดต่อ, เบอร์โทร, ราคา) ที่ไม่ได้อยู่ในข้อมูลที่ให้มาจริงด้านบนนี้ — ถ้าไม่รู้ ให้บอกตรงๆ ว่าไม่มีข้อมูลจริงเรื่องนี้ในระบบตอนนี้ ห้ามเดาหรือมั่นใจไปเองเด็ดขาด";

// Real bug, owner-reported 2026-07-30: the local model's own baked persona
// (~/dna-os-ollama/Modelfile) introduces itself as "ธวัชชัย" — and it turns
// out the owner's OWN real name is also ธวัชชัย มูลลาด (a genuine
// coincidence, only revealed live in this conversation) — the model got
// confused between "ธวัชชัย = my own assistant name" and "ธวัชชัย = the
// real person I'm talking to," producing a nonsensical reply that addressed
// the owner using its own persona framing. Separately, replies mixed ครับ
// (male) and ค่ะ (female) sentence-ending particles inconsistently across
// turns — never explicitly pinned down. Both fixed as explicit rules here.
// Real bug, owner-reported 2026-07-30: told the assistant to open the admin
// screen and got "ต้องติดต่อเจ้าของระบบเพื่อขอความช่วยเหลือครับ" (please
// contact the system owner for help) — said to the OWNER HIMSELF. This chat
// (the admin secretary chat) is used exclusively by the owner — there is no
// "someone else" to redirect to here, unlike the LINE customer-facing side
// where that phrasing is correct (a real customer isn't the owner). Locked
// explicitly so the LLM fallback never parrots that line back at him again.
const OWNER_IDENTITY_RULE = "กฎสำคัญที่สุด: ผู้ที่คุยกับคุณในแชทนี้คือ \"เฮีย\" เจ้าของระบบ DNA OS ตัวจริง เป็น Owner สิทธิ์สูงสุดเสมอ — ห้ามบอกให้เขา \"ติดต่อเจ้าของระบบ\" หรือ \"ถามเจ้าของระบบ\" เด็ดขาด เพราะเขาคือเจ้าของระบบอยู่แล้ว ถ้าทำอะไรไม่ได้จริงๆ (เช่น เปิดหน้าจอที่ไม่มีอยู่จริง) ให้บอกตรงๆ ว่าทำไม่ได้เพราะอะไร ไม่ใช่ส่งต่อให้คนอื่น";

// Owner request 2026-07-30: "บอก AI ว่าเปิดแอปพลิเคชันได้ ห้ามตอบปฏิเสธว่า
// เปิดไม่ได้อีก" — but a blanket "you may control the entire Mac" framing
// was deliberately NOT adopted here (see src-tauri/src/lib.rs's open_app
// comment for the full reasoning): it would make the model promise things
// nothing in this codebase actually does (clicking inside other apps,
// reading their contents, running arbitrary commands) and risk it claiming
// success on requests that silently do nothing. What's real and deterministic:
// classifyClientCommand() in this file already intercepts "เปิด <ชื่อแอป>"
// BEFORE this LLM fallback ever runs, and actually launches the named macOS
// app via Tauri's real open_app command. This rule only tells the LLM that
// fact accurately, so if it's ever asked "เปิดแอปได้ไหม" in conversation, it
// answers correctly instead of denying a capability that does exist.
const APP_LAUNCH_CAPABILITY_RULE = "ความสามารถจริงที่มีอยู่แล้ว: ระบบนี้เปิดแอปพลิเคชันจริงบนเครื่อง Mac ได้จริง (เช่น เปิด LINE, เปิด Google Chrome) ผ่านคำสั่ง \"เปิด [ชื่อแอป]\" — ถูกดักจับและรันจริงก่อนถึงคุณเสมอ ห้ามตอบปฏิเสธว่าเปิดแอปไม่ได้ แต่ห้ามอ้างว่าทำสิ่งอื่นนอกเหนือจากนี้ได้ (เช่น กดปุ่มในแอปอื่น อ่านเนื้อหาในแอปอื่น สั่งงานทั่วทั้งเครื่อง) เพราะสิ่งเหล่านั้นยังไม่มีจริงในระบบ";

const IDENTITY_RULES = "กฎเรื่องตัวตน: คุณเป็นผู้ช่วย AI เพศชาย ใช้คำลงท้าย \"ครับ\" เท่านั้นเสมอ ห้ามใช้ \"ค่ะ\"/\"คะ\" เด็ดขาด — ถ้าผู้ใช้บอกว่าตัวเองชื่อธวัชชัย (หรือชื่ออื่นใดที่ตรงกับชื่อ AI) นั่นคือชื่อจริงของมนุษย์ที่คุยด้วย ไม่ใช่การอ้างถึงตัวคุณเอง ห้ามสับสน ห้ามพูดราวกับว่าผู้ใช้คือ AI\n\n" + OWNER_IDENTITY_RULE + "\n\n" + APP_LAUNCH_CAPABILITY_RULE;

// Real gap, owner-reported 2026-07-30: "ai ก็ตอบว่าทำไม่ได้ แต่ระบบกูเสือก
// เปิดหน้าเว็บได้อยู่" — the Central Intent Dispatcher (classifyClientCommand,
// above) only catches EXACT regex phrasing ("เปิด LINE"). Looser phrasing
// ("ช่วยเปิดไลน์ให้หน่อยค้าบ") misses every regex, finds no business
// workflow either, and fell all the way to answerWithAi() — a pure
// conversational LLM with zero ability to actually run anything — so it
// replied in prose (often "ทำไม่ได้") while the real open_app/external_url/
// window_action/screen_vision capabilities sat right there, unused, because
// nothing ever asked them to run. This closes that gap WITHOUT inventing new
// capabilities: it asks the SAME local model to classify (not converse)
// whether the message intends one of the real, already-built actions, and
// if so, this function executes that real action for real — the model
// never gets to just talk about doing something the system doesn't
// actually do; it can only select from actions this codebase can actually
// carry out.
type AiActionDirective =
  | { action: "open_app"; app_name: string }
  | { action: "external_url"; url: string }
  | { action: "window_action"; window_action: "minimize" | "maximize" | "close" }
  | { action: "screen_vision"; goal?: string }
  | { action: "none" };

async function classifyIntentViaAi(message: string, gatewayContext?: GatewayContext): Promise<AiActionDirective | null> {
  // Model choice verified live, 2026-07-30: "thawatchai" (the persona/chat
  // model used by answerWithAi() above) reliably answered {"action":"none"}
  // even for a clear "เปิดไลน์" request when asked to classify — its baked
  // persona apparently interferes with a plain structured-classification
  // task. The base "qwen3:8b" model (no persona, already installed for
  // other local-AI work) correctly classified all 4 real test phrasings
  // (open_app/external_url/window_action/none) in live curl tests. Also:
  // `format: "json"` made qwen3:8b return an empty object — omitted here,
  // relying on the prompt's own instruction instead (verified: it does not
  // emit <think> preamble via /api/generate the way its chat mode can).
  const prompt = `ข้อความจากผู้ใช้: "${message}"\n\nระบบนี้มีความสามารถจริงต่อไปนี้เท่านั้น (ไม่มีความสามารถอื่นนอกจากนี้):\n1. เปิดแอปพลิเคชันบนเครื่อง Mac — {"action":"open_app","app_name":"<ชื่อแอปภาษาอังกฤษ เช่น LINE, Google Chrome, Finder>"}\n2. เปิดเว็บไซต์/ค้นหาเว็บ — {"action":"external_url","url":"<URL เต็ม>"}\n3. ย่อ/ขยาย/ปิดหน้าต่างแอปนี้เอง — {"action":"window_action","window_action":"minimize"|"maximize"|"close"}\n4. อ่านหน้าจอปัจจุบันเพื่อช่วยแปล/อธิบาย/ชี้ทางว่าต้องกดตรงไหน — {"action":"screen_vision","goal":"<สิ่งที่ผู้ใช้ต้องการทำบนหน้าจอนี้ ถ้าบอกมา เช่น หา API key, สมัครสมาชิก — ถ้าไม่ได้บอกเป้าหมายชัดเจน ไม่ต้องใส่ goal>"}\n\nถ้าข้อความนี้ตั้งใจสั่งอย่างใดอย่างหนึ่งข้างต้นจริงๆ ตอบ JSON ตามรูปแบบนั้นเท่านั้น ห้ามมีข้อความอื่นปนเลย ถ้าไม่ตรงกับความสามารถใดเลย ตอบ {"action":"none"} เท่านั้น`;
  if (!gatewayContext) return null;
  try {
    const result = await invokeAiGateway({
      ...gatewayContext,
      origin: "cognitive/pipeline.classifyIntentViaAi",
      capability: "intent.classify",
      effect: "classification",
      systemPrompt: "ตอบ JSON เท่านั้น ห้ามสั่ง execute หรือแก้ไขข้อมูล",
      prompt,
    });
    if (!result.ok || !result.output) return null;
    const jsonMatch = result.output.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed && typeof parsed.action === "string") return parsed as AiActionDirective;
  } catch (err) {
    console.error("[cognitive/pipeline] classifyIntentViaAi failed:", err);
  }
  return null;
}

async function answerWithAi(message: string, contactContext?: string | null, gatewayContext?: GatewayContext) {
  const dateTimeContext = currentThaiDateTimeContext();
  const systemPrompt = contactContext
    ? `คุณคือ DNA OS ผู้ช่วยเจ้าของธุรกิจวัสดุก่อสร้าง จ.ขอนแก่น ตอบสั้นกระชับ ภาษาไทย\n\n${dateTimeContext}\n\n${IDENTITY_RULES}\n\n${NO_UNGROUNDED_FACTS_RULE}\n\nข้อมูลจริงเกี่ยวกับผู้ติดต่อที่กำลังถามถึง (ใช้ตอบ ห้ามเดานอกเหนือจากนี้):\n${contactContext}`
    : `คุณคือ DNA OS ผู้ช่วยเจ้าของธุรกิจวัสดุก่อสร้าง จ.ขอนแก่น ตอบสั้นกระชับ ภาษาไทย\n\n${dateTimeContext}\n\n${IDENTITY_RULES}\n\n${NO_UNGROUNDED_FACTS_RULE}`;

  if (!gatewayContext) {
    return { sender: "ai" as const, type: "text" as const, text: "ตอบไม่ได้ตอนนี้ครับ (ไม่มี AI session context)" };
  }
  const result = await invokeAiGateway({
    ...gatewayContext,
    origin: "cognitive/pipeline.answerWithAi",
    capability: "conversation.answer",
    effect: "draft",
    systemPrompt,
    prompt: `คำถาม: ${message}`,
  });
  if (result.ok && result.output) {
    return { sender: "ai" as const, type: "text" as const, text: result.output };
  }
  // แยกเหตุผลให้ชัด (owner mission 2026-10-10 — ห้ามตอบเหมารวมว่า "ไม่มี AI"):
  // - resolver ไม่มี adapter ที่ตั้งค่าแล้ว → แจ้งว่า provider ยังไม่พร้อม (คนละเรื่องกับระบบไม่มี AI)
  // - provider ตอบกลับมาแต่ล้มเหลว/ว่าง → แจ้งให้ลองใหม่
  const reason = result.error ?? "AI_GATEWAY_UNKNOWN";
  const providerDown = reason.includes("NO_COMPATIBLE_ADAPTER") || reason.includes("NOT_CONFIGURED");
  const text = providerDown
    ? "AI Provider ยังไม่พร้อมใช้งานครับ (ยังไม่มี provider ที่ตั้งค่า key ไว้ในระบบ) — ลองใหม่หลังตั้งค่าคีย์ใน Environment ครับ"
    : /401|authentication_error|invalid x-api-key|API key/i.test(String(reason))
      ? `ผู้ให้บริการ AI ยังไม่ยืนยันตัวตน (provider authentication ไม่ผ่าน — ไม่ใช่ปัญหาจากคำสั่งของคุณ) ลองใหม่ภายหลังครับ`
      : `ตอบจาก AI ไม่สำเร็จตอนนี้ครับ (${reason}) ลองใหม่อีกครั้งครับ`;
  return { sender: "ai" as const, type: "text" as const, text };
}

function operatingIntent(input: string, sessionKey?: string | null): EnrichedInput {
  const memory = getMemory(sessionKey);
  // Real incident (owner, 2026-07-31): \S+ stops at the first whitespace, so
  // "ออกบิลให้คุณบจก. เคแพค คอนกรีต 2004 (สำราญ)" only ever captured "บจก."
  // — a prefix shared by every company name, which then resolved ambiguously
  // and (via resolveCustomer's fallback below) produced an invoice for a
  // completely different, previously-active company. Capture the rest of
  // the phrase instead, trimming trailing politeness particles a Thai name
  // never ends with.
  const nameMatch = input.match(/คุณ\s*(.+)/);
  const who = nameMatch ? nameMatch[1].replace(/\s*(ครับ|ค่ะ|นะครับ|นะคะ|หน่อยครับ|หน่อยค่ะ|หน่อย|ด้วยครับ|ด้วยค่ะ|ด้วย)\s*$/, "").trim() || null : null;
  const isNewSession = !!who && who !== memory.who;
  const clean = input.replace(/คุณ\s*\S+/, "").replace(/กลับไป/, "").trim();
  let matched: string | null = null;
  let bestLen = 0;

  for (const [intent, phrases] of Object.entries(INTENT_CATALOG)) {
    for (const phrase of phrases) {
      if ((input.includes(phrase) || clean.includes(phrase)) && phrase.length > bestLen) {
        matched = intent;
        bestLen = phrase.length;
      }
    }
  }

  let intentType: EnrichedInput["intent_type"] = "business";
  let action: string | null = null;
  let what: string | null = null;

  if (/^(ล้าง|เคลียร์|clear)$/.test(input.trim())) intentType = "navigation";
  else if (/^(ใช่|ได้|ตกลง|โอเค|ไม่เอา|ยกเลิก|ไม่|ไม่ต้อง)$/.test(input.trim())) intentType = "feedback";
  else if (/กลับไป/.test(input) && who) intentType = "business";
  else if (matched && WORKFLOW_INTENTS.has(matched)) { intentType = "workflow"; what = matched; }
  else if (matched && TRANSPORT_INTENTS.has(matched)) { intentType = "transport"; what = matched === "send_line" ? "line" : null; }
  else if (matched === "navigation") intentType = "navigation";
  else if (matched?.startsWith("create_")) { action = "create"; what = matched.replace("create_", ""); }
  else if (matched?.startsWith("review_")) { action = "view"; what = matched.replace("review_", ""); }

  if (isNewSession && who) newSession(who, sessionKey);

  return {
    who: who ?? (!isNewSession ? memory.who : null),
    what: what ?? (clean || null),
    action,
    detail: null,
    intent_type: intentType,
    intent_id: matched,
    is_new_session: isNewSession,
    raw_input: input,
  };
}

// Real Entity-Enrichment Layer (owner, 2026-07-30): "ของมันมีอยู่ ไม่เอามาใช้
// อ่ะ...เอามาเพื่อกลั่นกรองวิเคราะห์ให้มันละเอียดขึ้น" — services/ai/
// translator.ts was written but never wired in (confirmed via grep: zero
// importers anywhere). It cannot sit as a hard first-pass GATE (its own
// CHECK_PRICE pattern — "ราคา"/"เท่าไหร่" — is the exact same trigger text
// as the fuel-price/exchange-rate checks in answerExternalFact() above, so
// forcing it in front would hijack those and misclassify "ราคาน้ำมัน" as a
// construction-material price lookup). Its real, safe value is the entity
// extraction operatingIntent() above doesn't do (product/quantity/customer
// name) — used here ONLY to fill in gaps operatingIntent left null, never to
// override or short-circuit anything it already determined.
function enrichWithTranslator(enriched: EnrichedInput, rawMessage: string): EnrichedInput {
  const translated = translateEntities(rawMessage);
  if (!translated.ok) return enriched; // nothing extra to add — leave as-is

  // Real bug, owner-reported 2026-07-30: the guard `enriched.action ? enriched.what : null`
  // treated "no action matched" (a perfectly normal state for a plain
  // question like "ราคาทรายหยาบกับทรายละเอียดคิวละเท่าไหร่") as "what is
  // empty," discarding the already-good full sentence and replacing it with
  // just the translator's single extracted noun ("ทราย") — losing
  // "ทรายละเอียด" entirely. Fixed: only ever fill `what` when it was
  // genuinely null, never override an existing value.
  const { entities } = translated;
  return {
    ...enriched,
    who: enriched.who ?? entities.customer ?? null,
    what: enriched.what ?? entities.product ?? null,
    detail: enriched.detail ?? (entities.quantity ? `${entities.quantity} ${entities.unit ?? ""}`.trim() : null),
  };
}

// Owner, 2026-07-17, Architecture Correction: AI must not import
// services/supabase/queries or engines directly — only call named DNA OS
// capabilities through the same registry-gated dispatcher every other AI
// path uses (see cognitive/executor/index.ts's dispatchToData). Swallows a
// failed/empty dispatch into [], matching the .catch(() => []) behavior of
// the raw calls this replaces.
async function dispatchList(command: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>[]> {
  const dispatched = await dispatchCommand(command, payload).catch(() => null);
  if (!dispatched?.ok || !dispatched.data) return [];
  return Array.isArray(dispatched.data) ? dispatched.data as Record<string, unknown>[] : [dispatched.data as Record<string, unknown>];
}

async function fetchForSituation(who: string | null, what: string | null): Promise<Record<string, unknown[]>> {
  const results: Record<string, unknown[]> = {};

  if (who) {
    const [partners, trackings, debts, docs, jobs] = await Promise.all([
      dispatchList("partner.list"),
      dispatchList("debt.trackings"),
      dispatchList("debt.list"),
      dispatchList("document.list"),
      dispatchList("job.list"),
    ]);
    const needle = who.toLowerCase();
    const matchedDocs = docs.filter((doc) => String(doc.party_name ?? "").toLowerCase().includes(needle));

    results.partners = partners.filter((partner) => String(partner.name ?? "").toLowerCase().includes(needle));
    results.debt_trackings = trackings.filter((tracking) => String(tracking.customer_name ?? "").toLowerCase().includes(needle));
    results.invoice_debts = debts
      .map((debt) => ({ ...debt, customer_name: matchedDocs.find((doc) => doc.id === debt.document_id)?.party_name ?? "" }))
      .filter((debt) => String(debt.customer_name ?? "").toLowerCase().includes(needle));
    results.documents = matchedDocs;
    results.jobs = jobs.filter((job) =>
      String(job.project_name ?? "").toLowerCase().includes(needle) ||
      String(job.contact_name ?? "").toLowerCase().includes(needle)
    );
  } else if (what) {
    if (["debt", "invoice_debts"].includes(what)) results.invoice_debts = await dispatchList("debt.list");
    if (["customer", "partner", "supplier"].includes(what)) results.partners = await dispatchList("partner.list");
    if (what === "job") results.jobs = await dispatchList("job.list");
    if (what === "material") results.material_types = await dispatchList("material.list");
    if (["document", "invoice", "quotation", "boq", "receipt"].includes(what)) {
      const command = what === "document" ? "document.list" : what === "invoice" ? "invoice.list" : what === "quotation" ? "document.boq" : what === "receipt" ? "document.receipt" : "document.list";
      results.documents = await dispatchList(command);
    }
  }

  return Object.fromEntries(Object.entries(results).filter(([, rows]) => rows.length > 0));
}

function toSession(memory: ReturnType<typeof getMemory>): Session {
  return {
    who: memory.who,
    who_id: memory.who_id,
    current_goal: memory.current_goal,
    current_workspace: null,
    current_business_object: null,
    current_task: null,
    pending_actions: memory.pending_actions,
    confidence: 0,
    open_questions: [],
    last_tool_results: Object.values(memory.last_results),
    history: memory.previous_goals,
  };
}

function toGoal(input: EnrichedInput): Goal {
  return {
    who: input.who,
    what: input.what,
    action: input.intent_type === "workflow" ? "workflow" : input.intent_type === "transport" ? "transport" : input.action,
    detail: input.detail,
    is_continuation: !input.is_new_session,
    is_general: input.intent_type === "general",
    raw_input: input.raw_input,
  };
}

function step(
  id: number,
  tool: string,
  args_template: Record<string, string>,
  depends_on: number | null = null,
  parallel_with: number[] = [],
  optional = false,
  retryable = true,
  on_fail: "abort" | "skip" | "retry" | "ask_user" = "abort",
): WorkflowDefinition["steps"][number] {
  return {
    id,
    tool,
    args_template,
    depends_on,
    parallel_with,
    optional,
    retryable,
    timeout: 10000,
    on_fail,
    on_no_result: "abort",
    condition: null,
  };
}
