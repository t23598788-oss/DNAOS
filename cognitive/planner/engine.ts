/**
 * DNA OS Cognitive Layer — Planner
 *
 * Pure Function — Generic Engine ที่อ่าน Workflow Registry
 * ไม่มี if/else ต่อ workflow
 * ไม่รู้ Business Logic
 * ไม่รู้ Database
 * ไม่รู้ UI
 *
 * Input:  Decision (จาก Reasoning) + Objective + Workflow Registry
 * Output: ExecutionPlan (serializable JSON, replayable)
 *
 * Engine Independence:
 *   Planner ไม่รู้ Supabase, ไม่รู้ Business Rule, ไม่รู้ Domain
 *   Planner อ่าน Workflow definition แล้วแปลงเป็น steps เท่านั้น
 */

import type { Objective } from "../objective/contract";

// ═══════════════════════════════════════
// TYPES
// ═══════════════════════════════════════

export interface Decision {
  decision: string;
  tools_needed: string[];
  execution_mode: "sequential" | "parallel" | "conditional";
  ask_user: string | null;
  workspace_action: "open" | "extend" | "replace" | "keep";
  next_actions: string[];
}

export interface WorkflowStep {
  id: number;
  tool: string;
  args_template: Record<string, string>;
  depends_on: number | null;
  parallel_with: number[];
  optional: boolean;
  retryable: boolean;
  timeout: number;
  on_fail: "abort" | "skip" | "retry" | "ask_user";
  on_no_result: "abort" | "skip" | "ask_user";
  condition: string | null;
}

export interface RequiredInput {
  field: string;
  source: "session" | "resolve" | "user";
  ask_if_missing: string;
}

export interface WorkflowDefinition {
  id: string;
  trigger: string[];
  required_business_objects: string[];
  required_inputs: RequiredInput[];
  steps: WorkflowStep[];
  possible_next_workflows: string[];
  rollback_strategy: "abort" | "retry_last" | "skip_failed";
}

export interface ToolStepPlan {
  id: number;
  tool: string;
  args: Record<string, string>;
  depends_on: number | null;
  group: number;
  optional: boolean;
  retryable: boolean;
  timeout: number;
  condition: string | null;
  on_fail: "abort" | "skip" | "retry" | "ask_user";
}

export interface RollbackStep {
  if_step_fails: number;
  action: "abort" | "skip" | "retry" | "ask_user";
  message: string;
}

export interface ExecutionPlan {
  id: string;
  objective_id: string;
  workflow_id: string;
  execution_mode: "parallel" | "sequential" | "mixed";
  steps: ToolStepPlan[];
  expected_result: string;
  workspace_action: "open" | "extend" | "replace" | "keep";
  next_possible_actions: string[];
  rollback_plan: RollbackStep[];
  ask_user: string | null;
  metadata: {
    total_steps: number;
    parallel_groups: number;
    has_dependencies: boolean;
    has_conditions: boolean;
    retryable: boolean;
  };
}

// ═══════════════════════════════════════
// PLANNER (Pure Function, Generic Engine)
// ═══════════════════════════════════════

export function plan(
  decision: Decision,
  objective: Objective,
  registry: Record<string, WorkflowDefinition>,
): ExecutionPlan {

  const planId = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  // ── 1. ถ้า Reasoning บอกให้ถาม → plan ว่าง ──
  if (decision.ask_user) {
    return emptyPlan(planId, objective, decision, decision.ask_user);
  }

  // ── 2. หา Workflow จาก Registry ──
  const workflow = findWorkflow(objective.type, registry);
  if (!workflow) {
    return emptyPlan(planId, objective, decision, null);
  }

  // ── 3. ตรวจ required_inputs ──
  const missingInput = checkRequiredInputs(workflow.required_inputs, objective);
  if (missingInput) {
    return emptyPlan(planId, objective, decision, missingInput, workflow.id);
  }

  // ── 4. แปลง workflow.steps → ToolStepPlan[] ──
  const resolvedSteps = resolveSteps(workflow.steps, objective);

  // ── 5. จัด group ──
  const groupedSteps = assignGroups(resolvedSteps);

  // ── 6. สร้าง rollback ──
  const rollback = buildRollback(groupedSteps);

  // ── 7. กำหนด execution_mode ──
  const mode = determineMode(groupedSteps);

  // ── 8. metadata ──
  const groups = new Set(groupedSteps.map(s => s.group));
  const metadata = {
    total_steps: groupedSteps.length,
    parallel_groups: groups.size,
    has_dependencies: groupedSteps.some(s => s.depends_on !== null),
    has_conditions: groupedSteps.some(s => s.condition !== null),
    retryable: groupedSteps.some(s => s.retryable),
  };

  return {
    id: planId,
    objective_id: objective.id,
    workflow_id: workflow.id,
    execution_mode: mode,
    steps: groupedSteps,
    expected_result: objective.expectedOutcome,
    workspace_action: decision.workspace_action,
    next_possible_actions: [
      ...decision.next_actions,
      ...workflow.possible_next_workflows,
    ].filter((v, i, a) => a.indexOf(v) === i),
    rollback_plan: rollback,
    ask_user: null,
    metadata,
  };
}

// ═══════════════════════════════════════
// INTERNAL FUNCTIONS
// ═══════════════════════════════════════

function findWorkflow(
  objectiveType: string,
  registry: Record<string, WorkflowDefinition>,
): WorkflowDefinition | null {
  for (const wf of Object.values(registry)) {
    if (wf.trigger.includes(objectiveType)) return wf;
  }
  return null;
}

function checkRequiredInputs(
  inputs: RequiredInput[],
  objective: Objective,
): string | null {
  for (const req of inputs) {
    if (req.field === "who" && !objective.who && req.ask_if_missing) {
      return req.ask_if_missing;
    }
    if (req.field === "who_id" && !objective.who_id && req.source === "resolve") {
      continue; // identity.resolve จะหาให้
    }
    if (req.source === "user" && req.ask_if_missing) {
      const val = (objective as any)[req.field]
        ?? objective.context[req.field as keyof typeof objective.context];
      if (!val) return req.ask_if_missing;
    }
  }
  return null;
}

function resolveSteps(
  steps: WorkflowStep[],
  objective: Objective,
): ToolStepPlan[] {
  // ถ้ามี who_id → ข้าม identity.resolve
  const skipResolve = !!objective.who_id;
  const filtered = skipResolve
    ? steps.filter(s => s.tool !== "identity.resolve")
    : steps;

  return filtered.map((s, idx) => ({
    id: idx,
    tool: s.tool,
    args: resolveArgs(s.args_template, objective, skipResolve, steps),
    depends_on: remapDependency(s.depends_on, steps, filtered),
    group: -1, // จะ assign ใน assignGroups
    optional: s.optional,
    retryable: s.retryable,
    timeout: s.timeout,
    condition: s.condition,
    on_fail: s.on_fail,
  }));
}

function resolveArgs(
  template: Record<string, string>,
  objective: Objective,
  skipResolve: boolean,
  _allSteps: WorkflowStep[],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(template)) {
    if (val === "$who") {
      result[key] = objective.who ?? "";
    } else if (val === "$who_id") {
      result[key] = objective.who_id ?? "";
    } else if (val === "$raw_input") {
      result[key] = objective.raw_input;
    } else if (val === "$pending_action") {
      result[key] = objective.context.pending_actions[0] ?? "";
    } else if (val.startsWith("$0.") && skipResolve && objective.who_id) {
      // identity.resolve ถูกข้าม → แทนด้วย who_id
      if (val === "$0.id") result[key] = objective.who_id;
      else if (val === "$0.name") result[key] = objective.who ?? "";
      else if (val === "$0.location") result[key] = ""; // ต้อง resolve จาก DB
      else result[key] = val;
    } else {
      result[key] = val; // $0.id, $1.total → Executor จะแทนค่าจริง
    }
  }
  return result;
}

function remapDependency(
  originalDep: number | null,
  originalSteps: WorkflowStep[],
  filteredSteps: { tool: string }[],
): number | null {
  if (originalDep === null) return null;

  const originalTool = originalSteps[originalDep]?.tool;
  if (!originalTool) return null;

  // ถ้า step ที่ depend ถูกลบ (เช่น identity.resolve) → ไม่มี dependency
  const newIdx = filteredSteps.findIndex(s => s.tool === originalTool);
  return newIdx >= 0 ? newIdx : null;
}

function assignGroups(steps: ToolStepPlan[]): ToolStepPlan[] {
  if (steps.length === 0) return [];

  const result = steps.map(s => ({ ...s }));

  // step ที่ไม่มี dependency → group 0
  for (const s of result) {
    if (s.depends_on === null) {
      s.group = 0;
    }
  }

  // step ที่มี dependency → group ถัดจาก dependency
  let changed = true;
  let safety = 0;
  while (changed && safety < 20) {
    changed = false;
    safety++;
    for (const s of result) {
      if (s.group >= 0) continue;
      if (s.depends_on === null) { s.group = 0; changed = true; continue; }
      const dep = result.find(r => r.id === s.depends_on);
      if (dep && dep.group >= 0) {
        s.group = dep.group + 1;
        changed = true;
      }
    }
  }

  // fallback: step ที่ยังไม่มี group → group สุดท้าย
  const maxGroup = Math.max(0, ...result.filter(s => s.group >= 0).map(s => s.group));
  for (const s of result) {
    if (s.group < 0) s.group = maxGroup + 1;
  }

  return result;
}

function determineMode(steps: ToolStepPlan[]): "parallel" | "sequential" | "mixed" {
  if (steps.length <= 1) return "sequential";
  const groups = new Set(steps.map(s => s.group));
  if (groups.size === 1) return "parallel";
  const hasParallel = Array.from(groups).some(g => steps.filter(s => s.group === g).length > 1);
  return hasParallel ? "mixed" : "sequential";
}

function buildRollback(steps: ToolStepPlan[]): RollbackStep[] {
  return steps.map(s => ({
    if_step_fails: s.id,
    action: s.on_fail,
    message: s.on_fail === "abort" ? `${s.tool} ล้มเหลว`
      : s.on_fail === "skip" ? ""
      : s.on_fail === "retry" ? `${s.tool} ล้มเหลว กำลังลองใหม่`
      : `${s.tool} ต้องการข้อมูลเพิ่ม`,
  }));
}

function emptyPlan(
  planId: string,
  objective: Objective,
  decision: Decision,
  askUser: string | null,
  workflowId?: string,
): ExecutionPlan {
  return {
    id: planId,
    objective_id: objective.id,
    workflow_id: workflowId ?? "none",
    execution_mode: "sequential",
    steps: [],
    expected_result: askUser ? "awaiting_input" : objective.expectedOutcome,
    workspace_action: decision.workspace_action,
    next_possible_actions: decision.next_actions,
    rollback_plan: [],
    ask_user: askUser,
    metadata: { total_steps: 0, parallel_groups: 0, has_dependencies: false, has_conditions: false, retryable: false },
  };
}
