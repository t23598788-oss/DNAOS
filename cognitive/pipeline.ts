import OpenAI from "openai";
import { getDebtTrackings, getDocuments, getJobs, getMaterialTypes, getOpenDebts, getPartners } from "@/services/supabase/queries";
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
let openai: OpenAI | null = null;

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

export async function runCognitivePipeline(message: string): Promise<BoardResponse | { sender: "ai"; type: "command" | "text"; text?: string; command?: string }> {
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

  const enriched = operatingIntent(message);
  const memory = getMemory();

  if (enriched.intent_type === "navigation") {
    resetMemory();
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
  const worldState = enrichWithMemory(rawWorldState);
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

  applyReflection(reflection);

  if (executionPlan.ask_user) {
    return { sender: "ai", type: "text", text: executionPlan.ask_user };
  }

  if (executionPlan.workflow_id === "none") {
    return answerWithAi(message);
  }

  const board = composeBoard(worldState, hypotheses, executionResults, reflection, memory.turn_count + 1);
  board.debug = { ...board.debug, objective: objective.type, workflow: executionPlan.workflow_id, learning: learned };
  return board;
}

async function answerWithAi(message: string) {
  openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const aiRes = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "คุณคือ DNA OS ผู้ช่วยเจ้าของธุรกิจวัสดุก่อสร้าง จ.ขอนแก่น ตอบสั้นกระชับ ภาษาไทย" },
      { role: "user", content: message },
    ],
    temperature: 0.7,
    max_tokens: 300,
  });
  return { sender: "ai" as const, type: "text" as const, text: aiRes.choices[0]?.message?.content ?? "รับทราบครับ" };
}

function operatingIntent(input: string): EnrichedInput {
  const memory = getMemory();
  const nameMatch = input.match(/คุณ\s*(\S+)/);
  const who = nameMatch ? nameMatch[1] : null;
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

  if (isNewSession && who) newSession(who);

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

async function fetchForSituation(who: string | null, what: string | null): Promise<Record<string, unknown[]>> {
  const results: Record<string, unknown[]> = {};

  if (who) {
    const [partners, trackings, debts, docs, jobs] = await Promise.all([
      getPartners().catch(() => []),
      getDebtTrackings().catch(() => []),
      getOpenDebts().catch(() => []),
      getDocuments().catch(() => []),
      getJobs().catch(() => []),
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
    if (["debt", "invoice_debts"].includes(what)) results.invoice_debts = await getOpenDebts().catch(() => []);
    if (["customer", "partner", "supplier"].includes(what)) results.partners = await getPartners().catch(() => []);
    if (what === "job") results.jobs = await getJobs().catch(() => []);
    if (what === "material") results.material_types = await getMaterialTypes().catch(() => []);
    if (["document", "invoice", "quotation", "boq", "receipt"].includes(what)) {
      results.documents = await getDocuments(what === "document" ? undefined : what).catch(() => []);
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
