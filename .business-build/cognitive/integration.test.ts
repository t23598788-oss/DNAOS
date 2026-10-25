/**
 * DNA OS Cognitive Integration Test
 *
 * End-to-End test ของ Pipeline ทั้งเส้น
 * Operating Intent → Intent Catalog → Objective → Reasoning → Planner → Mock Executor → Workspace
 *
 * ไม่เรียก Database / Supabase / API
 * Executor เป็น Mock ทั้งหมด
 * พิสูจน์ว่า Cognitive Pipeline ทำงานถูกต้อง
 */

import { resolveObjective, type EnrichedInput, type Session } from "./objective/manager";
import { reason, type Goal } from "./reasoning/engine";
import { plan, type Decision, type WorkflowDefinition } from "./planner/engine";
import type { Objective } from "./objective/contract";

// ═══════════════════════════════════════
// INTENT CATALOG
// ═══════════════════════════════════════

const INTENT_CATALOG: Record<string, string[]> = {
  "open_profile":         ["เปิดลูกค้า", "ดูลูกค้า", "ข้อมูลลูกค้า"],
  "review_debt":          ["ดูหนี้", "หนี้", "ลูกหนี้", "ค้างจ่าย", "ค้าง"],
  "collect_debt":         ["ทวงเงิน", "เก็บเงิน", "ตามหนี้", "ทวงหนี้"],
  "create_invoice":       ["ออกบิล", "สร้างใบแจ้งหนี้", "ทำบิล", "ออกใบแจ้งหนี้"],
  "review_partner":       ["โรงโม่", "บ่อทราย", "ดูคู่ค้า"],
  "review_material":      ["ดูวัสดุ", "วัสดุ"],
  "review_job":           ["ดูงาน", "งาน"],
  "send_line":            ["ส่ง LINE", "ส่งไลน์"],
  "execute_pending":      ["ส่งเลย", "ทำเลย"],
  "continue_workflow":    ["เหมือนเดิม", "ลองใหม่"],
  "navigation":           ["ล้าง", "ย้อนกลับ", "กลับ"],
};

// ═══════════════════════════════════════
// WORKFLOW REGISTRY
// ═══════════════════════════════════════

const WORKFLOWS: Record<string, WorkflowDefinition> = {
  open_profile: {
    id: "open_profile", trigger: ["open_profile"],
    required_business_objects: ["customer"], required_inputs: [{ field: "who", source: "session", ask_if_missing: "" }],
    steps: [
      { id: 0, tool: "identity.resolve", args_template: { name: "$who" }, depends_on: null, parallel_with: [], optional: false, retryable: true, timeout: 5000, on_fail: "abort", on_no_result: "abort", condition: "$result.length === 1" },
      { id: 1, tool: "debt.query", args_template: { customer_id: "$0.id" }, depends_on: 0, parallel_with: [2], optional: false, retryable: true, timeout: 5000, on_fail: "retry", on_no_result: "skip", condition: null },
      { id: 2, tool: "document.query", args_template: { customer_id: "$0.id" }, depends_on: 0, parallel_with: [1], optional: true, retryable: true, timeout: 5000, on_fail: "skip", on_no_result: "skip", condition: null },
    ],
    possible_next_workflows: ["create_invoice", "collect_debt"], rollback_strategy: "skip_failed",
  },
  review_debt: {
    id: "review_debt", trigger: ["review_debt"],
    required_business_objects: ["debt"], required_inputs: [{ field: "who", source: "session", ask_if_missing: "ดูหนี้ของใครครับ" }],
    steps: [
      { id: 0, tool: "identity.resolve", args_template: { name: "$who" }, depends_on: null, parallel_with: [], optional: false, retryable: true, timeout: 5000, on_fail: "abort", on_no_result: "abort", condition: null },
      { id: 1, tool: "debt.query", args_template: { customer_id: "$0.id" }, depends_on: 0, parallel_with: [], optional: false, retryable: true, timeout: 5000, on_fail: "retry", on_no_result: "skip", condition: null },
    ],
    possible_next_workflows: ["collect_debt", "create_invoice"], rollback_strategy: "skip_failed",
  },
  create_invoice: {
    id: "create_invoice", trigger: ["create_invoice"],
    required_business_objects: ["invoice"], required_inputs: [{ field: "who", source: "session", ask_if_missing: "ออกบิลให้ใครครับ" }],
    steps: [
      { id: 0, tool: "identity.resolve", args_template: { name: "$who" }, depends_on: null, parallel_with: [], optional: false, retryable: true, timeout: 5000, on_fail: "abort", on_no_result: "abort", condition: null },
      { id: 1, tool: "debt.query", args_template: { customer_id: "$0.id" }, depends_on: 0, parallel_with: [], optional: false, retryable: true, timeout: 5000, on_fail: "abort", on_no_result: "ask_user", condition: null },
      { id: 2, tool: "invoice.create", args_template: { customer_id: "$0.id", amount: "$1.total" }, depends_on: 1, parallel_with: [], optional: false, retryable: false, timeout: 10000, on_fail: "abort", on_no_result: "abort", condition: null },
    ],
    possible_next_workflows: ["send_line"], rollback_strategy: "abort",
  },
  collect_debt: {
    id: "collect_debt", trigger: ["collect_debt"],
    required_business_objects: ["debt"], required_inputs: [{ field: "who", source: "session", ask_if_missing: "ทวงหนี้ใครครับ" }],
    steps: [
      { id: 0, tool: "identity.resolve", args_template: { name: "$who" }, depends_on: null, parallel_with: [], optional: false, retryable: true, timeout: 5000, on_fail: "abort", on_no_result: "abort", condition: null },
      { id: 1, tool: "debt.query", args_template: { customer_id: "$0.id" }, depends_on: 0, parallel_with: [], optional: false, retryable: true, timeout: 5000, on_fail: "abort", on_no_result: "abort", condition: null },
      { id: 2, tool: "debt_notice.create", args_template: { customer_id: "$0.id", amount: "$1.total" }, depends_on: 1, parallel_with: [], optional: false, retryable: false, timeout: 10000, on_fail: "abort", on_no_result: "abort", condition: null },
    ],
    possible_next_workflows: ["send_line"], rollback_strategy: "abort",
  },
  send_line: {
    id: "send_line", trigger: ["send_line", "execute_pending"],
    required_business_objects: [], required_inputs: [{ field: "who", source: "session", ask_if_missing: "" }],
    steps: [
      { id: 0, tool: "line.send", args_template: { customer_id: "$who_id" }, depends_on: null, parallel_with: [], optional: false, retryable: true, timeout: 10000, on_fail: "retry", on_no_result: "abort", condition: null },
    ],
    possible_next_workflows: [], rollback_strategy: "retry_last",
  },
  review_partner: {
    id: "review_partner", trigger: ["review_partner"],
    required_business_objects: ["partner"], required_inputs: [],
    steps: [
      { id: 0, tool: "partner.list", args_template: {}, depends_on: null, parallel_with: [], optional: false, retryable: true, timeout: 5000, on_fail: "retry", on_no_result: "skip", condition: null },
    ],
    possible_next_workflows: [], rollback_strategy: "retry_last",
  },
  navigation: {
    id: "navigation", trigger: ["navigation"],
    required_business_objects: [], required_inputs: [],
    steps: [],
    possible_next_workflows: [], rollback_strategy: "abort",
  },
  general_question: {
    id: "general_question", trigger: ["general_question"],
    required_business_objects: [], required_inputs: [],
    steps: [
      { id: 0, tool: "ai.answer", args_template: { question: "$raw_input" }, depends_on: null, parallel_with: [], optional: false, retryable: false, timeout: 15000, on_fail: "abort", on_no_result: "abort", condition: null },
    ],
    possible_next_workflows: [], rollback_strategy: "abort",
  },
};

// ═══════════════════════════════════════
// OPERATING INTENT (simplified for test)
// ═══════════════════════════════════════

function operatingIntent(input: string, session: Session): EnrichedInput {
  const nameMatch = input.match(/คุณ\s*(\S+)/);
  const who = nameMatch ? nameMatch[1] : null;
  const isNewSession = !!who && who !== session.who;
  const cleanInput = input.replace(/คุณ\s*\S+/, "").replace(/กลับไป/, "").trim();

  // ── Intent Catalog: longest match first ──
  let matchedIntent: string | null = null;
  let bestLen = 0;
  for (const [intent, phrases] of Object.entries(INTENT_CATALOG)) {
    for (const phrase of phrases) {
      if ((input.includes(phrase) || cleanInput.includes(phrase)) && phrase.length > bestLen) {
        matchedIntent = intent;
        bestLen = phrase.length;
      }
    }
  }

  // ── Operating Intent classifies intent_type completely ──
  // Reasoning จะไม่ classify ซ้ำ — รับ intent_type ที่เสร็จแล้ว

  let intent_type: EnrichedInput["intent_type"] = "business";
  const intent_id: string | null = matchedIntent;
  let action: string | null = null;
  let what: string | null = null;

  // Navigation
  if (/^(ล้าง|เคลียร์|clear)$/.test(input.trim())) {
    intent_type = "navigation";
  }
  // Conversation (ใช่/ไม่/อันบน/กลับไป)
  else if (/^(ใช่|ได้|ตกลง|โอเค|ไม่เอา|ยกเลิก|ไม่|ไม่ต้อง)$/.test(input.trim())) {
    intent_type = "conversation";
  }
  // "กลับไป" + ชื่อ → business (open profile)
  else if (/กลับไป/.test(input) && who) {
    intent_type = "business";
  }
  // Workflow intents
  else if (matchedIntent === "collect_debt" || matchedIntent === "continue_workflow") {
    intent_type = "workflow";
    what = matchedIntent;
  }
  // Transport intents
  else if (matchedIntent === "send_line" || matchedIntent === "execute_pending") {
    intent_type = "transport";
    what = matchedIntent === "send_line" ? "line" : null;
  }
  // Navigation intents
  else if (matchedIntent === "navigation") {
    intent_type = "navigation";
  }
  // Business intents
  else if (matchedIntent) {
    intent_type = "business";
    if (matchedIntent.startsWith("create_")) { action = "create"; what = matchedIntent.replace("create_", ""); }
    else if (matchedIntent.startsWith("review_")) { action = "view"; what = matchedIntent.replace("review_", ""); }
  }

  const resolvedWho = who ?? (!isNewSession ? session.who : null);

  return {
    who: resolvedWho,
    what: what ?? (cleanInput || null),
    action,
    detail: null,
    intent_type,
    intent_id: matchedIntent,
    is_new_session: isNewSession || (!session.who && !!who),
    raw_input: input,
  };
}

// ═══════════════════════════════════════
// GOAL ADAPTER (EnrichedInput → Goal for Reasoning)
// ═══════════════════════════════════════

function toGoal(enriched: EnrichedInput): Goal {
  return {
    who: enriched.who,
    what: enriched.what,
    action: enriched.action,
    detail: enriched.detail,
    is_continuation: !enriched.is_new_session,
    is_general: enriched.intent_type === "general",
    raw_input: enriched.raw_input,
  };
}

// ═══════════════════════════════════════
// FULL PIPELINE
// ═══════════════════════════════════════

interface PipelineResult {
  enriched: EnrichedInput;
  objective: Objective;
  decision: Decision;
  executionPlan: ReturnType<typeof plan>;
  session: Session;
}

function emptySession(): Session {
  return { who: null, who_id: null, current_goal: null, current_workspace: null, current_business_object: null, current_task: null, pending_actions: [], confidence: 0, open_questions: [], last_tool_results: [], history: [] };
}

function runPipeline(input: string, session: Session): PipelineResult {
  // 1. Operating Intent
  const enriched = operatingIntent(input, session);

  // 2. Objective Manager
  const objective = resolveObjective(enriched, session);

  // 3. Reasoning
  const goal = toGoal(enriched);
  const reasonResult = reason(goal, session);

  // 4. Adapt Reasoning output → Decision
  const decision: Decision = {
    decision: reasonResult.decision,
    tools_needed: reasonResult.plan.map(s => s.tool),
    execution_mode: reasonResult.plan.length > 1 ? "parallel" : "sequential",
    ask_user: reasonResult.need_more_info,
    workspace_action: reasonResult.workspace_action,
    next_actions: reasonResult.next_actions,
  };

  // 5. Planner
  const executionPlan = plan(decision, objective, WORKFLOWS);

  // 5. Mock session update
  const newSession: Session = {
    ...session,
    who: enriched.who ?? session.who,
    who_id: session.who_id,
    current_goal: objective.type,
    history: [...session.history, input],
    pending_actions: executionPlan.next_possible_actions,
  };

  if (enriched.is_new_session && enriched.who) {
    newSession.who = enriched.who;
    newSession.who_id = null;
  }

  return { enriched, objective, decision, executionPlan, session: newSession };
}

// ═══════════════════════════════════════
// SCENARIOS
// ═══════════════════════════════════════

let passed = 0;
let failed = 0;

function test(name: string, check: () => string | null) {
  const err = check();
  if (!err) { console.log(`✓ ${name}`); passed++; }
  else { console.log(`✗ ${name}: ${err}`); failed++; }
}

// ── Scenario 1: "คุณเท่ห์" → เปิดข้อมูลทั้งหมด ──

let session = emptySession();
let result = runPipeline("คุณเท่ห์", session);
session = result.session;

test("S1: คุณเท่ห์ → objective = open_profile", () =>
  result.objective.type !== "open_profile" ? `type: ${result.objective.type}` : null
);
test("S1: who = เท่ห์", () =>
  result.objective.who !== "เท่ห์" ? `who: ${result.objective.who}` : null
);
test("S1: plan มี identity.resolve", () =>
  !result.executionPlan.steps.some(s => s.tool === "identity.resolve") ? "no identity.resolve" : null
);
test("S1: plan มี debt.query", () =>
  !result.executionPlan.steps.some(s => s.tool === "debt.query") ? "no debt.query" : null
);
test("S1: workspace = open", () =>
  result.executionPlan.workspace_action !== "open" ? `workspace: ${result.executionPlan.workspace_action}` : null
);

// ── Scenario 2: "ออกใบแจ้งหนี้" ต่อจาก S1 ──

// Simulate: executor resolved who_id
session.who_id = "uuid-001";

result = runPipeline("ออกใบแจ้งหนี้", session);
session = result.session;

test("S2: ออกบิล → objective = create_invoice", () =>
  result.objective.type !== "create_invoice" ? `type: ${result.objective.type}` : null
);
test("S2: ใช้ who จาก session = เท่ห์", () =>
  result.objective.who !== "เท่ห์" ? `who: ${result.objective.who}` : null
);
test("S2: skip identity.resolve (มี who_id)", () =>
  result.executionPlan.steps.some(s => s.tool === "identity.resolve") ? "should skip" : null
);
test("S2: ask_user = null (ไม่ถาม)", () =>
  result.executionPlan.ask_user !== null ? `ask: ${result.executionPlan.ask_user}` : null
);

// ── Scenario 3: "ส่ง LINE" ──

result = runPipeline("ส่ง LINE", session);
session = result.session;

test("S3: ส่ง LINE → plan มี tool", () =>
  result.executionPlan.steps.length === 0 && !result.executionPlan.ask_user ? "no plan" : null
);

// ── Scenario 4: "ยกเลิก" ──

session.pending_actions = ["ส่ง LINE ใบแจ้งหนี้"];
session.open_questions = ["ยืนยันส่งไหม"];

result = runPipeline("ยกเลิก", session);

test("S4: ยกเลิก → type = feedback/navigation", () =>
  result.enriched.intent_type !== "conversation" && result.enriched.intent_type !== "feedback" && result.enriched.intent_type !== "navigation" ? `type: ${result.enriched.intent_type}` : null
);

// ── Scenario 5: "คุณสมชาย" → session ใหม่ ──

result = runPipeline("คุณสมชาย", session);
session = result.session;

test("S5: คุณสมชาย → who = สมชาย", () =>
  result.objective.who !== "สมชาย" ? `who: ${result.objective.who}` : null
);
test("S5: is_new_session = true", () =>
  !result.enriched.is_new_session ? "should be new session" : null
);
test("S5: session.who เปลี่ยนเป็น สมชาย", () =>
  session.who !== "สมชาย" ? `session.who: ${session.who}` : null
);

// ── Scenario 6: "กลับไปคุณเท่ห์" ──

result = runPipeline("กลับไปคุณเท่ห์", session);

test("S6: กลับไปเท่ห์ → who = เท่ห์", () =>
  result.objective.who !== "เท่ห์" ? `who: ${result.objective.who}` : null
);

// ── Scenario 7: "หนี้" ไม่มี who → ใช้ session ──

session = { ...emptySession(), who: "เท่ห์", who_id: "uuid-001" };

result = runPipeline("หนี้", session);

test("S7: หนี้ + session.who → ไม่ถาม", () =>
  result.executionPlan.ask_user !== null ? `ask: ${result.executionPlan.ask_user}` : null
);
test("S7: who มาจาก session", () =>
  result.objective.who !== "เท่ห์" ? `who: ${result.objective.who}` : null
);

// ── Scenario 8: "ทวงหนี้" → workflow detection ──

session = { ...emptySession(), who: "เท่ห์", who_id: "uuid-001" };

result = runPipeline("ทวงหนี้", session);

test("S8: ทวงหนี้ → plan มี debt_notice.create", () =>
  !result.executionPlan.steps.some(s => s.tool === "debt_notice.create") && !result.executionPlan.ask_user
    ? "no debt_notice step and no ask" : null
);

// ── Scenario 9: "สร้างใบแจ้งหนี้" → auto advance ──

session = { ...emptySession(), who: "เท่ห์", who_id: "uuid-001" };

result = runPipeline("สร้างใบแจ้งหนี้", session);

test("S9: สร้างใบแจ้งหนี้ → workspace = replace", () =>
  result.executionPlan.workspace_action !== "replace" ? `workspace: ${result.executionPlan.workspace_action}` : null
);
test("S9: next_actions มี send_line", () =>
  !result.executionPlan.next_possible_actions.some(a => a.includes("send") || a.includes("LINE")) ? "no send" : null
);

// ── Scenario 10: "ใช่" → process feedback ──

session = { ...emptySession(), who: "เท่ห์", who_id: "uuid-001", pending_actions: ["ส่ง LINE ใบแจ้งหนี้"], open_questions: ["ส่ง LINE ไหม"] };

result = runPipeline("ใช่", session);

test("S10: ใช่ → type = feedback", () =>
  result.enriched.intent_type !== "conversation" && result.enriched.intent_type !== "feedback" ? `type: ${result.enriched.intent_type}` : null
);
test("S10: objective = process_feedback", () =>
  result.objective.type !== "process_feedback" ? `type: ${result.objective.type}` : null
);

// ═══════════════════════════════════════

console.log(`\n${passed}/${passed + failed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
