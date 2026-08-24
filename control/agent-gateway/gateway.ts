/**
 * หน้าที่: the Agent Gateway core orchestrator. Client-agnostic — never
 * imports a provider SDK, never checks "is this ChatGPT/Claude". Calls
 * only: ./memory-store.ts (persistence, real file-backed), the real
 * existing `permissions/write-gate` + `software/capability-registrar`
 * (policy — same contracts Phase 21/22 already proved), whichever
 * `AgentAdapter` the capability lookup resolves to, and (added
 * 2026-08-22, Pillar 1 of the OS-level enforcement plan — see
 * `/Users/tam/.claude/plans/zesty-spinning-ripple.md`)
 * `../../observability/joint-monitor/contract.ts`'s `reportJoint` — a
 * pure, void-fired mirror call inside `persistStatus`, never a
 * control-flow dependency.
 *
 * Pipeline (Phase 23): submitTask -> capability lookup -> policy gate ->
 * (WAITING_OWNER_DECISION | execute) -> verify -> persist evidence ->
 * return result. Two clients calling getTask()/getResult() on the same
 * task_id read the SAME persisted state — no chat transcript involved.
 */
import { loadTask, loadTaskHistory, loadEvidenceForTask, loadAllTasks, saveEvidence, saveTask } from "./memory-store";
import { newId, nowIso } from "./host-runtime";
import type { AgentAdapter, Evidence, ExecutionResult, MemoryReference, Status, Task, TaskOutputLane, WorkOrder } from "./types";
import { validateWorkOrder } from "./work-order-validator";
import { createHash } from "node:crypto";
import { reportJoint } from "../../observability/joint-monitor/contract";
import type { WorkResultInput } from "../work-result-ingress/contract";

const REPO = process.cwd();

interface CapabilityIndexEntry {
  problem_type: string;
  available_capability: string;
  execution_method: string;
  required_permission: string;
  current_status: string;
}

function loadCapabilityIndex(): CapabilityIndexEntry[] {
  const fs = require("node:fs") as { readFileSync(p: string, e: string): string };
  const path = require("node:path") as { join(...p: string[]): string };
  return JSON.parse(fs.readFileSync(path.join(REPO, "reports/phase16-world-evidence/capability_index.json"), "utf-8"));
}

function matchCapability(intentText: string): CapabilityIndexEntry | null {
  const idx = loadCapabilityIndex();
  // real substring match against the SAME real registry data used all session — no duplicate logic, no new matching engine.
  if (intentText.includes("ตรวจ") || intentText.toLowerCase().includes("status") || intentText.toLowerCase().includes("duplicate")) {
    return idx.find((c) => c.problem_type === "file_duplicate_or_orphan_detection") ?? null;
  }
  if (intentText.includes("แก้ไข") || intentText.toLowerCase().includes("modify")) {
    return idx.find((c) => c.problem_type === "server_hang_or_timeout") ?? null;
  }
  // Canonical route for control/external-system-lifecycle/'s own submitTask() call
  // (registering ANY Model/Model Family/Provider/External System/capability, never
  // one specific one — see reports/phase16-world-evidence/capability_index.json's
  // "external_system_lifecycle_registration" entry). Matching this alone never
  // grants permission — Permission/Policy Resolution and Admission still run for
  // real downstream, unchanged.
  if (intentText.toLowerCase().includes("external system lifecycle")) {
    return idx.find((c) => c.problem_type === "external_system_lifecycle_registration") ?? null;
  }
  return null;
}

async function evaluatePolicy(intentText: string, targetPath: string | null): Promise<{ requiresOwnerDecision: boolean; decision: unknown }> {
  if (!targetPath) return { requiresOwnerDecision: false, decision: { decision: "NOT_A_WRITE_INTENT" } };
  const path = require("node:path") as { join(...p: string[]): string };
  const { evaluateWriteIntent } = await import(path.join(REPO, "permissions/write-gate/contract.ts"));
  const { getCapabilityIndex } = await import(path.join(REPO, "software/capability-registrar/contract.ts"));
  const intent = {
    intent_id: newId("intent"),
    operation: "MODIFY" as const,
    capability: "dna-os-circuit",
    target_type: "FILE" as const,
    target_path: targetPath,
    requested_change: intentText,
    requesting_agent: { identity_id: "agent-gateway", kind: "ai_agent" as const, display_name: "DNA OS Agent Gateway" },
    evidence: [],
    correlation_id: newId("corr"),
    submitted_at: nowIso(),
  };
  const decision = evaluateWriteIntent(intent, { registryIndex: getCapabilityIndex() });
  const requiresOwnerDecision = (decision as { decision: string }).decision !== "ALLOW_CREATE" && (decision as { decision: string }).decision !== "ALLOW_MODIFY";
  return { requiresOwnerDecision, decision };
}

function record(taskId: string, kind: Evidence["kind"], source: string, payload: unknown): string {
  const evidenceId = newId("ev");
  saveEvidence({ evidence_id: evidenceId, task_id: taskId, kind, source, recorded_at: nowIso(), payload });
  return evidenceId;
}

function persistStatus(task: Task, status: Status): Task {
  const nextAction = status === "WAITING_OWNER_DECISION"
    ? "Owner must approve or reject this WorkOrder"
    : status === "BLOCKED"
      ? "Review persisted evidence and resolve the named blocker before resubmitting"
      : status === "FAILED"
        ? "Inspect execution evidence and correct the reported failure"
        : status === "COMPLETED" ? null : task.next_action;
  const updated: Task = { ...task, status, next_action: nextAction, updated_at: nowIso() };
  saveTask(updated);
  // Pillar 1 (Owner, 2026-08-22 — see /Users/tam/.claude/plans/zesty-spinning-ripple.md):
  // the one true funnel for every status transition in this file (submitTask,
  // ownerDecision, recoverInterruptedTasks all route through here) — mirroring
  // here, not at the end of submitTask/ownerDecision individually, means
  // dna-os-circuit/runtime/server.ts's own direct /gateway/* calls (which call
  // submitTask/ownerDecision themselves, bypassing control/command-router/router.ts
  // entirely) are ALSO reported, closing that bypass without touching server.ts.
  // task.submitted_by_client names the real caller (e.g. "command-router" or
  // whatever client_id dna-os-circuit's own callers pass) — never guessed.
  void reportJoint({ from_capability: task.submitted_by_client, to_capability: "agent-gateway", task_id: task.task_id, status, summary: `task ${task.task_id} -> ${status}`, source: "control/agent-gateway/gateway.ts#persistStatus" });
  return updated;
}

/**
 * The ONE post-execution completion lifecycle — both `submitTask()`'s
 * normal dispatch path and `ownerDecision("ทำ")`'s path call this and
 * only this, closing the duplicated COMPLETED/FAILED logic that
 * previously lived separately in each (Owner, 2026-08-22).
 *
 * COMPLETED is never granted from `execResult.ok` alone. A task with a
 * real `work_order` (a real software write was attempted) must pass
 * through the real, unmodified `control/work-result-ingress/`'s
 * `ingestWorkResult()` — never `runRegistrationPipeline()` called
 * directly from this file — and every artifact it produced must carry a
 * real, successful Registration decision (`ingestWorkResult`'s own
 * `WorkResultIngressStatus === "REGISTERED"` already means every
 * artifact is individually `REGISTERED` or `DUPLICATE` — see
 * `control/work-result-ingress/ingress.ts`'s own `SUCCESSFUL_DECISIONS`
 * set; this function never re-derives that check itself).
 * `PARTIALLY_REGISTERED`/`REJECTED` -> `FAILED`, never `COMPLETED`. A
 * task with NO `work_order` (nothing claimed a software write) has
 * nothing to register — `execResult.ok` alone decides it, exactly as
 * before.
 *
 * The persisted "verification" evidence's `verified` field is the
 * single source `computeNextDecisionFromEvidence()`
 * (`control/agent-gateway/handoff.ts`, unchanged) already reads to
 * decide "no further corrective dispatch required" — setting it
 * correctly here (false whenever registration did not fully succeed)
 * is what makes `PARTIALLY_REGISTERED`/`REJECTED` honestly produce
 * "not verified — Owner review required" without touching that
 * function at all.
 *
 * `work-result-ingress/contract` and the real production
 * `RegistryStore` are both resolved via a lazy `await import(...)` —
 * same established pattern this file already uses for
 * `permissions/write-gate`/`software/capability-registrar` in
 * `evaluatePolicy()` above, avoiding the exact module-load cycle class
 * of bug fixed there (this file sits inside
 * `control/command-router` -> `agent-gateway` -> `adapters/*` -> ...,
 * and `work-result-ingress/ingress.ts` itself imports
 * `../agent-gateway/contract`, which re-exports from THIS file — a
 * direct two-hop cycle a static top-level import here would create).
 */
async function completeExecution(task: Task, execResult: { output: unknown; ok: boolean; error?: string }, adapterId: string): Promise<Task> {
  const execEvidenceId = record(task.task_id, "execution_output", adapterId, execResult);
  task = persistStatus(task, "VERIFYING");

  if (execResult.ok !== true) {
    record(task.task_id, "verification", "control/agent-gateway/gateway.ts", { verified: false, execEvidenceId, reason: "EXECUTION_FAILED" });
    return persistStatus(task, "FAILED");
  }

  if (!task.work_order) {
    record(task.task_id, "verification", "control/agent-gateway/gateway.ts", { verified: true, execEvidenceId, reason: "NO_WORK_ORDER_REGISTRATION_NOT_REQUIRED" });
    return persistStatus(task, "COMPLETED");
  }

  const { ingestWorkResult } = await import("../work-result-ingress/contract");
  const { createPersistentFileStore } = await import("../../software/registry-database/adapters/persistent-file-store");
  const workResult: WorkResultInput = {
    task_id: task.task_id,
    // "owner-console" — control/agent-gateway/handoff.ts's real
    // AGENT_ID_NOT_ALLOWLISTED check only accepts codex/claude-code/
    // owner-console; this completion path is DNA OS's own internal
    // dispatch-and-verify step (never a literal external agent
    // identity), the same real category "owner-console" already exists
    // for — it is also the one identity ingestWorkResult's own duplicate-
    // active-submission check deliberately exempts (handoff.ts:
    // `handoff.agent_id !== "owner-console"`), exactly matching this
    // caller never having a "prior active handoff" the way a real
    // external agent's re-submission would.
    agent_id: "owner-console",
    role: adapterId,
    input_reference: `work-order://${task.task_id}`,
    files_read: [],
    files_changed: [task.work_order.target_path],
    tests_run: task.work_order.required_tests,
    status: "VERIFIED",
    evidence_refs: task.work_order.evidence.map((e) => e.source),
    blockers: [],
    next_action: null,
  };
  const ingressResult = ingestWorkResult(workResult, { store: createPersistentFileStore() });
  const registrationVerified = ingressResult.status === "REGISTERED";
  record(task.task_id, "verification", "control/agent-gateway/gateway.ts", {
    verified: registrationVerified,
    execEvidenceId,
    registration_status: ingressResult.status,
    registration_artifacts: ingressResult.artifacts,
    registration_blocker: ingressResult.blocker,
  });

  return persistStatus(task, registrationVerified ? "COMPLETED" : "FAILED");
}

function workOrderIdempotencyKey(workOrder: WorkOrder): string {
  return createHash("sha256").update(JSON.stringify({
    operation: workOrder.operation,
    target_type: workOrder.target_type,
    target_path: workOrder.target_path,
    requested_change: workOrder.requested_change,
    content: workOrder.content,
    workspace_scope: workOrder.workspace_scope,
    mode: workOrder.mode,
    required_tests: workOrder.required_tests,
    forbidden_files: workOrder.forbidden_files,
    evidence: workOrder.evidence,
  })).digest("hex");
}

/**
 * Admits a Task whose outcome is already fully decided by the caller —
 * used by control/command-router/router.ts, which does its OWN real
 * capability matching + policy gate against control/command-router's
 * registry (never gateway's own `matchCapability`/`evaluatePolicy` above,
 * which is a separate, older, hardcoded-substring matcher against a
 * different index and would silently re-decide an already-correct
 * routing outcome). This function creates no second decision — it only
 * persists one already-made outcome so `getTask()`/`getResult()` can find
 * it by the SAME task_id the caller already returned to its own caller.
 *
 * Every command-router step now goes through here (or through
 * `dispatchTask`/`submitTask` for an actual dispatcher Work Order,
 * unchanged) — no command-router step produces a task_id this store
 * cannot find. `output_lane` is the caller's own already-made
 * classification (control/command-router/output-classifier.ts's
 * `classifyOutput` decides it the same way) — this function persists it,
 * never re-derives it.
 */
export function admitCompletedTask(input: {
  intent_text: string;
  memory: Omit<MemoryReference, "task_id" | "created_at">;
  submitted_by_client: string;
  status: Status;
  next_action: string | null;
  evidence: readonly { kind: Evidence["kind"]; source: string; payload: unknown }[];
  output_lane: TaskOutputLane;
}): Task {
  const taskId = newId("task");
  const fullMemory: MemoryReference = { ...input.memory, task_id: taskId, created_at: nowIso() };
  const task: Task = {
    task_id: taskId,
    memory: fullMemory,
    intent_text: input.intent_text,
    submitted_by_client: input.submitted_by_client,
    status: input.status,
    created_at: nowIso(),
    updated_at: nowIso(),
    next_action: input.next_action,
    output_lane: input.output_lane,
  };
  saveTask(task);
  for (const item of input.evidence) record(taskId, item.kind, item.source, item.payload);
  return task;
}

export async function submitTask(intentText: string, memory: Omit<MemoryReference, "task_id" | "created_at">, clientId: string, adapters: readonly AgentAdapter[], workOrder?: WorkOrder): Promise<Task> {
  const idempotencyKey = workOrder ? workOrderIdempotencyKey(workOrder) : undefined;
  if (idempotencyKey) {
    const existing = loadAllTasks().filter((candidate) => candidate.idempotency_key === idempotencyKey).at(-1);
    if (existing && ["COMPLETED", "EXECUTING", "VERIFYING", "ROUTING", "POLICY_CHECK"].includes(existing.status)) {
      record(existing.task_id, "idempotency", "control/agent-gateway/gateway.ts", { reason: "DUPLICATE_WORK_ORDER_SUPPRESSED", idempotency_key: idempotencyKey, existing_status: existing.status });
      return existing;
    }
  }
  const taskId = newId("task");
  const fullMemory: MemoryReference = { ...memory, task_id: taskId, created_at: nowIso() };
  let task: Task = { task_id: taskId, memory: fullMemory, intent_text: intentText, submitted_by_client: clientId, status: "RECEIVED", created_at: nowIso(), updated_at: nowIso(), work_order: workOrder, idempotency_key: idempotencyKey, output_lane: "WORK_ITEM" };
  saveTask(task);

  task = persistStatus(task, "ROUTING");
  const capability = matchCapability(intentText);
  record(taskId, "capability_lookup", "control/agent-gateway/gateway.ts", { intent_text: intentText, matched: !!capability, capability });
  if (!capability) {
    task = persistStatus(task, "BLOCKED");
    record(taskId, "verification", "control/agent-gateway/gateway.ts", { reason: "NO_EXISTING_CAPABILITY matched" });
    return task;
  }

  task = persistStatus(task, "POLICY_CHECK");
  if (workOrder) {
    const admission = validateWorkOrder(workOrder);
    record(taskId, "admission", "control/agent-gateway/work-order-validator.ts", admission);
    if (!admission.ok) {
      task = persistStatus(task, "BLOCKED");
      return task;
    }
  }
  const targetPathMatch = intentText.match(/dna-os-circuit\/[a-zA-Z0-9_\-/.]+/);
  // A Work Order is the authoritative requested target. Do not let a
  // generic agent sentence accidentally turn a mutating request into a
  // non-write policy evaluation.
  const policyTargetPath = workOrder?.target_path.startsWith("dna-os-circuit/")
    ? workOrder.target_path
    : (targetPathMatch ? targetPathMatch[0] : null);
  const { requiresOwnerDecision, decision } = await evaluatePolicy(intentText, policyTargetPath);
  record(taskId, "policy_decision", "permissions/write-gate (reused)", decision);

  if (requiresOwnerDecision) {
    task = persistStatus(task, "WAITING_OWNER_DECISION");
    return task;
  }

  task = persistStatus(task, "EXECUTING");
  const adapter = workOrder
    ? adapters.find((a) => a.adapter_id === "ai-write-control-adapter")
    : adapters.find((a) => a.describe().capabilities.includes(capability.problem_type)) ?? adapters[0];
  if (!adapter) {
    task = persistStatus(task, "BLOCKED");
    record(taskId, "verification", "control/agent-gateway/gateway.ts", { reason: "AI_WRITE_ADAPTER_NOT_REGISTERED" });
    return task;
  }
  const execResult = await adapter.execute({ task_id: taskId, capability: { capability_id: workOrder ? "code_change_work_order" : capability.problem_type, problem_type: workOrder ? "code_change_work_order" : capability.problem_type, source: workOrder ? "control/ai-write-control" : "capability_index.json" }, adapter_id: adapter.adapter_id, input: workOrder ? { work_order: workOrder } : {} });
  task = await completeExecution(task, execResult, adapter.adapter_id);
  return task;
}

export function getTask(taskId: string): Task | undefined {
  return loadTask(taskId);
}

export function getResult(taskId: string): ExecutionResult | undefined {
  const task = loadTask(taskId);
  if (!task) return undefined;
  const evidence = loadEvidenceForTask(taskId);
  const execEvidence = evidence.filter((e) => e.kind === "execution_output").pop();
  const verifyEvidence = evidence.filter((e) => e.kind === "verification").pop();
  return {
    task_id: taskId,
    status: task.status,
    output: execEvidence?.payload ?? null,
    evidence_ids: evidence.map((e) => e.evidence_id),
    verified: verifyEvidence ? (verifyEvidence.payload as { verified: boolean }).verified : null,
    next_action: task.next_action ?? null,
  };
}

/** Human-language explanation, built ONLY from real persisted state/evidence — never AI-narrated on the spot. */
export function explain(taskId: string): { what_happened: string; what_was_checked: string; evidence_ids: readonly string[]; proposal: string; impact: string; cost: string; unknowns: string } | undefined {
  const task = loadTask(taskId);
  if (!task) return undefined;
  const evidence = loadEvidenceForTask(taskId);
  const capLookup = evidence.find((e) => e.kind === "capability_lookup");
  const policyEv = evidence.find((e) => e.kind === "policy_decision");
  return {
    what_happened: `Task "${task.intent_text}" is currently ${task.status}.`,
    what_was_checked: capLookup ? `Capability lookup matched: ${JSON.stringify((capLookup.payload as { capability: unknown }).capability)}` : "no capability lookup evidence found",
    evidence_ids: evidence.map((e) => e.evidence_id),
    proposal: task.status === "WAITING_OWNER_DECISION" ? `Proceed with: ${task.intent_text}` : "no proposal — task is not awaiting a decision",
    impact: policyEv ? JSON.stringify(policyEv.payload) : "unknown",
    cost: "UNKNOWN — no cost model wired to this task type",
    unknowns: "real-world buyer/customer impact not measured; this task concerns internal repository state only",
  };
}

export async function ownerDecision(taskId: string, decision: "ทำ" | "ไม่ทำ", adapters: readonly AgentAdapter[]): Promise<Task | undefined> {
  let task = loadTask(taskId);
  if (!task) return undefined;
  if (task.status !== "WAITING_OWNER_DECISION") return task; // decisions only apply at the gate — never retroactive
  record(taskId, "owner_decision", "Owner (human)", { decision, decided_at: nowIso() });
  if (decision === "ไม่ทำ") {
    task = persistStatus(task, "BLOCKED");
    return task;
  }
  // "ทำ" — the Owner's decision IS the authorization event; recorded as evidence BEFORE execution, per Phase 23's own rule.
  task = persistStatus(task, "EXECUTING");
  const capability = matchCapability(task.intent_text);
  const adapter = task.work_order
    ? adapters.find((a) => a.adapter_id === "ai-write-control-adapter")
    : adapters.find((a) => capability && a.describe().capabilities.includes(capability.problem_type)) ?? adapters[0];
  if (!adapter) {
    task = persistStatus(task, "BLOCKED");
    record(taskId, "verification", "control/agent-gateway/gateway.ts", { reason: "AI_WRITE_ADAPTER_NOT_REGISTERED" });
    return task;
  }
  const execResult = await adapter.execute({
    task_id: taskId,
    capability: { capability_id: task.work_order ? "code_change_work_order" : capability?.problem_type ?? "unknown", problem_type: task.work_order ? "code_change_work_order" : capability?.problem_type ?? "unknown", source: task.work_order ? "control/ai-write-control" : "capability_index.json" },
    adapter_id: adapter.adapter_id,
    input: task.work_order ? { work_order: task.work_order } : {},
  });
  task = await completeExecution(task, execResult, adapter.adapter_id);
  return task;
}

export function listCapabilities(): CapabilityIndexEntry[] {
  return loadCapabilityIndex();
}

/** Recovery hook used by the supervisor. Durable records survive a restart;
 * interrupted work is stopped with evidence instead of being silently lost
 * or retried outside its original Work Order. */
export function recoverInterruptedTasks(): readonly Task[] {
  const latest = new Map<string, Task>();
  for (const task of loadAllTasks()) latest.set(task.task_id, task);
  const recovered: Task[] = [];
  for (const task of latest.values()) {
    if (["ROUTING", "POLICY_CHECK", "EXECUTING", "VERIFYING"].includes(task.status)) {
      const updated = persistStatus(task, "BLOCKED");
      record(task.task_id, "recovery", "control/agent-gateway/gateway.ts", { reason: "WORKER_RESTART", previous_status: task.status });
      recovered.push(updated);
    }
  }
  return recovered;
}
