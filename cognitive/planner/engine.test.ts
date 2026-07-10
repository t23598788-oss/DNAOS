import { plan, type Decision, type WorkflowDefinition, type ExecutionPlan } from "./engine";
import { createObjective, type Objective } from "../objective/contract";

// ── Helpers ──

function obj(o: Partial<Omit<Objective, "id">>): Objective {
  return createObjective({
    type: "unknown", scope: "session", priority: 2, businessObjects: [],
    who: null, who_id: null, expectedOutcome: "workspace_with_data",
    raw_input: "", context: { who: null, who_id: null, current_goal: null, current_workspace: null, current_business_object: null, pending_actions: [], last_tool_results: [], history: [] },
    constraints: [], success_criteria: [], ...o,
  });
}

function dec(o: Partial<Decision>): Decision {
  return { decision: "", tools_needed: [], execution_mode: "sequential", ask_user: null, workspace_action: "open", next_actions: [], ...o };
}

// ── Workflow Registry (test fixture) ──

const REGISTRY: Record<string, WorkflowDefinition> = {
  open_profile: {
    id: "open_profile", trigger: ["open_profile"],
    required_business_objects: ["customer"], required_inputs: [{ field: "who", source: "session", ask_if_missing: "" }],
    steps: [
      { id: 0, tool: "identity.resolve", args_template: { name: "$who" }, depends_on: null, parallel_with: [], optional: false, retryable: true, timeout: 5000, on_fail: "abort", on_no_result: "abort", condition: "$result.length === 1" },
      { id: 1, tool: "debt.query", args_template: { customer_id: "$0.id" }, depends_on: 0, parallel_with: [2, 3], optional: false, retryable: true, timeout: 5000, on_fail: "retry", on_no_result: "skip", condition: null },
      { id: 2, tool: "document.query", args_template: { customer_id: "$0.id" }, depends_on: 0, parallel_with: [1, 3], optional: true, retryable: true, timeout: 5000, on_fail: "skip", on_no_result: "skip", condition: null },
      { id: 3, tool: "job.search", args_template: { name: "$0.name" }, depends_on: 0, parallel_with: [1, 2], optional: true, retryable: true, timeout: 5000, on_fail: "skip", on_no_result: "skip", condition: null },
    ],
    possible_next_workflows: ["create_invoice", "collect_debt"], rollback_strategy: "skip_failed",
  },
  create_invoice: {
    id: "create_invoice", trigger: ["create_invoice"],
    required_business_objects: ["customer", "invoice"], required_inputs: [{ field: "who", source: "session", ask_if_missing: "ออกบิลให้ใครครับ" }],
    steps: [
      { id: 0, tool: "identity.resolve", args_template: { name: "$who" }, depends_on: null, parallel_with: [], optional: false, retryable: true, timeout: 5000, on_fail: "abort", on_no_result: "abort", condition: "$result.length === 1" },
      { id: 1, tool: "debt.query", args_template: { customer_id: "$0.id" }, depends_on: 0, parallel_with: [], optional: false, retryable: true, timeout: 5000, on_fail: "abort", on_no_result: "ask_user", condition: null },
      { id: 2, tool: "invoice.create", args_template: { customer_id: "$0.id", amount: "$1.total" }, depends_on: 1, parallel_with: [], optional: false, retryable: false, timeout: 10000, on_fail: "abort", on_no_result: "abort", condition: null },
    ],
    possible_next_workflows: ["send_line"], rollback_strategy: "abort",
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

// ── Tests ──

const tests: { name: string; decision: Decision; objective: Objective; check: (p: ExecutionPlan) => string | null }[] = [
  {
    name: "01 open_profile: 4 steps, mixed mode",
    decision: dec({ workspace_action: "open" }),
    objective: obj({ type: "open_profile", who: "เท่ห์" }),
    check: p => p.steps.length !== 4 ? `steps: ${p.steps.length}` : p.execution_mode !== "mixed" ? `mode: ${p.execution_mode}` : null,
  },
  {
    name: "02 open_profile + who_id: skip identity.resolve",
    decision: dec({ workspace_action: "open" }),
    objective: obj({ type: "open_profile", who: "เท่ห์", who_id: "uuid-xxx" }),
    check: p => p.steps.some(s => s.tool === "identity.resolve") ? "identity.resolve should be skipped" : p.steps.length !== 3 ? `steps: ${p.steps.length}` : null,
  },
  {
    name: "03 open_profile + who_id: args ใช้ uuid ไม่ใช่ $0.id",
    decision: dec({ workspace_action: "open" }),
    objective: obj({ type: "open_profile", who: "เท่ห์", who_id: "uuid-xxx" }),
    check: p => { const debt = p.steps.find(s => s.tool === "debt.query"); return debt?.args.customer_id !== "uuid-xxx" ? `args: ${debt?.args.customer_id}` : null; },
  },
  {
    name: "04 create_invoice + who: 3 sequential steps",
    decision: dec({ workspace_action: "replace" }),
    objective: obj({ type: "create_invoice", who: "เท่ห์" }),
    check: p => p.steps.length !== 3 ? `steps: ${p.steps.length}` : p.execution_mode !== "sequential" ? `mode: ${p.execution_mode}` : null,
  },
  {
    name: "05 create_invoice + who_id: skip resolve, 2 steps",
    decision: dec({ workspace_action: "replace" }),
    objective: obj({ type: "create_invoice", who: "เท่ห์", who_id: "uuid-xxx" }),
    check: p => p.steps.length !== 2 ? `steps: ${p.steps.length}` : null,
  },
  {
    name: "06 create_invoice ไม่มี who: ask_user",
    decision: dec({ workspace_action: "replace" }),
    objective: obj({ type: "create_invoice" }),
    check: p => !p.ask_user ? "should ask_user" : p.steps.length !== 0 ? `steps should be 0` : null,
  },
  {
    name: "07 decision.ask_user → plan ว่าง",
    decision: dec({ ask_user: "ออกบิลให้ใครครับ", workspace_action: "keep" }),
    objective: obj({ type: "create_invoice" }),
    check: p => p.ask_user !== "ออกบิลให้ใครครับ" ? "wrong ask_user" : p.steps.length !== 0 ? "steps not empty" : null,
  },
  {
    name: "08 review_partner: 1 step",
    decision: dec({ workspace_action: "open" }),
    objective: obj({ type: "review_partner" }),
    check: p => p.steps.length !== 1 ? `steps: ${p.steps.length}` : p.steps[0].tool !== "partner.list" ? `tool: ${p.steps[0].tool}` : null,
  },
  {
    name: "09 navigation: 0 steps",
    decision: dec({ workspace_action: "open" }),
    objective: obj({ type: "navigation" }),
    check: p => p.steps.length !== 0 ? `steps: ${p.steps.length}` : null,
  },
  {
    name: "10 general_question: ai.answer with raw_input",
    decision: dec({ workspace_action: "keep" }),
    objective: obj({ type: "general_question", raw_input: "ราคาทองวันนี้" }),
    check: p => p.steps[0]?.args.question !== "ราคาทองวันนี้" ? `args: ${p.steps[0]?.args.question}` : null,
  },
  {
    name: "11 unknown type: empty plan, no crash",
    decision: dec({}),
    objective: obj({ type: "unknown_xyz" }),
    check: p => p.steps.length !== 0 ? "should be empty" : null,
  },
  {
    name: "12 rollback: identity.resolve → abort",
    decision: dec({}),
    objective: obj({ type: "open_profile", who: "เท่ห์" }),
    check: p => { const rb = p.rollback_plan.find(r => r.if_step_fails === 0); return rb?.action !== "abort" ? `rollback: ${rb?.action}` : null; },
  },
  {
    name: "13 rollback: optional step → skip",
    decision: dec({}),
    objective: obj({ type: "open_profile", who: "เท่ห์" }),
    check: p => { const docStep = p.steps.find(s => s.tool === "document.query"); if (!docStep) return "no doc step"; const rb = p.rollback_plan.find(r => r.if_step_fails === docStep.id); return rb?.action !== "skip" ? `rollback: ${rb?.action}` : null; },
  },
  {
    name: "14 group 0: no dependency",
    decision: dec({}),
    objective: obj({ type: "open_profile", who: "เท่ห์" }),
    check: p => p.steps[0].group !== 0 ? `group: ${p.steps[0].group}` : null,
  },
  {
    name: "15 group 1: depends_on group 0",
    decision: dec({}),
    objective: obj({ type: "open_profile", who: "เท่ห์" }),
    check: p => { const debt = p.steps.find(s => s.tool === "debt.query"); return debt?.group !== 1 ? `group: ${debt?.group}` : null; },
  },
  {
    name: "16 parallel steps in same group",
    decision: dec({}),
    objective: obj({ type: "open_profile", who: "เท่ห์" }),
    check: p => { const g1 = p.steps.filter(s => s.group === 1); return g1.length < 2 ? `parallel count: ${g1.length}` : null; },
  },
  {
    name: "17 workspace_action from decision",
    decision: dec({ workspace_action: "extend" }),
    objective: obj({ type: "review_partner" }),
    check: p => p.workspace_action !== "extend" ? `workspace: ${p.workspace_action}` : null,
  },
  {
    name: "18 next_possible_actions merged",
    decision: dec({ next_actions: ["ส่ง LINE"] }),
    objective: obj({ type: "open_profile", who: "เท่ห์" }),
    check: p => !p.next_possible_actions.includes("ส่ง LINE") ? "missing ส่ง LINE" : !p.next_possible_actions.includes("create_invoice") ? "missing create_invoice" : null,
  },
  {
    name: "19 serializable JSON",
    decision: dec({}),
    objective: obj({ type: "open_profile", who: "เท่ห์" }),
    check: p => { try { JSON.parse(JSON.stringify(p)); return null; } catch { return "not serializable"; } },
  },
  {
    name: "20 metadata correct",
    decision: dec({}),
    objective: obj({ type: "open_profile", who: "เท่ห์" }),
    check: p => p.metadata.total_steps !== 4 ? `total: ${p.metadata.total_steps}` : !p.metadata.has_dependencies ? "no deps" : !p.metadata.has_conditions ? "no conditions" : null,
  },
];

// ── Run ──

let passed = 0;
let failed = 0;

for (const t of tests) {
  const result = plan(t.decision, t.objective, REGISTRY);
  const err = t.check(result);
  if (!err) { console.log(`✓ ${t.name}`); passed++; }
  else { console.log(`✗ ${t.name}: ${err}`); failed++; }
}

console.log(`\n${passed}/${tests.length} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
