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
import { loadTask, loadTaskHistory, loadEvidenceForTask, loadAllTasks, saveEvidence, saveTask, tasksFilePath } from "./memory-store";
import { newId, nowIso } from "./host-runtime";
import type { AgentAdapter, Evidence, ExecutionResult, MemoryReference, Status, Task, TaskOutputLane, WorkOrder } from "./types";
import { validateWorkOrder } from "./work-order-validator";
import { createHash } from "node:crypto";
import { reportJoint } from "../../observability/joint-monitor/contract";
import { decideCompletion } from "../ui-render-verification/contract";
import { resolveCapability } from "./capability-resolver";
import type { CapabilityMatchResult } from "./capability-resolver";
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

/**
 * CAPABILITY MATCHING, Owner-authorised change 2026-08-27.
 *
 * The whole decision now lives in `./capability-resolver.ts`, which asks the
 * REGISTRIES in order — exact capability id, exact canonical name, then the
 * route group through the shared search order in
 * `contracts/command/route-group-capabilities.ts` — and only falls back to
 * the original three-substring matcher for the callers that still rely on it.
 *
 * The substring rules themselves are unchanged and live on in
 * `legacySubstringMatch`, so `control/external-system-lifecycle/` and every
 * existing intent behave exactly as before. What changed is that prose is no
 * longer the FIRST thing consulted: 213 recorded NO_EXISTING_CAPABILITY
 * blocks were canonical route groups that no substring could ever match.
 *
 * Matching still grants nothing. Policy, Admission, the write gate and the
 * execution gate all run afterwards, untouched.
 */
function matchCapabilityWithEvidence(
  intentText: string,
  routeContext?: Task["route_context"],
): CapabilityMatchResult {
  return resolveCapability(
    {
      intent_text: intentText,
      route_group: (routeContext?.route_group ?? null) as never,
      target_capability_id: routeContext?.target_capability_id ?? null,
      target_capability_name: routeContext?.target_capability_name ?? null,
      event_type: routeContext?.event_type ?? null,
      error_code: routeContext?.error_code ?? null,
      work_id: routeContext?.work_id ?? null,
      trace_id: routeContext?.trace_id ?? null,
      evidence_ref: routeContext?.evidence_ref ?? null,
    },
    loadCapabilityIndex(),
  );
}

function matchCapability(intentText: string, routeContext?: Task["route_context"]): CapabilityIndexEntry | null {
  return matchCapabilityWithEvidence(intentText, routeContext).entry;
}

async function evaluatePolicy(intentText: string, targetPath: string | null): Promise<{ requiresOwnerDecision: boolean; decision: unknown }> {
  if (!targetPath) return { requiresOwnerDecision: false, decision: { decision: "NOT_A_WRITE_INTENT" } };
  const path = require("node:path") as { join(...p: string[]): string };
  const { evaluateWriteIntent } = await import(path.join(REPO, "permissions/write-gate/contract.ts"));
  const { getWriteOwnershipIndex } = await import(path.join(REPO, "software/capability-registrar/contract.ts"));
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
  const decision = evaluateWriteIntent(intent, { registryIndex: getWriteOwnershipIndex() });
  const requiresOwnerDecision = (decision as { decision: string }).decision !== "ALLOW_CREATE" && (decision as { decision: string }).decision !== "ALLOW_MODIFY";
  return { requiresOwnerDecision, decision };
}

function record(taskId: string, kind: Evidence["kind"], source: string, payload: unknown): string {
  const evidenceId = newId("ev");
  saveEvidence({ evidence_id: evidenceId, task_id: taskId, kind, source, recorded_at: nowIso(), payload });
  return evidenceId;
}

/**
 * The change set this task really carries. A declared `affected_paths` wins;
 * otherwise the work order's own target path is the change set, because that
 * IS the file the task exists to write. No work order means no file was
 * changed through DNA OS, and the empty list says exactly that.
 */
function affectedPathsOf(task: Task): readonly string[] {
  if (task.affected_paths && task.affected_paths.length > 0) return task.affected_paths;
  return task.work_order ? [task.work_order.target_path] : [];
}

/** The real status funnel, exported ONLY so a proof can drive the exact production path rather than a copy of it. Callers inside this file use `persistStatus` directly. */
/**
 * Writes the durable work-session checkpoint for one real status transition.
 *
 * `control/work-session-state/` owns work progression; this file owns task
 * lifecycle status. The checkpoint therefore RESTATES NOTHING it does not own:
 * `current_phase` is the existing `Status` value verbatim (no second lifecycle
 * vocabulary is introduced), the architecture answer is referenced by
 * `resolution_ref` rather than copied, and the task is pointed at by `task_id`
 * so its status is only ever read back from here.
 *
 * Never throws at the caller. A dashboard or a journal that is unavailable must
 * not fail a real Owner command — the same rule `reportJoint` already follows
 * two lines below. What it must not do instead is pretend: a failed checkpoint
 * write leaves the previous checkpoint in place, so the resume engine sees the
 * work at its last durably-recorded phase, which is the truth.
 */
/**
 * Records a really-blocked task as waiting on its dependency, through the
 * EXISTING `control/work-continuation/` store. Never throws at the caller: a
 * real transition must not fail because a journal could not be written.
 *
 * Lazy `require` for the same reason as `checkpointTransition` above —
 * `control/capability-creation` reaches `control/work-continuation`, which
 * shares this file's evidence store through `control/work-resolution`.
 */
/**
 * Runs the EXISTING continuation join after an authoritative verdict.
 *
 * It produces no events of its own and dispatches nothing: it hands the real
 * census to `control/work-continuation`'s adapter, hands the recorded creation
 * gaps to `control/capability-creation`'s wiring producer, and asks the ONE
 * evaluator which waiting work is now eligible. A `RESUME_ELIGIBLE` decision is
 * recorded; `control/scheduler/` remains the only thing that executes one.
 *
 * Never throws at the caller, and reads the census SNAPSHOT rather than
 * recomputing it — a status transition must not become a census run.
 */
function emitDependencyEvents(task: Task): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodeFs = require("node:fs") as typeof import("node:fs");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cc = require("../capability-creation/contract") as typeof import("../capability-creation/contract");
    const snapshotPath = `${process.cwd()}/software/live-census/data/last-census.json`;
    if (!nodeFs.existsSync(snapshotPath)) return;
    const census = JSON.parse(nodeFs.readFileSync(snapshotPath, "utf8")) as unknown;
    const result = cc.runContinuationJoin({
      census,
      source_revision: task.task_id,
      // Production uses control/work-continuation's own default path. The
      // override exists only so a proof can exercise this REAL code path
      // without writing rows into the live waiting journal — production never
      // sets it, so its behaviour is unchanged by construction.
      waiting_path: process.env.WORK_CONTINUATION_WAITING_PATH,
    });
    for (const decision of result.decisions) {
      record(task.task_id, "verification", "control/capability-creation/production.ts#runContinuationJoin", {
        resumed_work_id: decision.work_id,
        verdict: decision.evaluation.verdict,
        triggered_by: decision.triggered_by.key,
        next_action: decision.next_action,
      });
    }
  } catch {
    // a join that cannot run leaves every waiting row exactly as it was
  }
}

function recordBlocked(task: Task, blocker: string, affected: readonly string[]): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cc = require("../capability-creation/contract") as typeof import("../capability-creation/contract");
    cc.recordBlockedWork({
      work_id: task.task_id,
      current_phase: task.status,
      next_action: blocker,
      affected_paths: affected,
      evidence_refs: [`control/agent-gateway/data/tasks.jsonl#${task.task_id}`],
    });
  } catch {
    // never fail a real transition for this
  }
}

function checkpointTransition(task: Task, nextAction: string | null | undefined): void {
  try {
    // Required lazily: `control/work-session-state/authority.ts` reads
    // `control/work-resolution`, which persists into THIS file's evidence
    // store. A top-level import would close that ring at module-load time.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const wss = require("../work-session-state/contract") as typeof import("../work-session-state/contract");
    const previous = wss.currentCheckpoint(task.task_id);
    const resolution = wss.resolveResolution(task.task_id);
    const now = nowIso();
    const affected = affectedPathsOf(task);

    // The step for THIS transition. Its verification is a real, re-derivable
    // fact — the task row itself, which `saveTask` has already written — not a
    // claim that the transition happened.
    const step = {
      step_id: `status:${task.status}:${now}`,
      title: `task ${task.task_id} -> ${task.status}`,
      state: "COMPLETED" as const,
      phase: task.status,
      depends_on: [] as string[],
      affected_paths: affected,
      // The REAL path of the task log in use, not the production path written
      // out as a literal: under AGENT_GATEWAY_DATA_DIR they differ, and a
      // verification pointing at the wrong file turns a completed step into an
      // unprovable one.
      evidence_refs: [`${tasksFilePath()}#${task.task_id}`],
      verification: { kind: "FILE_CONTAINS" as const, path: tasksFilePath(), literal: task.task_id },
      completed_at_revision: wss.currentRevision(),
      completed_at: now,
    };

    wss.appendCheckpoint({
      ...(previous ?? {}),
      work_id: task.task_id,
      owner_intent_id: previous?.owner_intent_id ?? task.intent_text.slice(0, 120),
      task_id: task.task_id,
      session_id: previous?.session_id ?? wss.newSessionId(),
      execution_id: `exec-${process.pid}`,
      worker_identity: task.submitted_by_client,
      repository: "DNA-OS-INFRASTRUCTURE",
      branch: wss.currentBranch(),
      affected_resource_ids: previous?.affected_resource_ids ?? [],
      affected_paths: affected,
      objective: previous?.objective ?? task.intent_text,
      current_phase: task.status,
      steps: [...(previous?.steps ?? []), step],
      blockers: previous?.blockers ?? [],
      decisions_required: previous?.decisions_required ?? [],
      evidence_refs: previous?.evidence_refs ?? [],
      source_revision: wss.currentRevision(),
      last_verified_revision: wss.currentRevision(),
      next_action: nextAction ?? "none",
      do_not_repeat: previous?.do_not_repeat ?? [],
      ui_context: previous?.ui_context ?? null,
      last_durable_event: previous?.last_durable_event ?? [],
      sync_state: previous?.sync_state ?? "SYNCED",
      // A REFERENCE to the architecture answer, never a copy of it.
      resolution_ref: resolution ? wss.resolutionRefOf(resolution) : (previous?.resolution_ref ?? null),
      cross_repo_evidence: previous?.cross_repo_evidence ?? [],
      status: task.status === "COMPLETED" ? "COMPLETE" : task.status === "BLOCKED" || task.status === "WAITING_OWNER_DECISION" ? "BLOCKED" : "ACTIVE",
      started_at: previous?.started_at ?? task.created_at,
    });
  } catch {
    // Never fail a real transition because the work-state journal could not be
    // written. The previous checkpoint stands, and the resume engine reports
    // the work at its last durably-recorded phase.
  }
}

export function persistStatusForProof(task: Task, status: Status): Task {
  return persistStatus(task, status);
}

function persistStatus(task: Task, status: Status): Task {
  const nextAction = status === "WAITING_OWNER_DECISION"
    ? "Owner must approve or reject this WorkOrder"
    : status === "BLOCKED"
      ? "Review persisted evidence and resolve the named blocker before resubmitting"
      : status === "FAILED"
        ? "Inspect execution evidence and correct the reported failure"
        : status === "COMPLETED" ? null : task.next_action;
  // THE UI RENDER GATE ON THE STATUS FUNNEL (Owner, 2026-08-26).
  // persistStatus is the one place every status transition in this file goes
  // through, so it is where a COMPLETED that carries a change set can be
  // stopped. It uses the task's own `affected_paths` — the change set now
  // travels with the task — instead of a gate being bolted on somewhere new.
  //
  // A task with no work order changed no file through DNA OS, so there is
  // nothing for a render to prove and the transition is untouched. That is a
  // fact about the task, not an exemption.
  if (status === "COMPLETED") {
    const affected = affectedPathsOf(task);
    if (affected.length > 0) {
      const decision = decideCompletion({
        execution_id: task.task_id,
        changed_paths: affected,
        capability_id: task.task_id,
        // `created_at`, not `updated_at`: updated_at moves every time anything
        // touches the task, so render evidence made DURING the execution kept
        // being judged older than the work it proved and denied a completion
        // that should have passed (measured 2026-08-26). The execution's start
        // is the fixed point evidence has to be newer than.
        applied_at: task.created_at,
        correlation_id: `task://${task.task_id}`,
      });
      if (decision.status === "COMPLETE_DENIED") {
        const blocked: Task = { ...task, status: "BLOCKED", next_action: `UI_RENDER_NOT_VERIFIED:${decision.ui_impact}:${decision.render_verdict ?? "NO_EVIDENCE"}`, updated_at: nowIso() };
        saveTask(blocked);
        // The denied completion is a real transition and is checkpointed like
        // any other — a crash here must not leave the work looking as though
        // it was still on its way to COMPLETED.
        checkpointTransition(blocked, `UI_RENDER_NOT_VERIFIED:${decision.ui_impact}:${decision.render_verdict ?? "NO_EVIDENCE"}`);
        // PRODUCTION WAITING CALLER. This is the real point at which work
        // becomes blocked on a deterministic missing dependency, so this is
        // where it is recorded as waiting — not in a proof and not by hand. It
        // records nothing when no deterministic key derives from the blocker,
        // because a key nothing can ever emit is a silent forever-wait.
        recordBlocked(blocked, `UI_RENDER_NOT_VERIFIED:${decision.ui_impact}:${decision.render_verdict ?? "NO_EVIDENCE"}`, affected);
        record(task.task_id, "verification", "control/ui-render-verification/gate.ts", { ui_impact: decision.ui_impact, render_verdict: decision.render_verdict, reason: decision.reason, affected_paths: affected });
        void reportJoint({ from_capability: task.submitted_by_client, to_capability: "agent-gateway", task_id: task.task_id, status: "BLOCKED", summary: `task ${task.task_id} -> BLOCKED (UI render not verified)`, source: "control/agent-gateway/gateway.ts#persistStatus" });
        return blocked;
      }
    }
  }

  const updated: Task = { ...task, status, next_action: nextAction, updated_at: nowIso() };
  saveTask(updated);
  // MANDATORY DURABLE CHECKPOINT (Owner, 2026-08-26).
  //
  // This is the smallest boundary that sees every real status transition in
  // this file — submitTask, ownerDecision and recoverInterruptedTasks all pass
  // through here, as does dna-os-circuit's own direct /gateway/* path. Putting
  // the checkpoint anywhere else would mean either missing transitions or
  // sprinkling calls through modules that do not own progression.
  //
  // It runs BEFORE this function returns, i.e. before the transition is
  // acknowledged to its caller. A crash between `saveTask` and the return is
  // therefore detectable: the task store has moved and the checkpoint has not,
  // which the resume engine reports rather than resolving in anyone's favour.
  checkpointTransition(updated, nextAction);
  // PRODUCTION DEPENDENCY-EVENT PRODUCER. COMPLETED, FAILED and BLOCKED are the
  // three moments a verdict becomes authoritative — the smallest existing
  // boundary where deterministic state really changes. BLOCKED belongs here for
  // a specific reason, found by proving it: it is the transition that has just
  // RECORDED work as waiting, so it is the most likely moment for something to
  // already be satisfiable. Ordinary ROUTING/EXECUTING transitions still do not
  // run it, so they do not pay for a census read that cannot satisfy anything.
  if (status === "COMPLETED" || status === "FAILED" || status === "BLOCKED") emitDependencyEvents(updated);
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
/**
 * @param measuredResult ผลที่ "วัดมาแล้ว" จากเส้นทาง Agent (Owner,
 *   CANONICALIZE_AGENT_RESULT). เมื่อส่งมา ฟังก์ชันนี้ใช้มันตรง ๆ และ **ไม่**
 *   สังเคราะห์ WorkResultInput ขึ้นเอง
 *
 *   ทำไมต้องแยกสองแบบ: WorkResultInput ที่ฟังก์ชันนี้สร้างเองข้างล่างเติมค่าจาก
 *   สิ่งที่ WorkOrder *ประกาศ* ไว้ — `files_changed` มาจาก target_path,
 *   `tests_run` มาจาก required_tests, `status` ตั้งเป็น "VERIFIED" ตายตัว
 *   นั่นพอใช้ได้กับ adapter ที่ตัวมันเองเป็นผู้เขียนไฟล์ (สิ่งที่ประกาศ = สิ่งที่ทำ)
 *   แต่ใช้กับผลของ Agent ไม่ได้ เพราะ Agent อาจไม่ได้แตะไฟล์ที่บอกไว้เลย —
 *   เส้นทาง Agent จึงต้องส่งผลที่วัดจากดิสก์จริงเข้ามาแทน
 */
async function completeExecution(task: Task, execResult: { output: unknown; ok: boolean; error?: string }, adapterId: string, measuredResult?: WorkResultInput): Promise<Task> {
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
  // สังเคราะห์เฉพาะเมื่อไม่มีผลที่วัดมา — เส้นทาง adapter เดิมไม่เปลี่ยนพฤติกรรม
  const workResult: WorkResultInput = measuredResult ?? {
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

/**
 * กุญแจจากตัวตนของเหตุการณ์ต้นทาง (Owner, PHASE 3) — ใช้เมื่องานถูกสร้าง
 * อัตโนมัติจาก event หนึ่งใบ กฎคือ "หนึ่ง event สร้างงานได้อย่างมากหนึ่งงาน"
 *
 * ทำไมไม่ใช้ hash ของ WorkOrder ในกรณีนี้: เนื้อ WorkOrder ที่สะพานสร้างขึ้น
 * อาจต่างกันเล็กน้อยระหว่างสองครั้งที่ event เดียวกันถูกส่งมา (เวลา, ข้อความ)
 * แล้วจะกลายเป็นสองงานทั้งที่ต้นเหตุใบเดียว — กุญแจจึงต้องผูกกับตัวตนของ
 * เหตุการณ์ ไม่ใช่กับผลลัพธ์ที่แปลมาจากมัน
 *
 * hash เฉพาะตัวระบุที่มีโครงสร้างสองตัว ไม่ hash ข้อความบรรยายใด ๆ
 */
function sourceEventIdempotencyKey(sourceEventType: string, sourceEventId: string): string {
  return createHash("sha256").update(JSON.stringify({
    source_event_type: sourceEventType,
    source_event_id: sourceEventId,
  })).digest("hex");
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

export async function submitTask(
  intentText: string,
  memory: Omit<MemoryReference, "task_id" | "created_at">,
  clientId: string,
  adapters: readonly AgentAdapter[],
  workOrder?: WorkOrder,
  /**
   * What the caller already knows about where this belongs — a route group, a
   * capability id, a canonical name. Optional, and every existing caller omits
   * it, in which case matching falls through to exactly the behaviour it had
   * before. Supplying it is what lets the ten canonical route groups reach a
   * capability at all.
   */
  routeContext?: Task["route_context"],
): Promise<Task> {
  /**
   * ตัวตนของเหตุการณ์ต้นทางมาก่อนเสมอเมื่อมี — งานที่เกิดจาก event ใบเดียว
   * ต้องถูกกันซ้ำด้วย event นั้น ไม่ใช่ด้วยเนื้องานที่แปลออกมา
   */
  const sourceEventType = routeContext?.source_event_type ?? null;
  const sourceEventId = routeContext?.source_event_id ?? null;
  const idempotencyKey = sourceEventType && sourceEventId
    ? sourceEventIdempotencyKey(sourceEventType, sourceEventId)
    : workOrder ? workOrderIdempotencyKey(workOrder) : undefined;
  if (idempotencyKey) {
    const existing = loadAllTasks().filter((candidate) => candidate.idempotency_key === idempotencyKey).at(-1);
    if (existing && ["COMPLETED", "EXECUTING", "VERIFYING", "ROUTING", "POLICY_CHECK"].includes(existing.status)) {
      record(existing.task_id, "idempotency", "control/agent-gateway/gateway.ts", { reason: sourceEventId ? "DUPLICATE_SOURCE_EVENT_SUPPRESSED" : "DUPLICATE_WORK_ORDER_SUPPRESSED", idempotency_key: idempotencyKey, source_event_type: sourceEventType, source_event_id: sourceEventId, existing_status: existing.status });
      return existing;
    }
  }
  const taskId = newId("task");
  const fullMemory: MemoryReference = { ...memory, task_id: taskId, created_at: nowIso() };
  let task: Task = { task_id: taskId, memory: fullMemory, intent_text: intentText, submitted_by_client: clientId, status: "RECEIVED", created_at: nowIso(), updated_at: nowIso(), work_order: workOrder, route_context: routeContext, idempotency_key: idempotencyKey, output_lane: "WORK_ITEM" };
  saveTask(task);
  // WORK_CREATED. `persistStatus` structurally cannot see this one: it takes an
  // existing task and moves it, and here the task is being born — there is no
  // transition yet. This is the creation boundary, not a second checkpoint site
  // sprinkled into an unrelated module, and without it a crash between creation
  // and the first real transition would leave work with no durable record at all.
  checkpointTransition(task, task.next_action);

  task = persistStatus(task, "ROUTING");
  // Every match now carries its method, the registry row that answered, the
  // reason, and every candidate that did not — so a routing decision can be
  // audited without re-running it.
  const match = matchCapabilityWithEvidence(intentText, routeContext);
  const capability = match.entry;
  record(taskId, "capability_lookup", "control/agent-gateway/gateway.ts", {
    intent_text: intentText,
    matched: match.MATCH_METHOD !== "NO_EXISTING_CAPABILITY",
    MATCH_METHOD: match.MATCH_METHOD,
    MATCHED_CAPABILITY_ID: match.MATCHED_CAPABILITY_ID,
    REGISTRY_REF: match.REGISTRY_REF,
    REASON: match.REASON,
    EVIDENCE_REF: match.EVIDENCE_REF,
    considered: match.considered,
    capability,
  });
  // A capability can resolve from a registry that carries no execution_method
  // (command-router's routable registry, the persistent software registry).
  // That is a real match — the gateway now knows who it is for — but it is
  // NOT something this gateway can execute itself, and saying otherwise would
  // be the gateway claiming another capability's authority. Such a task stops
  // here with the owner named, for that capability's own boundary to pick up.
  if (!capability) {
    task = persistStatus(task, "BLOCKED");
    record(taskId, "verification", "control/agent-gateway/gateway.ts",
      match.MATCH_METHOD === "NO_EXISTING_CAPABILITY"
        ? { reason: "NO_EXISTING_CAPABILITY matched", MATCH_METHOD: match.MATCH_METHOD, REASON: match.REASON }
        : {
            reason: "CAPABILITY_RESOLVED_NOT_GATEWAY_EXECUTABLE",
            // This stop is intentional and the gateway knows it: the owner was
            // resolved and the gateway is declining to act on that
            // capability's behalf. Saying so here is what keeps it out of the
            // repair queue as an apparent defect — the same mislabelling that
            // put 289 by-design records at the top of that queue.
            classification: "NOT_DISPATCH_REQUIRED",
            MATCH_METHOD: match.MATCH_METHOD,
            MATCHED_CAPABILITY_ID: match.MATCHED_CAPABILITY_ID,
            REGISTRY_REF: match.REGISTRY_REF,
            NEXT_BOUNDARY: match.MATCHED_CAPABILITY_ID,
            REASON: `${match.REASON}; the resolving registry carries no execution_method, so dispatch belongs to that capability's own boundary, not to this gateway`,
          });
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

  /**
   * ADMITTED AGENT EXECUTION (Owner, CANONICALIZE_AGENT_RESULT_AND_COMPLETION_PATH).
   *
   * WorkOrder ที่มี `agent_run` แปลว่างานนี้ให้ Agent จริงทำ ไม่ใช่ให้ adapter เขียนเอง
   * ก่อนหน้านี้ผลของ Agent จบอยู่นอก lifecycle — `runAgentWorkOrder` คืน
   * `DnaOsAgentResult` แล้ว `runCorrectiveLoop` ก็จบที่ TERMINAL โดยไม่มีใครพามันเข้า
   * ประตูรับผล ทำให้มีสองเส้นทางผลลัพธ์ที่ไม่รู้จักกัน (MODEL_C)
   *
   * ตรงนี้ปิดช่องนั้น: ผลของ Agent ต้องผ่าน agent-result-adapter -> WorkResultInput
   * -> ingestWorkResult เหมือนผลอื่นทุกประการ และ COMPLETED จะเกิดได้ก็ต่อเมื่อ
   * ingress รับผลนั้นจริง
   *
   * ไฟล์ที่เปลี่ยนถูกวัดที่นี่ (sha256 ก่อน/หลัง) ไม่ใช่รับคำบอกจาก Agent —
   * DNA OS เป็นผู้วัด ไม่ใช่ผู้ทำงานเป็นผู้รายงาน
   */
  if (workOrder?.agent_run) {
    const [{ runAgentWorkOrder }, { adaptAgentResult }, nodeFs, nodeCrypto] = await Promise.all([
      import("./agent-host-dispatch"),
      import("../agent-result-adapter/contract"),
      import("node:fs"), import("node:crypto"),
    ]);
    const nodePath = require("node:path") as { join(...p: string[]): string };
    const abs = nodePath.join(REPO, workOrder.target_path);
    const shaOf = (): string | null => {
      try { return nodeCrypto.createHash("sha256").update(nodeFs.readFileSync(abs)).digest("hex"); }
      catch { return null; }
    };
    const before = shaOf();
    const origin = { kind: "ADMITTED_TASK" as const, task_id: taskId, command_id: taskId.replace(/^task-/, ""), work_id: workOrder.work_order_id };
    const agentResult = await runAgentWorkOrder(
      workOrder,
      origin,
      process.env as Record<string, string | undefined>,
    );
    /**
     * วัดเป้าหมาย canonical ทันทีหลัง Agent จบ ก่อนที่ router จะทำงาน
     * ถ้าค่านี้ต่างจาก `before` แปลว่า Agent เขียนเป้าหมายเองได้ ซึ่งเป็นสิ่งที่
     * สถาปัตยกรรมนี้ห้าม — วัด ไม่ใช่สมมติว่า sandbox กันไว้แล้ว
     */
    const afterAgent = shaOf();
    const agentDirectTargetMutation = before !== afterAgent;

    /**
     * REQUESTED ACTION -> ประตูเดียว (Owner, CONNECT_AGENT_REQUESTED_ACTION_TO_EXISTING_WRITE_AUTHORITY_PIPE).
     *
     * `requested_actions[]` ของ Agent เป็น DATA ไม่ใช่อำนาจ ที่นี่จึงไม่เรียก
     * `executeFileWrite` หรือ `evaluateWriteIntent` ตรง ๆ เลย — ส่งเข้า
     * `routeRequestedAction` ซึ่งเป็นที่เดียวที่ประกอบสาย
     * submitWriteRequest -> evaluateWriteIntent -> executeFileWrite
     *
     * ไม่มี workspace ที่ resolve ได้ = ตัดสินขอบเขต artifact ไม่ได้ = ปฏิเสธ
     * ไม่ใช่ปล่อยผ่านโดยข้ามการตรวจ
     */
    const [{ routeRequestedAction }, { getWorkspace }] = await Promise.all([
      import("./agent-authority-router"), import("./workspace-manager"),
    ]);
    const agentWorkspace = workOrder.agent_run.workspace_id ? getWorkspace(workOrder.agent_run.workspace_id) : undefined;
    const authorizationReference = loadEvidenceForTask(taskId).find((e) => e.kind === "policy_decision")?.evidence_id ?? null;
    const routed: { action: (typeof agentResult.requested_actions)[number]; outcome: unknown }[] = [];
    for (const action of agentResult.requested_actions) {
      if (!agentWorkspace) {
        routed.push({ action, outcome: { status: "DENIED", operation: action.operation, reason: "NO_WORKSPACE_BOUNDARY: agent_run has no resolvable workspace_id — artifact confinement cannot be decided, refusing rather than reading an unbounded path" } });
        continue;
      }
      routed.push({ action, outcome: await routeRequestedAction(action, { workspace: agentWorkspace, origin, authorization_reference: authorizationReference }) });
    }

    const after = shaOf();
    const measuredChanges = before !== null && after !== null && before !== after
      ? [{ repo_relative_path: workOrder.target_path, sha256_before: before, sha256_after: after,
           measured_by: "control/agent-gateway/gateway.ts#dispatchTask" }]
      : [];
    /**
     * ตัวตนที่เชื่อถือได้ของผู้ส่งผล ต้องมาจาก DNA OS ไม่ใช่จากผลลัพธ์ของ Agent
     * (Owner, RESOLVE_AGENT_HANDOFF_PRINCIPAL) วันนี้ resolve ไม่ได้ จึงส่ง
     * undefined และ adapter คงพฤติกรรมเดิมไว้ทุกประการ — ไม่ได้เติมค่าปลอมแทน
     */
    const { resolveHandoffPrincipal } = await import("./handoff-principal");
    const principal = resolveHandoffPrincipal({ worker_kind: workOrder.agent_run.worker_kind, required_role: null, required_scope: REPO });
    const adapted = adaptAgentResult(agentResult, {
      role: workOrder.agent_run.worker_kind, repo_root: REPO,
      allowed_write_paths: [workOrder.workspace_scope],
      verified_file_changes: measuredChanges,
      handoff_principal_id: principal.ok ? principal.handoff_principal_id : undefined,
    });
    record(taskId, "execution_output", "control/agent-gateway/gateway.ts#admitted-agent-execution", {
      agent_status: agentResult.status, result_id: agentResult.result_id,
      measured_changes: measuredChanges.length, adapter_status: adapted.work_result.status,
      unresolved: adapted.unresolved.length, guessed_field_count: adapted.guessed_field_count,
      sha256_target_before: before, sha256_target_after_agent: afterAgent, sha256_target_after_router: after,
      agent_direct_target_mutation: agentDirectTargetMutation,
      requested_action_count: agentResult.requested_actions.length,
      routed_outcomes: routed.map((r) => ({ operation: r.action.operation, target: r.action.target, outcome: r.outcome })),
    });
    return await completeExecution(task,
      { output: { agent_result_id: agentResult.result_id }, ok: agentResult.status === "PASS" },
      "agent-host", adapted.work_result);
  }

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
  const capability = matchCapability(task.intent_text, task.route_context);
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
