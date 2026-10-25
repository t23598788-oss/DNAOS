/**
 * DNA OS — Objective Manager
 *
 * Pure Function — ไม่ Query DB, ไม่เรียก Tool, ไม่ทำ Reasoning
 *
 * หน้าที่เดียว:
 *   รับ Operating Intent + Session → กำหนด Objective → ส่งให้ Reasoning
 *
 * Input:  enriched_input + session
 * Output: Objective (immutable)
 */

import { createObjective, type Objective, type SessionSnapshot } from "./contract";

// ── Input Types ──

export interface EnrichedInput {
  who: string | null;
  what: string | null;
  action: string | null;
  detail: string | null;
  intent_type: "business" | "workflow" | "transport" | "navigation" | "conversation" | "feedback" | "general";
  intent_id: string | null;
  is_new_session: boolean;
  raw_input: string;
}

export interface Session {
  who: string | null;
  who_id: string | null;
  current_goal: string | null;
  current_workspace: string | null;
  current_business_object: { type: string; id: string | null; name: string | null } | null;
  current_task: string | null;
  pending_actions: string[];
  confidence: number;
  open_questions: string[];
  last_tool_results: unknown[];
  history: string[];
}

// ── Vocabulary → Objective Type Mapping ──

const OBJECTIVE_MAP: Record<string, string> = {
  debt: "review_debt",
  invoice: "review_invoice",
  quotation: "review_quotation",
  boq: "review_boq",
  job: "review_job",
  partner: "review_partner",
  customer: "review_customer",
  material: "review_material",
  document: "review_document",
};

const ACTION_MAP: Record<string, string> = {
  view: "review",
  create: "create",
  delete: "delete",
  edit: "edit",
  send: "execute_action",
  repeat: "continue_workflow",
  clear: "navigation",
  back: "navigation",
};

const VOCABULARY: Record<string, string> = {
  "โรงโม่": "partner", "โม่หิน": "partner", "บ่อทราย": "partner", "บ่อดิน": "partner",
  "บิล": "invoice", "ใบแจ้งหนี้": "invoice", "ใบเสนอราคา": "quotation", "boq": "boq", "BOQ": "boq", "ใบประมาณปริมาณงาน": "boq",
  "ค้างจ่าย": "debt", "ค้าง": "debt", "หนี้": "debt", "ลูกหนี้": "debt", "ทวงหนี้": "debt",
  "งาน": "job", "จัดส่ง": "job", "โปรเจกต์": "job",
  "วัสดุ": "material", "หิน": "material", "ทราย": "material", "ดิน": "material",
  "ลูกค้า": "customer", "เอกสาร": "document",
};

// Real bug, owner-reported 2026-07-30: "พนักงาน" (employee) got matched to
// "job" here — "งาน" is a blind substring of "พนักงาน". Same class of bug
// as cognitive/reasoning/engine.ts's own (separately duplicated — known
// architectural debt, not yet unified) vocabulary scan; fixed the same way
// in both.
const VOCAB_NEGATIVE_LOOKBEHIND: Record<string, RegExp> = {
  "งาน": /(?<!พนัก)งาน/,
};
function matchesVocabWord(raw: string, word: string): boolean {
  const guard = VOCAB_NEGATIVE_LOOKBEHIND[word];
  return guard ? guard.test(raw) : raw.includes(word);
}

const BUSINESS_OBJECTS: Record<string, string[]> = {
  customer: ["customer", "debt", "invoice", "job"],
  debt: ["customer", "debt", "invoice", "payment"],
  invoice: ["customer", "invoice", "debt"],
  quotation: ["customer", "quotation", "material"],
  boq: ["customer", "boq", "material"],
  job: ["customer", "job", "material"],
  partner: ["partner", "material"],
  material: ["material", "partner"],
  document: ["document", "customer"],
};

const OUTCOMES: Record<string, string> = {
  review: "workspace_with_data",
  create: "document_created",
  delete: "record_deleted",
  edit: "record_updated",
  execute_action: "action_executed",
  continue_workflow: "workflow_continued",
  navigation: "screen_changed",
};

// ── Core Function ──

export function resolveObjective(input: EnrichedInput, session: Session): Objective {
  const snapshot: SessionSnapshot = {
    who: session.who,
    who_id: session.who_id,
    current_goal: session.current_goal,
    current_workspace: session.current_workspace,
    current_business_object: session.current_business_object,
    pending_actions: session.pending_actions,
    last_tool_results: session.last_tool_results,
    history: session.history,
  };

  // ── Navigation ──
  if (input.intent_type === "navigation") {
    return createObjective({
      type: "navigation",
      scope: "session",
      priority: 1,
      businessObjects: [],
      who: null,
      who_id: null,
      expectedOutcome: "screen_changed",
      raw_input: input.raw_input,
      context: snapshot,
      constraints: [],
      success_criteria: ["หน้าจอเปลี่ยนตามคำสั่ง"],
    });
  }

  // ── General question ──
  if (input.intent_type === "general") {
    return createObjective({
      type: "general_question",
      scope: "global",
      priority: 3,
      businessObjects: [],
      who: null,
      who_id: null,
      expectedOutcome: "answer_provided",
      raw_input: input.raw_input,
      context: snapshot,
      constraints: ["ใช้ Domain Knowledge ก่อน General Knowledge"],
      success_criteria: ["ตอบคำถามได้"],
    });
  }

  // ── Feedback (ใช่/ไม่/อันบน) ──
  if (input.intent_type === "feedback") {
    return createObjective({
      type: "process_feedback",
      scope: "session",
      priority: 1,
      businessObjects: session.current_business_object ? [session.current_business_object.type] : [],
      who: session.who,
      who_id: session.who_id,
      expectedOutcome: "action_executed",
      raw_input: input.raw_input,
      context: snapshot,
      constraints: ["ใช้ pending_actions จาก session"],
      success_criteria: ["ดำเนินการตาม feedback"],
    });
  }

  // ── Workflow intent → ส่งชื่อ workflow ตรงไป Workflow Registry จัดการ ──
  if (input.intent_type === "workflow") {
    const who = input.who ?? session.who;
    return createObjective({
      type: input.intent_id ?? input.what ?? "unknown",
      scope: "session",
      priority: 1,
      businessObjects: [],
      who,
      who_id: input.is_new_session ? null : session.who_id,
      expectedOutcome: "workflow_completed",
      raw_input: input.raw_input,
      context: snapshot,
      constraints: who && session.who_id ? ["ห้าม resolve ซ้ำ — ใช้ who_id จาก session"] : [],
      success_criteria: ["รัน workflow ครบทุก step", "เสนอ Action ถัดไป"],
    });
  }

  // ── Transport intent → ขนส่งผลลัพธ์ (LINE/Email/PDF) ──
  if (input.intent_type === "transport") {
    return createObjective({
      type: input.intent_id ?? "transport",
      scope: "session",
      priority: 1,
      businessObjects: [],
      who: input.who ?? session.who,
      who_id: input.is_new_session ? null : session.who_id,
      expectedOutcome: "action_executed",
      raw_input: input.raw_input,
      context: snapshot,
      constraints: session.pending_actions.length > 0 ? ["ใช้ pending_actions จาก session"] : [],
      success_criteria: ["ส่งสำเร็จ"],
    });
  }

  // ── Conversation (ใช่/ไม่/อันบน/กลับไป) ──
  if (input.intent_type === "conversation") {
    return createObjective({
      type: "process_feedback",
      scope: "session",
      priority: 1,
      businessObjects: session.current_business_object ? [session.current_business_object.type] : [],
      who: session.who,
      who_id: session.who_id,
      expectedOutcome: "action_executed",
      raw_input: input.raw_input,
      context: snapshot,
      constraints: ["ใช้ pending_actions จาก session"],
      success_criteria: ["ดำเนินการตาม feedback"],
    });
  }

  // ── Business ──
  const who = input.who ?? session.who;
  const who_id = input.is_new_session ? null : session.who_id;

  // Resolve what → domain object
  let domain = input.what ? (VOCABULARY[input.what] ?? input.what) : null;
  if (!domain && input.raw_input) {
    for (const [word, obj] of Object.entries(VOCABULARY)) {
      if (matchesVocabWord(input.raw_input, word)) { domain = obj; break; }
    }
  }

  // Resolve action
  const actionKey = input.action ? (ACTION_MAP[input.action] ?? input.action) : null;

  // Build objective type
  let type: string;
  if (actionKey && domain) {
    type = `${actionKey}_${domain}`;
  } else if (actionKey && !domain) {
    type = actionKey === "execute_action" ? "execute_pending" : actionKey === "continue_workflow" ? "continue_workflow" : "unknown";
  } else if (!actionKey && domain) {
    type = OBJECTIVE_MAP[domain] ?? `review_${domain}`;
  } else if (who && !domain && !actionKey) {
    type = "open_profile";
    domain = "customer";
  } else {
    type = "unknown";
  }

  // Business objects
  const biz = domain ? (BUSINESS_OBJECTS[domain] ?? [domain]) : who ? BUSINESS_OBJECTS["customer"] : [];

  // Expected outcome
  const outcome = OUTCOMES[actionKey ?? "review"] ?? "workspace_with_data";

  // Priority
  let priority = 2;
  if (actionKey === "create" || actionKey === "delete") priority = 1;
  if (type === "open_profile") priority = 2;
  if (type === "unknown") priority = 3;

  // Constraints from Rules
  const constraints: string[] = [];
  if (who_id) constraints.push("ห้าม resolve ซ้ำ — ใช้ who_id จาก session");
  if (session.last_tool_results.length > 0) constraints.push("ตรวจ last_tool_results ก่อนเรียก Tool ซ้ำ");
  if (!input.is_new_session) constraints.push("ใช้ Session ก่อน Query ใหม่");

  // Success criteria from Behavior
  const success_criteria: string[] = ["ไม่ถามข้อมูลที่มีอยู่แล้ว"];
  if (actionKey === "review" || type === "open_profile") {
    success_criteria.push("แสดงข้อมูลครบตาม Domain");
    success_criteria.push("เสนอ Action ถัดไป");
  }
  if (actionKey === "create") {
    success_criteria.push("สร้างเอกสารด้วยข้อมูลจาก DB");
    success_criteria.push("ไม่ถามข้อมูลที่คำนวณได้");
  }

  return createObjective({
    type,
    scope: input.is_new_session ? "global" : "session",
    priority,
    businessObjects: biz,
    who,
    who_id,
    expectedOutcome: outcome,
    raw_input: input.raw_input,
    context: snapshot,
    constraints,
    success_criteria,
  });
}
