import { randomUUID } from "node:crypto";
import { saveHandoff, loadHandoffsForTask, loadTask } from "./memory-store";
import type { DnaOsDecision, Evidence, HandoffRecord, HandoffStatus } from "./types";

export interface HandoffInput {
  task_id: string;
  agent_id: string;
  role: string;
  input_reference: string;
  files_read: readonly string[];
  files_changed: readonly string[];
  tests_run: readonly string[];
  status: HandoffStatus;
  evidence_refs: readonly string[];
  blockers: readonly string[];
  next_action: string | null;
}

export interface HandoffAdmission {
  ok: boolean;
  reason_codes: readonly string[];
  evidence: readonly string[];
}

const FORBIDDEN_PATHS = [
  /^\.env(?:\.|$)/i,
  /(^|\/)\.ssh(\/|$)/i,
  /\.(?:pem|key|p12|pfx|mobileprovision)$/i,
  /keychain[^/]*\.(?:db|sqlite|json)$/i,
  /(^|\/)node_modules(\/|$)/i,
];
const SECRET_TEXT = /(password|secret|api[_-]?key|access[_-]?token|bearer\s+[a-z0-9._-]{8,}|private[_-]?key)\s*[:=]/i;

function validPath(path: string): boolean {
  return path.length > 0 && !path.startsWith("/") && !path.includes("..") && !FORBIDDEN_PATHS.some((pattern) => pattern.test(path));
}

export function validateHandoff(input: HandoffInput): HandoffAdmission {
  const reasons: string[] = [];
  const evidence = ["handoff.validator=deterministic", "handoff.policy=fail-closed"];
  if (!input.task_id.trim()) reasons.push("TASK_ID_REQUIRED");
  if (!/^(codex|claude-code|owner-console)(?:[-_.][a-z0-9-]+)*$/i.test(input.agent_id)) reasons.push("AGENT_ID_NOT_ALLOWLISTED");
  if (!input.role.trim()) reasons.push("ROLE_REQUIRED");
  if (!input.input_reference.trim() || SECRET_TEXT.test(input.input_reference)) reasons.push("INPUT_REFERENCE_INVALID_OR_SECRET_BEARING");
  if ([...input.files_read, ...input.files_changed].some((path) => !validPath(path))) reasons.push("FORBIDDEN_FILE_OR_PATH");
  if (input.files_changed.some((path) => /(^|\/)(app\/business|engines\/business|production)(\/|$)/i.test(path))) reasons.push("PRODUCTION_BUSINESS_FILE_FORBIDDEN");
  if (input.status === "VERIFIED" && (input.tests_run.length === 0 || input.evidence_refs.length === 0)) reasons.push("VERIFIED_REQUIRES_TESTS_AND_EVIDENCE");
  if (input.status === "FAILED" && input.blockers.length === 0) reasons.push("FAILED_REQUIRES_BLOCKER");
  if (input.status === "BLOCKED" && (input.blockers.length === 0 || !input.next_action?.trim())) reasons.push("BLOCKED_REQUIRES_BLOCKER_AND_NEXT_ACTION");
  if (input.evidence_refs.some((ref) => !ref.trim() || SECRET_TEXT.test(ref))) reasons.push("EVIDENCE_REFERENCE_INVALID");
  if ((input.next_action?.length ?? 0) > 1_000) reasons.push("NEXT_ACTION_TOO_LONG");
  evidence.push(`handoff.status=${input.status}`, `handoff.reasons=${reasons.length ? reasons.join(",") : "none"}`);
  return { ok: reasons.length === 0, reason_codes: reasons, evidence };
}

/**
 * Owner rule (2026-08-20): the SUBMITTING agent's own `input.status` is
 * never trusted as a final verdict — a self-reported "VERIFIED" is
 * evidence pending DNA OS's own check, not a decision. Mapping:
 * agent status "VERIFIED" -> dna_os_decision "DNA_VALIDATING" (pending;
 * only confirmDnaOsDecision can ever promote this further); "FAILED" ->
 * "DNA_FAILED" (a self-reported failure is trusted as a negative signal —
 * there is no over-trust risk in believing an agent that says it failed);
 * "BLOCKED"/"RECEIVED"/"IN_PROGRESS" -> "DNA_BLOCKED"/"AGENT_SUBMITTED"
 * respectively, both non-final.
 */
function initialDnaOsDecision(status: HandoffStatus): DnaOsDecision {
  switch (status) {
    case "VERIFIED": return "DNA_VALIDATING";
    case "FAILED": return "DNA_FAILED";
    case "BLOCKED": return "DNA_BLOCKED";
    default: return "AGENT_SUBMITTED";
  }
}

export function recordHandoff(
  input: HandoffInput,
  registeredArtifacts?: readonly { resource_type: string; resource_id: string | null; capability_id: string | null }[],
): { ok: true; handoff: HandoffRecord } | { ok: false; admission: HandoffAdmission } {
  const admission = validateHandoff(input);
  if (!admission.ok) return { ok: false, admission };
  const now = new Date().toISOString();
  const handoff: HandoffRecord = { ...input, handoff_id: `handoff_${randomUUID()}`, created_at: now, updated_at: now, dna_os_decision: initialDnaOsDecision(input.status), registered_artifacts: registeredArtifacts };
  saveHandoff(handoff);
  return { ok: true, handoff };
}

/**
 * The ONLY function permitted to ever set dna_os_decision to
 * DNA_VERIFIED. Callable only by DNA OS's own pipeline code — this
 * repo's real, independent checks (e.g.
 * control/agent-gateway/work-order-validator.ts's validateSandboxReadback,
 * a regression test re-run, control/owner-command/input-gateway.ts's
 * admission chain) — never by an agent adapter itself. Appends a NEW
 * handoff record (agent_id="owner-console", the allowlisted DNA-OS-side
 * identity) rather than mutating the agent's original submission, so the
 * agent's own claim and DNA OS's decision remain two separate, both-kept
 * pieces of evidence.
 */
export function confirmDnaOsDecision(taskId: string, decision: "DNA_VERIFIED" | "DNA_FAILED" | "DNA_BLOCKED", evidenceRefs: readonly string[], detail: string): HandoffRecord {
  const now = new Date().toISOString();
  const priorAgentHandoffs = loadHandoffsForTask(taskId).filter((h) => h.agent_id !== "owner-console");
  const handoff: HandoffRecord = {
    handoff_id: `handoff_${randomUUID()}`,
    task_id: taskId,
    agent_id: "owner-console",
    role: "dna_os_decision",
    input_reference: `dna-os://decision/${taskId}`,
    files_read: [],
    files_changed: priorAgentHandoffs.flatMap((h) => h.files_changed),
    tests_run: priorAgentHandoffs.flatMap((h) => h.tests_run),
    status: decision === "DNA_VERIFIED" ? "VERIFIED" : decision === "DNA_FAILED" ? "FAILED" : "BLOCKED",
    evidence_refs: evidenceRefs,
    blockers: decision === "DNA_VERIFIED" ? [] : [detail],
    next_action: decision === "DNA_VERIFIED" ? null : detail,
    created_at: now,
    updated_at: now,
    dna_os_decision: decision,
  };
  saveHandoff(handoff);
  return handoff;
}

/**
 * Machine-readable execution authority (Owner, 2026-08-24, "Close DNA OS
 * Decision -> Work Order -> Dispatch Loop"). `next_action`/`decision_reason`/
 * `next_decision_id`/`decision_input_evidence_ids` are the ORIGINAL fields
 * (2026-08-20) and stay purely advisory/human-readable — no caller may ever
 * branch dispatch logic on them. The fields below are what a caller MUST
 * read to decide whether/how to continue: `decision_id` (alias of
 * next_decision_id), `parent_task_id`, `decision_type`, `reason` (alias of
 * decision_reason), `evidence_refs` (alias of decision_input_evidence_ids),
 * `required_capability`/`target`/`operation`/`scope` (null unless
 * decision_type is "CONTINUE" — the only case a child dispatch is ever
 * warranted), `requires_owner_approval`, `terminal`. A caller MUST NOT
 * dispatch a continuation when `terminal===true` or
 * `requires_owner_approval===true`.
 */
export interface NextDecision {
  next_decision_id: string;
  next_action: string;
  decision_reason: string;
  decision_input_evidence_ids: readonly string[];
  decision_id: string;
  parent_task_id: string;
  decision_type: "OWNER_REVIEW_REQUIRED" | "TERMINAL_VERIFIED" | "CONTINUE";
  reason: string;
  evidence_refs: readonly string[];
  required_capability: string | null;
  target: string | null;
  operation: "VERIFY" | null;
  scope: string | null;
  requires_owner_approval: boolean;
  terminal: boolean;
}

/**
 * Owner rule (2026-08-20, ACCEPTANCE CRITERIA): the DNA OS Decision
 * Engine's next_action must be computed by DETERMINISTIC code reading the
 * REAL, already-persisted evidence for a task — never asserted by
 * Claude/Codex text. This function takes exactly that evidence array
 * (the caller must load it fresh from control/agent-gateway/memory-store.ts's
 * loadEvidenceForTask — see control/owner-command/input-gateway.ts) and
 * derives next_action + decision_reason purely from its contents. No LLM
 * call, no free-text summary — every reason string below quotes the real
 * evidence_id/kind/payload field it read.
 *
 * 2026-08-24 addition: also derives the machine-readable `decision_type`/
 * `terminal`/`requires_owner_approval`/`required_capability` fields, still
 * purely from the same real evidence plus this task's own already-persisted
 * `memory.parent_task_id` (read via loadTask — never fabricated, never an
 * LLM call). The ONE continuation rule this function knows: a ROOT task
 * (parent_task_id === null) whose real verification evidence shows
 * verified===true AND whose capability_lookup evidence shows the read-only
 * `file_duplicate_or_orphan_detection` capability may continue exactly once,
 * with a re-verification of the SAME read-only capability
 * (`operation: "VERIFY"`, never a write). Because the rule only fires for
 * parent_task_id===null, the child task it produces (which always carries a
 * non-null parent_task_id) can never itself continue — this bounds
 * continuation depth to 1 by construction, not by a counter that could be
 * bypassed. Every other case terminates or requires Owner review.
 */
export function computeNextDecisionFromEvidence(taskId: string, evidence: readonly Evidence[]): NextDecision {
  const nextDecisionId = `next-decision-${randomUUID()}`;
  const task = loadTask(taskId);
  const parentTaskId = task?.memory.parent_task_id ?? null;
  const verification = [...evidence].reverse().find((e) => e.kind === "verification");

  if (!verification) {
    const reason = `decision_input=evidence(task_id=${taskId}, count=${evidence.length}) — no evidence with kind="verification" found among ${evidence.map((e) => e.evidence_id).join(",") || "(none)"}`;
    return {
      next_decision_id: nextDecisionId,
      next_action: `ตรวจ status: no verification evidence exists for task_id=${taskId} — Owner review required before this task can be treated as closed`,
      decision_reason: reason,
      decision_input_evidence_ids: evidence.map((e) => e.evidence_id),
      decision_id: nextDecisionId,
      parent_task_id: taskId,
      decision_type: "OWNER_REVIEW_REQUIRED",
      reason,
      evidence_refs: evidence.map((e) => e.evidence_id),
      required_capability: null,
      target: null,
      operation: null,
      scope: null,
      requires_owner_approval: true,
      terminal: false,
    };
  }

  const payload = verification.payload as { verified?: unknown } | null | undefined;
  const verified = payload !== null && typeof payload === "object" && payload.verified === true;
  const reason = `decision_input=evidence_id:${verification.evidence_id} kind:${verification.kind} source:${verification.source} payload.verified:${JSON.stringify(payload && typeof payload === "object" ? payload.verified : undefined)}`;

  if (!verified) {
    return {
      next_decision_id: nextDecisionId,
      next_action: `ตรวจ status: task_id=${taskId} not verified — Owner review required before further dispatch`,
      decision_reason: reason,
      decision_input_evidence_ids: [verification.evidence_id],
      decision_id: nextDecisionId,
      parent_task_id: taskId,
      decision_type: "OWNER_REVIEW_REQUIRED",
      reason,
      evidence_refs: [verification.evidence_id],
      required_capability: null,
      target: null,
      operation: null,
      scope: null,
      requires_owner_approval: true,
      terminal: false,
    };
  }

  const capLookup = [...evidence].reverse().find((e) => e.kind === "capability_lookup");
  const capPayload = capLookup?.payload as { capability?: { problem_type?: string } | null } | null | undefined;
  const matchedCapability = capPayload && typeof capPayload === "object" ? capPayload.capability?.problem_type ?? null : null;
  const eligibleForContinuation = parentTaskId === null && matchedCapability === "file_duplicate_or_orphan_detection";

  if (eligibleForContinuation) {
    const continuationReason = `decision_input=evidence_id:${verification.evidence_id} kind:${verification.kind} payload.verified:true; capability_lookup=${capLookup?.evidence_id ?? "(none)"} matched=file_duplicate_or_orphan_detection; parent_task_id=null (root task, eligible for exactly one bounded re-verification continuation)`;
    return {
      next_decision_id: nextDecisionId,
      next_action: `ตรวจ status: task_id=${taskId} verified — dispatching one bounded read-only re-verification (file_duplicate_or_orphan_detection)`,
      decision_reason: continuationReason,
      decision_input_evidence_ids: capLookup ? [verification.evidence_id, capLookup.evidence_id] : [verification.evidence_id],
      decision_id: nextDecisionId,
      parent_task_id: taskId,
      decision_type: "CONTINUE",
      reason: continuationReason,
      evidence_refs: capLookup ? [verification.evidence_id, capLookup.evidence_id] : [verification.evidence_id],
      required_capability: "file_duplicate_or_orphan_detection",
      target: ".",
      operation: "VERIFY",
      scope: "read-only re-verification, bounded depth=1",
      requires_owner_approval: false,
      terminal: false,
    };
  }

  return {
    next_decision_id: nextDecisionId,
    next_action: `ตรวจ status: task_id=${taskId} verified — no further corrective dispatch required`,
    decision_reason: reason,
    decision_input_evidence_ids: [verification.evidence_id],
    decision_id: nextDecisionId,
    parent_task_id: taskId,
    decision_type: "TERMINAL_VERIFIED",
    reason,
    evidence_refs: [verification.evidence_id],
    required_capability: null,
    target: null,
    operation: null,
    scope: null,
    requires_owner_approval: false,
    terminal: true,
  };
}
