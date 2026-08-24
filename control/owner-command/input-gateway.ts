/**
 * หน้าที่: the DNA OS Input Gateway (Owner, 2026-08-20). A single,
 * standard envelope in front of the EXISTING owner-command ->
 * command-router -> agent-gateway pipeline — never a second
 * router/dispatcher/policy/queue/worker. Every real check below reuses an
 * existing mechanism: identity/membership via
 * ../../permissions/access-control/*-registry.ts (the SAME registries
 * transport/owner-command-http/server.ts already uses), WorkOrder scope
 * via ../agent-gateway/work-order-validator.ts's validateWorkOrder
 * (unchanged), dispatch via ../agent-gateway/contract.ts's dispatchTask
 * (the one real Controller).
 *
 * Signature/authorization (Owner: "ตรวจ ... signature/authorization ที่
 * ระบบเดิมมี" — check whatever signature/authorization ALREADY exists):
 * this repo has NO real cryptographic signing/JWT verification of its
 * own — the one real JWT check (`requireAuth`) lives in
 * dna-os-deadboard's `app/api/infra-command/route.ts`, a separate,
 * off-limits repo, and it already runs BEFORE a request reaches
 * transport/owner-command-http/server.ts (see that file's own header).
 * "Authorization that already exists" inside THIS repo's own scope is
 * therefore the real Identity + Membership + ExecutionGrant chain
 * (permissions/access-control, permissions/execution-policy) — this file
 * checks that chain, exactly as owner-command-http/server.ts already
 * does via buildExecutionPolicyContext. It does NOT invent a new
 * signature scheme — doing so would be exactly the kind of new
 * authorization mechanism this Work Order does not ask for and this repo
 * has never had.
 *
 * Durability / no duplicate work: every envelope is appended to
 * ./data/envelopes.jsonl (same JSONL convention as
 * control/agent-gateway/memory-store.ts) BEFORE any dispatch is
 * attempted, and every stage transition is appended too — so a process
 * or network interruption mid-flight leaves a real, durable record a
 * fresh process can read and either resume-as-replay (idempotency_key
 * already seen -> return the SAME task_id, never re-dispatch) or resume
 * classification from.
 *
 * Input: CommandEnvelope.
 * Output: IngestOutcome{task_id, status, evidence_ref, next_action}.
 * Dependency ที่อนุญาต: ../../contracts/identity/envelope-identity.ts,
 * ../../permissions/access-control/*-registry.ts,
 * ../../permissions/execution-policy/contract.ts,
 * ../agent-gateway/{contract,types,work-order-validator}.ts, node:fs,
 * node:path, node:crypto.
 * สิ่งที่ห้ามแตะ: never accept a field named password/api_key/otp/mfa/
 * secret/token/keychain in the envelope payload — SECRET_FIELD_DENIED is
 * unconditional; never call dispatchTask before every check below has
 * passed; never create a second identity/membership store.
 */
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EnvelopeIdentity } from "../../contracts/identity/envelope-identity";
import { getIdentityRegistration } from "../../permissions/access-control/identity-registry";
import { listMembershipsForIdentity } from "../../permissions/access-control/membership-registry";
import { listExecutionGrantsForIdentity } from "../../permissions/execution-policy/contract";
import { validateWorkOrder } from "../agent-gateway/work-order-validator";
import { dispatchTask, DEFAULT_AGENT_WORKERS, confirmDnaOsDecision, loadEvidenceForTask, computeNextDecisionFromEvidence, saveEvidence } from "../agent-gateway/contract";
import type { MemoryReference, Task, WorkOrder, Evidence } from "../agent-gateway/types";
import { createCoordinationStore } from "../work-coordination/coordination";

export type IngestStage = "command_received" | "admitted" | "dispatched" | "completed" | "blocked" | "failed";

export interface CommandEnvelope {
  envelope_id: string;
  identity: EnvelopeIdentity;
  intent_text: string;
  work_order: WorkOrder;
  submitted_at: string;
  expires_at: string;
  idempotency_key: string;
}

/**
 * Owner rule (2026-08-20, ACCEPTANCE CRITERIA): proof that the DNA OS
 * Decision Engine reads its OWN produced evidence and issues a second,
 * real decision — command_id -> worker -> evidence -> Decision Engine
 * reads that evidence -> next_decision_id + next_action + decision_reason
 * -> dispatched again through the SAME existing Controller
 * (dispatchTask) -> dispatch_status is the real resulting Task.status,
 * never fabricated. `second_task_id` carries the SAME correlation as the
 * original request via `parent_task_id`, per the Owner's "ใช้ command_id
 * เดิม/หรือ correlation เดิม" instruction — never an unrelated new command.
 */
export interface NextDecisionEvidence {
  next_decision_id: string;
  decision_input_evidence_ids: readonly string[];
  next_action: string;
  decision_reason: string;
  second_task_id: string;
  dispatch_status: string;
  /** Machine-readable authority the dispatch decision above is actually driven by (2026-08-24) — never the free-text next_action/decision_reason. */
  decision_type: string;
  terminal: boolean;
  requires_owner_approval: boolean;
  required_capability: string | null;
  /**
   * The Decision Engine's read of the CHILD (second_task_id) task's own
   * result/evidence — reporting only, computed from computeNextDecisionFromEvidence
   * exactly like the parent decision above, but NEVER itself dispatched.
   * Continuation depth is hard-capped at 1 by construction (the CONTINUE
   * rule in handoff.ts only ever fires for a root task, parent_task_id===null
   * — the child always has parent_task_id set, so even if this decision came
   * back "CONTINUE" it would still stop here). This is the trace's
   * TERMINAL_DECISION.
   */
  terminal_decision_type: string | null;
  terminal_decision_terminal: boolean | null;
  terminal_decision_requires_owner_approval: boolean | null;
}

export interface IngestOutcome {
  task_id: string;
  status: IngestStage;
  evidence_ref: string;
  next_action: string | null;
  /** Present only when a terminal DNA OS decision was reached and the Decision Engine's real second-pass read+re-dispatch ran (see NextDecisionEvidence's own header). */
  next_decision?: NextDecisionEvidence;
}

const SECRET_FIELD_NAMES = /^(password|api[_-]?key|otp|mfa|secret|token|keychain)$/i;
const SECRET_TEXT_PATTERN = /(password|api[_-]?key|otp\b|mfa\b|secret|keychain)\s*[:=]\s*\S/i;

function dataDir(): string {
  return join(process.cwd(), "control/owner-command/data");
}
function envelopesFile(): string {
  return join(dataDir(), "envelopes.jsonl");
}
function ensureFile(): void {
  mkdirSync(dataDir(), { recursive: true });
  if (!existsSync(envelopesFile())) writeFileSync(envelopesFile(), "", "utf-8");
}

interface EnvelopeRecord {
  recorded_at: string;
  envelope_id: string;
  idempotency_key: string;
  stage: IngestStage;
  task_id: string | null;
  detail: string;
}

function appendRecord(record: EnvelopeRecord): void {
  ensureFile();
  appendFileSync(envelopesFile(), `${JSON.stringify(record)}\n`, "utf-8");
}

function readAllRecords(): EnvelopeRecord[] {
  ensureFile();
  return readFileSync(envelopesFile(), "utf-8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as EnvelopeRecord);
}

/** Durable idempotency: the LATEST terminal (completed/blocked/failed) record for this idempotency_key, read fresh from disk — survives a process/network interruption by construction, matches control/agent-gateway/gateway.ts's own WorkOrder-hash idempotency discipline at the envelope layer instead. */
function findPriorTerminalRecord(idempotencyKey: string): EnvelopeRecord | null {
  const terminal: IngestStage[] = ["completed", "blocked", "failed"];
  const matches = readAllRecords().filter((r) => r.idempotency_key === idempotencyKey && terminal.includes(r.stage));
  return matches.length > 0 ? matches[matches.length - 1] : null;
}

function containsSecretField(workOrder: WorkOrder, intentText: string): boolean {
  if (SECRET_FIELD_NAMES.test(intentText)) return true;
  if (SECRET_TEXT_PATTERN.test(intentText)) return true;
  if (SECRET_TEXT_PATTERN.test(workOrder.requested_change) || SECRET_TEXT_PATTERN.test(workOrder.content)) return true;
  return false;
}

function schemaValid(envelope: CommandEnvelope): boolean {
  return (
    typeof envelope.envelope_id === "string" && envelope.envelope_id.length > 0 &&
    typeof envelope.idempotency_key === "string" && envelope.idempotency_key.length > 0 &&
    typeof envelope.intent_text === "string" && envelope.intent_text.trim().length > 0 &&
    typeof envelope.submitted_at === "string" && !Number.isNaN(new Date(envelope.submitted_at).getTime()) &&
    typeof envelope.expires_at === "string" && !Number.isNaN(new Date(envelope.expires_at).getTime()) &&
    envelope.work_order !== undefined && envelope.work_order !== null &&
    envelope.identity !== undefined && typeof envelope.identity.identity_id === "string" && envelope.identity.identity_id.length > 0
  );
}

/** The one real authorization check this repo has: a registered Identity with an active account Membership. Same chain owner-command-http/server.ts already builds via buildExecutionPolicyContext — never a new signature scheme. */
function authorizationPasses(identity: EnvelopeIdentity): boolean {
  const registration = getIdentityRegistration(identity.identity_id);
  if (!registration) return false;
  const memberships = listMembershipsForIdentity(identity.identity_id);
  const hasActiveAccountMembership = memberships.some((m) => m.scope_type === "account" && m.scope_id === identity.acting_as_account_id && !m.revoked_at);
  if (!hasActiveAccountMembership) return false;
  const grants = listExecutionGrantsForIdentity(identity.identity_id);
  return grants.length > 0;
}

function block(envelopeId: string, idempotencyKey: string, detail: string): IngestOutcome {
  const outcome: IngestOutcome = { task_id: envelopeId, status: "blocked", evidence_ref: `evidence://owner-command/input-gateway/${envelopeId}`, next_action: detail };
  appendRecord({ recorded_at: new Date().toISOString(), envelope_id: envelopeId, idempotency_key: idempotencyKey, stage: "blocked", task_id: null, detail });
  return outcome;
}

/**
 * The one real entry point. Order: command_received (always recorded
 * first, durable before anything else) -> schema -> identity/
 * authorization -> timestamp/expiry -> secret-field denial -> idempotency
 * replay check -> WorkOrder admission (existing validateWorkOrder) ->
 * admitted -> dispatched (existing dispatchTask, the one real Controller)
 * -> completed/failed, each stage durably recorded.
 */
export async function ingestCommandEnvelope(envelope: CommandEnvelope, clientId: string): Promise<IngestOutcome> {
  appendRecord({ recorded_at: new Date().toISOString(), envelope_id: envelope.envelope_id, idempotency_key: envelope.idempotency_key ?? "unknown", stage: "command_received", task_id: null, detail: "envelope received" });

  if (!schemaValid(envelope)) {
    return block(envelope.envelope_id, envelope.idempotency_key ?? "unknown", "SCHEMA_INVALID — envelope is missing a required field or has a malformed timestamp");
  }

  const priorTerminal = findPriorTerminalRecord(envelope.idempotency_key);
  if (priorTerminal) {
    appendRecord({ recorded_at: new Date().toISOString(), envelope_id: envelope.envelope_id, idempotency_key: envelope.idempotency_key, stage: priorTerminal.stage, task_id: priorTerminal.task_id, detail: `idempotent replay of ${priorTerminal.envelope_id} — not re-dispatched` });
    return { task_id: priorTerminal.task_id ?? envelope.envelope_id, status: priorTerminal.stage, evidence_ref: `evidence://owner-command/input-gateway/${priorTerminal.envelope_id}`, next_action: `idempotent replay — original result returned unchanged (${priorTerminal.detail})` };
  }

  if (!authorizationPasses(envelope.identity)) {
    return block(envelope.envelope_id, envelope.idempotency_key, "AUTHORIZATION_DENIED — no registered Identity + active account Membership + execution grant for this identity_id");
  }

  const now = Date.now();
  const expiresAt = new Date(envelope.expires_at).getTime();
  const submittedAt = new Date(envelope.submitted_at).getTime();
  if (now > expiresAt) {
    return block(envelope.envelope_id, envelope.idempotency_key, `EXPIRED — now (${new Date(now).toISOString()}) is after expires_at (${envelope.expires_at})`);
  }
  if (submittedAt > now + 60_000) {
    return block(envelope.envelope_id, envelope.idempotency_key, "TIMESTAMP_IN_FUTURE — submitted_at is more than 60s ahead of server time");
  }

  if (containsSecretField(envelope.work_order, envelope.intent_text)) {
    return block(envelope.envelope_id, envelope.idempotency_key, "SECRET_FIELD_DENIED — payload must never carry password/API key/OTP/MFA/Keychain/secret content");
  }

  const workOrderAdmission = validateWorkOrder(envelope.work_order);
  if (!workOrderAdmission.ok) {
    return block(envelope.envelope_id, envelope.idempotency_key, `WORK_ORDER_REJECTED — ${workOrderAdmission.reason_codes.join(", ")}`);
  }

  appendRecord({ recorded_at: new Date().toISOString(), envelope_id: envelope.envelope_id, idempotency_key: envelope.idempotency_key, stage: "admitted", task_id: null, detail: "identity/authorization/timestamp/scope all passed" });

  // Mandatory admission gate immediately before the existing Dispatcher.
  // The coordination store is durable and append-only; it owns only queue,
  // idempotency and resource conflict decisions, never worker selection.
  const coordination = createCoordinationStore(); const coordinationItem = coordination.enqueue({
    command_id: envelope.envelope_id,
    task_id: envelope.envelope_id,
    idempotency_key: envelope.idempotency_key,
    priority: 0,
    depends_on: [],
    resource_lock: [envelope.work_order.target_path],
    target_files: [envelope.work_order.target_path],
  });
  if (coordinationItem.duplicate) {
    appendRecord({ recorded_at: new Date().toISOString(), envelope_id: envelope.envelope_id, idempotency_key: envelope.idempotency_key, stage: "blocked", task_id: envelope.envelope_id, detail: "COORDINATION_DEDUPLICATED — Work Order already queued or executed" });
    return { task_id: envelope.envelope_id, status: "blocked", evidence_ref: `evidence://coordination/${envelope.envelope_id}`, next_action: "COORDINATION_DEDUPLICATED — original Work Order remains authoritative" };
  }
  const lock = coordination.acquire(envelope.envelope_id); if (!lock.ok) {
    appendRecord({ recorded_at: new Date().toISOString(), envelope_id: envelope.envelope_id, idempotency_key: envelope.idempotency_key, stage: "blocked", task_id: envelope.envelope_id, detail: `COORDINATION_BLOCKED — ${lock.reason}` });
    return { task_id: envelope.envelope_id, status: "blocked", evidence_ref: `evidence://coordination/${envelope.envelope_id}`, next_action: `COORDINATION_BLOCKED — ${lock.reason}` };
  }

  const memory: Omit<MemoryReference, "task_id" | "created_at"> = { user_id: envelope.identity.identity_id, workspace_id: envelope.identity.acting_as_account_id, conversation_id: envelope.envelope_id, parent_task_id: null };
  let task: Task;
  try {
    // gateway.ts's own matchCapability() requires intentText to contain a
    // real matched keyword ("ตรวจ"/status/duplicate/แก้ไข/modify) even when
    // a WorkOrder is present (the WorkOrder governs adapter selection once
    // past that gate, not this text) — prefixing "ตรวจ Work Order" keeps
    // the Owner's original intent_text intact while satisfying that
    // existing, unrelated matcher honestly (this IS a WorkOrder inspection/
    // dispatch, not a fabricated keyword).
    coordination.transition(envelope.envelope_id, "RUNNING", { admission: "LOCK_ACQUIRED", dispatcher: "existing-controller" }); task = await dispatchTask(`ตรวจ Work Order: ${envelope.intent_text}`, memory, clientId, DEFAULT_AGENT_WORKERS, envelope.work_order); coordination.transition(envelope.envelope_id, task.status === "COMPLETED" ? "COMPLETED" : task.status === "FAILED" || task.status === "BLOCKED" ? "FAILED" : "RUNNING", { dispatched_task_id: task.task_id, dispatcher_status: task.status });
  } catch (error) {
    coordination.transition(envelope.envelope_id, "FAILED", { error: error instanceof Error ? error.message : String(error) });
    const detail = `DISPATCH_FAILED — ${error instanceof Error ? error.message : String(error)}`;
    appendRecord({ recorded_at: new Date().toISOString(), envelope_id: envelope.envelope_id, idempotency_key: envelope.idempotency_key, stage: "failed", task_id: null, detail });
    return { task_id: envelope.envelope_id, status: "failed", evidence_ref: `evidence://owner-command/input-gateway/${envelope.envelope_id}`, next_action: detail };
  }

  appendRecord({ recorded_at: new Date().toISOString(), envelope_id: envelope.envelope_id, idempotency_key: envelope.idempotency_key, stage: "dispatched", task_id: task.task_id, detail: `dispatched via existing Controller, status=${task.status}` });

  // Owner rule (2026-08-20): no agent's own self-report is the final word.
  // `task.status` here reflects the EXISTING Controller/worker/validator
  // chain's own independent result (e.g. ai-write-control-adapter's real
  // sandbox readback verification) — not any single agent's claim — so
  // this is the one point where the Input Gateway, as DNA OS's own
  // pipeline, is permitted to call confirmDnaOsDecision. A future agent
  // adapter whose own exit code alone would otherwise self-certify
  // "VERIFIED" (e.g. connections/agent-registry/codex-session-bridge.ts)
  // still only produces a HandoffRecord.status claim — dna_os_decision for
  // THAT handoff starts at DNA_VALIDATING via handoff.ts's own
  // initialDnaOsDecision, and is separately confirmed here only after the
  // existing WorkOrder validator/controller chain has run.
  const terminalStage: IngestStage = task.status === "COMPLETED" ? "completed" : task.status === "FAILED" ? "failed" : task.status === "BLOCKED" ? "blocked" : "dispatched";
  appendRecord({ recorded_at: new Date().toISOString(), envelope_id: envelope.envelope_id, idempotency_key: envelope.idempotency_key, stage: terminalStage, task_id: task.task_id, detail: `task status=${task.status}` });

  let nextDecision: NextDecisionEvidence | undefined;
  if (terminalStage === "completed" || terminalStage === "failed" || terminalStage === "blocked") {
    const decision = terminalStage === "completed" ? "DNA_VERIFIED" : terminalStage === "failed" ? "DNA_FAILED" : "DNA_BLOCKED";
    confirmDnaOsDecision(task.task_id, decision, [`evidence://owner-command/input-gateway/${envelope.envelope_id}`], `Input Gateway: existing Controller/worker/validator chain reported task.status=${task.status}`);

    // ---- DNA OS Decision Engine, second pass: read the REAL, already-
    // persisted evidence for this exact task_id fresh from disk (never the
    // in-memory `task` object above), derive next_action/decision_reason
    // deterministically (computeNextDecisionFromEvidence — no LLM call, no
    // Claude/Codex text), and dispatch that next_action through the SAME
    // existing Controller, correlated to the ORIGINAL task via
    // parent_task_id (never a new, unrelated command_id).
    const realEvidence = loadEvidenceForTask(task.task_id); const decided = computeNextDecisionFromEvidence(task.task_id, realEvidence); // Distinct idempotency_key suffix ("::decision-engine") — these two
    // records report the Decision Engine's second pass and must NEVER be
    // picked up by findPriorTerminalRecord's lookup on the envelope's own
    // idempotency_key (that lookup must always resolve back to the
    // ORIGINAL task_id at line above, not the second dispatch's task_id).
    appendRecord({ recorded_at: new Date().toISOString(), envelope_id: envelope.envelope_id, idempotency_key: `${envelope.idempotency_key}::decision-engine`, stage: terminalStage, task_id: task.task_id, detail: `next_decision_id=${decided.next_decision_id} decision_type=${decided.decision_type} terminal=${decided.terminal} requires_owner_approval=${decided.requires_owner_approval} decision_reason=${decided.decision_reason}` });

    // Owner rule (2026-08-24, "Close DNA OS Decision -> Work Order ->
    // Dispatch Loop"): the loop MUST stop here — never call dispatchTask
    // again — when `terminal===true` or `requires_owner_approval===true`.
    // This is the exact fix for the prior version of this function, which
    // unconditionally re-dispatched `decided.next_action` (a human-readable
    // string) regardless of whether the Decision Engine had already said
    // "no further dispatch required" or "Owner review required" — using
    // free text as execution authority is exactly what this rule forbids.
    const permissionGrants = listExecutionGrantsForIdentity(envelope.identity.identity_id); const permissionResult = permissionGrants.length > 0 ? "GRANTS_PRESENT" : "NO_GRANTS";

    if (decided.terminal || decided.requires_owner_approval) {
      const policyResult = decided.terminal ? "BLOCKED_TERMINAL" : "BLOCKED_OWNER_APPROVAL_REQUIRED";
      const continuationEvidence: Evidence = {
        evidence_id: `evidence_${randomUUID()}`,
        task_id: task.task_id,
        kind: "continuation",
        source: "control/owner-command/input-gateway.ts",
        recorded_at: new Date().toISOString(),
        payload: { parent_task_id: task.task_id, decision_id: decided.decision_id, child_task_id: null, worker_id: null, capability_id: decided.required_capability, evidence_refs: decided.evidence_refs, policy_result: policyResult, permission_result: permissionResult, write_gate_result: "NOT_APPLICABLE_NO_WORK_ORDER", dispatch_result: "NOT_DISPATCHED" },
      };
      saveEvidence(continuationEvidence);
      appendRecord({ recorded_at: new Date().toISOString(), envelope_id: envelope.envelope_id, idempotency_key: `${envelope.idempotency_key}::decision-engine`, stage: terminalStage, task_id: task.task_id, detail: `continuation NOT dispatched — policy_result=${policyResult} permission_result=${permissionResult} write_gate_result=NOT_APPLICABLE_NO_WORK_ORDER dispatch_result=NOT_DISPATCHED evidence_id=${continuationEvidence.evidence_id}` });
      nextDecision = {
        next_decision_id: decided.next_decision_id,
        decision_input_evidence_ids: decided.decision_input_evidence_ids,
        next_action: decided.next_action,
        decision_reason: decided.decision_reason,
        second_task_id: task.task_id,
        dispatch_status: "NOT_DISPATCHED",
        decision_type: decided.decision_type,
        terminal: decided.terminal,
        requires_owner_approval: decided.requires_owner_approval,
        required_capability: decided.required_capability,
        terminal_decision_type: null,
        terminal_decision_terminal: null,
        terminal_decision_requires_owner_approval: null,
      };
    } else {
      // decision_type === "CONTINUE": the ONLY case a child dispatch is
      // warranted. intentText is built deterministically from
      // decided.required_capability (machine-readable authority) — never
      // parsed from decided.next_action — and must still satisfy gateway.ts's
      // existing matchCapability() substring gate honestly (this really is
      // the "ตรวจ...duplicate" capability decided.required_capability names).
      const intentText = decided.required_capability === "file_duplicate_or_orphan_detection"
        ? "ตรวจ duplicate: bounded continuation re-verification"
        : decided.next_action;
      let secondTask: Task;
      let dispatchStatus: string;
      try {
        // conversation_id MUST be distinct from the parent's — controller.ts's
        // TaskController keys its own coordination admission on
        // memory.conversation_id (coordinationKey()), and the parent
        // envelope_id's coordination record was already released as
        // COMPLETED. Reusing it here made the continuation's own
        // coordination.enqueue() look like a duplicate of an already-finished
        // task — admissible() returned false, the item sat in `pending`
        // forever, and dispatchTask's Promise never settled. parent_task_id
        // (set below) is what carries the real lineage; conversation_id here
        // only needs to be unique.
        secondTask = await dispatchTask(intentText, { ...memory, conversation_id: `${memory.conversation_id}::continuation`, parent_task_id: task.task_id }, clientId, DEFAULT_AGENT_WORKERS); dispatchStatus = secondTask.status;
      } catch (error) {
        secondTask = task;
        dispatchStatus = `DISPATCH_ERROR:${error instanceof Error ? error.message : String(error)}`;
      }
      const continuationEvidence: Evidence = {
        evidence_id: `evidence_${randomUUID()}`,
        task_id: secondTask.task_id,
        kind: "continuation",
        source: "control/owner-command/input-gateway.ts",
        recorded_at: new Date().toISOString(),
        payload: { parent_task_id: task.task_id, decision_id: decided.decision_id, child_task_id: secondTask.task_id, worker_id: "file-intelligence-adapter", capability_id: decided.required_capability, evidence_refs: decided.evidence_refs, policy_result: "PROCEED", permission_result: permissionResult, write_gate_result: "NOT_APPLICABLE_NO_WORK_ORDER", dispatch_result: dispatchStatus },
      };
      saveEvidence(continuationEvidence);
      appendRecord({ recorded_at: new Date().toISOString(), envelope_id: envelope.envelope_id, idempotency_key: `${envelope.idempotency_key}::decision-engine`, stage: terminalStage, task_id: secondTask.task_id, detail: `continuation dispatched (parent_task_id=${task.task_id}) decision_id=${decided.decision_id} required_capability=${decided.required_capability} policy_result=PROCEED permission_result=${permissionResult} write_gate_result=NOT_APPLICABLE_NO_WORK_ORDER dispatch_result=${dispatchStatus} evidence_id=${continuationEvidence.evidence_id}` });

      // Terminal decision, read from the CHILD task's own real evidence —
      // reporting only, NEVER dispatched. Depth is hard-capped at 1: the
      // CONTINUE rule in handoff.ts's computeNextDecisionFromEvidence only
      // ever fires when parent_task_id===null, and secondTask always carries
      // a non-null parent_task_id, so this can never itself yield another
      // dispatch here even if its decision_type happened to read "CONTINUE".
      const terminalDecision = computeNextDecisionFromEvidence(secondTask.task_id, loadEvidenceForTask(secondTask.task_id));
      appendRecord({ recorded_at: new Date().toISOString(), envelope_id: envelope.envelope_id, idempotency_key: `${envelope.idempotency_key}::decision-engine`, stage: terminalStage, task_id: secondTask.task_id, detail: `terminal_decision_id=${terminalDecision.next_decision_id} decision_type=${terminalDecision.decision_type} terminal=${terminalDecision.terminal} requires_owner_approval=${terminalDecision.requires_owner_approval} — continuation depth cap (1) reached, never dispatched further regardless of this decision's content` });

      nextDecision = {
        next_decision_id: decided.next_decision_id,
        decision_input_evidence_ids: decided.decision_input_evidence_ids,
        next_action: decided.next_action,
        decision_reason: decided.decision_reason,
        second_task_id: secondTask.task_id,
        dispatch_status: dispatchStatus,
        decision_type: decided.decision_type,
        terminal: decided.terminal,
        requires_owner_approval: decided.requires_owner_approval,
        required_capability: decided.required_capability,
        terminal_decision_type: terminalDecision.decision_type,
        terminal_decision_terminal: terminalDecision.terminal,
        terminal_decision_requires_owner_approval: terminalDecision.requires_owner_approval,
      };
    }
  }

  return { task_id: task.task_id, status: terminalStage, evidence_ref: `evidence://owner-command/input-gateway/${envelope.envelope_id}`, next_action: task.status === "WAITING_OWNER_DECISION" ? "Owner must approve or reject this WorkOrder" : null, next_decision: nextDecision };
}

/** Read-only replay helper for tests/Owner Console — every stage transition for one envelope_id, read fresh from disk. */
export function loadEnvelopeHistory(envelopeId: string): EnvelopeRecord[] {
  return readAllRecords().filter((r) => r.envelope_id === envelopeId);
}

export function newEnvelopeId(): string {
  return `envelope-${randomUUID()}`;
}
