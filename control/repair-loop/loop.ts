/**
 * หน้าที่: run ONE repair cycle end to end, and decide whether a next one is
 * reachable.
 *
 *   scan gaps -> pick the highest-priority actionable gap -> root-cause it
 *   -> build the repair item -> route it through the EXISTING n8n pipe
 *   -> hand the package to the agent -> deterministic verification
 *   -> re-scan -> record the real before/after -> name the next gap
 *
 * n8n IS TRANSPORT ONLY. It receives the repair event and returns a route
 * group; every engineering decision — what the cause is, what may be touched,
 * whether the change is acceptable — happens in this repo. Nothing in this
 * file asks n8n a question whose answer would change the source.
 *
 * THE LOOP REFUSES MORE OFTEN THAN IT ACTS, ON PURPOSE. A gap is dispatched
 * only when root-cause analysis says a repair is genuinely required. An
 * expected policy block, a by-design termination, and a capability that
 * merely lacks proof all return "no repair" — sending an agent at any of
 * them would damage a working system.
 *
 * Input: `runRepairCycle` options.
 * Output: `RepairCycleOutcome`.
 * Dependency ที่อนุญาต: ./types.ts, ./gap-scanner.ts, ./root-cause.ts,
 * ./repair-item.ts, ./verifier.ts, ../agent-gateway/contract.ts,
 * ../../connections/n8n/contract.ts, node:fs.
 * สิ่งที่ห้ามแตะ: never raise MAX_ATTEMPTS_PER_GAP without the Owner. Never
 * let a cycle run when the previous attempt had the same error_signature AND
 * the same code_hash — that pair is the definition of no progress, and
 * looping on it burns real money and real time for nothing.
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { saveEvidence } from "../agent-gateway/contract";
import { routeDnaOsEvent } from "../../connections/n8n/contract";
import type { DnaOsCentralEvent } from "../../connections/n8n/contract";
import { scanGaps } from "./gap-scanner";
import { analyzeRootCause } from "./root-cause";
import { buildRepairWorkItem } from "./repair-item";
import { hashProposal, verifyProposal, VERIFIER_VERSION } from "./verifier";
import type {
  AgentProposal, GapRecord, RepairAttemptRecord, RepairCycleOutcome, RepairWorkItem, StopCondition,
} from "./types";

const SOURCE = "control/repair-loop/loop.ts";
const ATTEMPT_LOG = join(__dirname, "data", "repair-attempts.jsonl");
export const MAX_ATTEMPTS_PER_GAP = 3;

function nowIso(): string { return new Date().toISOString(); }

/**
 * Repair type -> an event_type prefix the n8n classifier already recognises.
 * This is DNA OS translating its own vocabulary into the router's, which is
 * the right direction: the router stays a transport that classifies from
 * signals it knows, and no engineering meaning moves into it.
 */
const REPAIR_TYPE_EVENT_PREFIX: Readonly<Record<import("./types").RepairType, string>> = {
  CODE_DEFECT: "build",
  MISSING_IMPLEMENTATION: "build",
  CONTRACT_MISMATCH: "build",
  TEST_FAILURE: "test",
  MISSING_CONNECTION: "integration",
  RUNTIME_FAILURE: "runtime",
  SECURITY_BLOCK: "security",
  REGISTRY_MISMATCH: "registry",
  EVIDENCE_MISSING: "evidence",
  INFRASTRUCTURE_FAILURE: "infra",
};

function loadAttempts(): RepairAttemptRecord[] {
  if (!existsSync(ATTEMPT_LOG)) return [];
  return readFileSync(ATTEMPT_LOG, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as RepairAttemptRecord);
}

function recordAttempt(record: RepairAttemptRecord): void {
  appendFileSync(ATTEMPT_LOG, `${JSON.stringify(record)}\n`);
}

/**
 * LOOP PROTECTION. Two independent stops, because they catch different
 * failures: a bounded attempt count catches "this gap resists repair", and
 * the signature+hash pair catches "the agent proposed the identical change
 * again", which would otherwise burn the whole attempt budget re-testing the
 * same bytes.
 */
export function loopCheck(errorSignature: string, codeHash: string | null): { stop: StopCondition | null; attempt: number; detail: string } {
  // Only attempts judged by the CURRENT verifier count. A verdict reached by
  // a verifier that has since been corrected says nothing about whether the
  // change works — see verifier.ts's VERIFIER_VERSION for the real case that
  // forced this. Older records are kept and remain readable; they simply do
  // not bind a change that was never fairly evaluated.
  const history = loadAttempts().filter(
    (a) => a.error_signature === errorSignature && (a.verifier_version ?? "v1") === VERIFIER_VERSION);
  const attempt = history.length + 1;
  if (history.length >= MAX_ATTEMPTS_PER_GAP) {
    return { stop: "MAX_ATTEMPTS_REACHED", attempt, detail: `${history.length} attempts already made on signature ${errorSignature} under verifier ${VERIFIER_VERSION}` };
  }
  if (codeHash && history.some((a) => a.code_hash === codeHash)) {
    return { stop: "NO_PROGRESS", attempt, detail: `an identical change (code_hash ${codeHash}) was already judged by verifier ${VERIFIER_VERSION} against this signature` };
  }
  return { stop: null, attempt, detail: `attempt ${attempt} of ${MAX_ATTEMPTS_PER_GAP} for signature ${errorSignature}` };
}

/**
 * Conditions under which the loop stops on its own, before dispatching. Each
 * one is something no automated repair may decide: they cost money, change a
 * security boundary, destroy data, or have nothing to verify against.
 */
export function preDispatchStop(repair: RepairWorkItem): StopCondition | null {
  if (repair.evidence_refs.length === 0 && repair.registry_refs.length === 0) return "NO_VERIFIABLE_EVIDENCE";
  if (repair.repair_type === "SECURITY_BLOCK") return "SECURITY_BOUNDARY_CHANGE_REQUIRED";
  if (repair.repair_type === "INFRASTRUCTURE_FAILURE") return "PAID_RESOURCE_REQUIRED";
  if (repair.allowed_paths.some((p) => p.startsWith("permissions/") || p.startsWith("credentials/"))) {
    return "SECURITY_BOUNDARY_CHANGE_REQUIRED";
  }
  // Registering a new routable destination in the command-router registry is
  // an architectural decision: it declares that Owner commands may be sent
  // somewhere new. No automated repair may make that call, however obvious
  // the gap looks.
  if (repair.repair_type === "REGISTRY_MISMATCH" && repair.failed_capability_id.endsWith("/")) {
    return "OWNER_DECISION_REQUIRED";
  }

  // Folder-ownership is NOT checked here. It was, briefly, against
  // allowed_paths — but allowed_paths is a permission list, not the change:
  // a repair allowed to touch two folders where only one is registered would
  // pass that check and still be denied at the gate. The real target list
  // exists only once the agent has proposed, so the check lives in
  // verifier.ts's SOURCE_VALIDATION, per file.
  return null;
}

function repairEvent(repair: RepairWorkItem): DnaOsCentralEvent {
  return {
    event_id: repair.event_id,
    work_id: repair.work_id,
    trace_id: repair.trace_id,
    owner_id: "owner-tam",
    source: SOURCE,
    // The event_type carries a prefix the n8n classifier ALREADY knows.
    //
    // The first version used `repair.<type>.requested`, which matched no
    // group and came back UNRESOLVED_OWNER — correctly, because the
    // classifier refuses to guess. The fix belongs here rather than in n8n:
    // adding a "repair." family to the router would put engineering meaning
    // inside the transport layer, which is exactly what the Owner ruled out.
    // DNA OS knows what kind of work a repair is; it says so in a vocabulary
    // the router already speaks.
    event_type: `${REPAIR_TYPE_EVENT_PREFIX[repair.repair_type]}.repair.requested`,
    severity: "HIGH",
    status: "OPEN",
    message: `${repair.repair_type} at ${repair.failed_boundary}`,
    capability_id: repair.failed_capability_id,
    resource_id: null,
    error_code: repair.error_code,
    evidence_ref: repair.evidence_refs[0] ?? repair.registry_refs[0] ?? null,
    occurred_at: nowIso(),
    // Identifiers and short reasons only. No source content leaves the
    // machine: the agent reads the repo locally, n8n only routes.
    payload: {
      repair_id: repair.repair_id,
      root_cause_class: repair.root_cause_class,
      failed_boundary: repair.failed_boundary,
      allowed_paths: repair.allowed_paths,
      attempt: repair.attempt,
      error_signature: repair.error_signature,
    },
    hop_count: 0,
    origin: SOURCE,
  };
}

export interface RepairCycleOptions {
  /** Supplies the agent's proposal for a repair item. Absent = analyse and route only, never write. */
  readonly agent?: (repair: RepairWorkItem) => AgentProposal | null;
  /** Restrict the cycle to one gap id — used by the first proof. */
  readonly only_gap_id?: string;
  readonly trace_id?: string;
}

function selectGap(queue: readonly GapRecord[], onlyGapId?: string): GapRecord | null {
  if (onlyGapId) return queue.find((g) => g.gap_id === onlyGapId) ?? null;
  return queue.find((g) => g.actionable) ?? null;
}

export async function runRepairCycle(options: RepairCycleOptions = {}): Promise<RepairCycleOutcome> {
  const traceId = options.trace_id ?? `trace-repair-${randomUUID().slice(0, 8)}`;
  const before = scanGaps();
  const gap = selectGap(before.queue, options.only_gap_id);

  if (!gap) {
    const empty: GapRecord = {
      gap_id: "none", capability_id: "none", source_path: null, state: "UNKNOWN",
      reason: "no actionable gap in the queue", evidence_refs: [], registry_refs: [],
      upstream: [], downstream: [], depth: 0, occurrences: 0, first_seen: null, last_seen: null,
      repair_type: null, actionable: false, not_actionable_reason: "queue empty",
    };
    return {
      repair: null, gap: empty, root_cause_class: "UNDETERMINED", dispatched: false, route_group: null,
      proposal: null, verdict: null, graph_before: "UNKNOWN", graph_after: "UNKNOWN",
      stopped: null, evidence_ref: "none", next_gap_id: null,
    };
  }

  const finding = analyzeRootCause(gap);
  const graphBefore = gap.state;

  // --- the loop's most important refusal --------------------------------
  if (!finding.repair_required) {
    const outcome: RepairCycleOutcome = {
      repair: null, gap, root_cause_class: finding.root_cause_class, dispatched: false, route_group: null,
      proposal: null, verdict: null, graph_before: graphBefore, graph_after: graphBefore,
      stopped: finding.root_cause_class === "UNDETERMINED" ? "NO_VERIFIABLE_EVIDENCE" : null,
      evidence_ref: persist(traceId, gap, finding.root_cause_class, null, null, null),
      next_gap_id: before.queue.find((g) => g.gap_id !== gap.gap_id && g.actionable)?.gap_id ?? null,
    };
    return outcome;
  }

  const repair = buildRepairWorkItem(gap, finding, {
    trace_id: traceId, attempt: 1,
    existing_tests: ["npx tsc --noEmit -p tsconfig.json", "npx tsx control/registration-pipeline/tests/registration-pipeline.test.ts"],
  });
  if (!repair) {
    return {
      repair: null, gap, root_cause_class: finding.root_cause_class, dispatched: false, route_group: null,
      proposal: null, verdict: null, graph_before: graphBefore, graph_after: graphBefore,
      stopped: "NO_VERIFIABLE_EVIDENCE",
      evidence_ref: persist(traceId, gap, finding.root_cause_class, null, null, null),
      next_gap_id: null,
    };
  }

  const stopBefore = preDispatchStop(repair);
  const guard = loopCheck(repair.error_signature, null);
  const stopped = stopBefore ?? guard.stop;
  if (stopped) {
    return {
      repair, gap, root_cause_class: finding.root_cause_class, dispatched: false, route_group: null,
      proposal: null, verdict: null, graph_before: graphBefore, graph_after: graphBefore, stopped,
      evidence_ref: persist(traceId, gap, finding.root_cause_class, repair, null, null),
      next_gap_id: null,
    };
  }

  // --- route through the EXISTING n8n pipe (transport only) -------------
  const routed = await routeDnaOsEvent(repairEvent({ ...repair, attempt: guard.attempt }), { dispatch: false });
  const routeGroup = routed.decision?.route_group ?? null;

  // --- the agent -------------------------------------------------------
  const proposal = options.agent ? options.agent({ ...repair, attempt: guard.attempt }) : null;
  if (!proposal) {
    return {
      repair, gap, root_cause_class: finding.root_cause_class, dispatched: true, route_group: routeGroup,
      proposal: null, verdict: null, graph_before: graphBefore, graph_after: graphBefore, stopped: null,
      evidence_ref: persist(traceId, gap, finding.root_cause_class, repair, null, null),
      next_gap_id: before.queue.find((g) => g.gap_id !== gap.gap_id && g.actionable)?.gap_id ?? null,
    };
  }

  // --- a second loop check, now that the actual bytes are known ---------
  const codeHash = hashProposal(proposal);
  const guard2 = loopCheck(repair.error_signature, codeHash);
  if (guard2.stop) {
    recordAttempt({ repair_id: repair.repair_id, trace_id: traceId, attempt: guard2.attempt, code_hash: codeHash,
      error_signature: repair.error_signature, verdict: guard2.stop, recorded_at: nowIso(), verifier_version: VERIFIER_VERSION });
    return {
      repair, gap, root_cause_class: finding.root_cause_class, dispatched: true, route_group: routeGroup,
      proposal, verdict: null, graph_before: graphBefore, graph_after: graphBefore, stopped: guard2.stop,
      evidence_ref: persist(traceId, gap, finding.root_cause_class, repair, proposal, null),
      next_gap_id: null,
    };
  }

  // --- deterministic verification: the ONLY producer of VERIFIED --------
  const verdict = verifyProposal({ ...repair, attempt: guard2.attempt }, proposal);
  recordAttempt({ repair_id: repair.repair_id, trace_id: traceId, attempt: guard2.attempt, code_hash: verdict.code_hash,
    error_signature: repair.error_signature, verdict: verdict.verdict, recorded_at: nowIso(), verifier_version: VERIFIER_VERSION });

  // --- re-read the graph. Never paint a node green by hand. -------------
  const after = scanGaps();
  const afterGap = after.queue.find((g) => g.gap_id === gap.gap_id);
  const graphAfter = afterGap ? afterGap.state : "CONNECTED_VERIFIED";

  return {
    repair, gap, root_cause_class: finding.root_cause_class, dispatched: true, route_group: routeGroup,
    proposal, verdict, graph_before: graphBefore, graph_after: graphAfter,
    stopped: verdict.verdict === "REJECT_CHANGE" ? null : null,
    evidence_ref: persist(traceId, gap, finding.root_cause_class, repair, proposal, verdict),
    next_gap_id: after.queue.find((g) => g.gap_id !== gap.gap_id && g.actionable)?.gap_id ?? null,
  };
}

function persist(
  traceId: string, gap: GapRecord, rootCause: string,
  repair: RepairWorkItem | null, proposal: AgentProposal | null, verdict: unknown,
): string {
  const evidenceId = `repair-cycle-${gap.gap_id}-${randomUUID().slice(0, 8)}`;
  saveEvidence({
    evidence_id: evidenceId,
    task_id: repair?.work_id ?? traceId,
    kind: "execution_output",
    source: SOURCE,
    recorded_at: nowIso(),
    payload: {
      trace_id: traceId, gap, root_cause_class: rootCause, repair,
      // The proposal is stored WITHOUT file contents: the evidence store is
      // an audit log, not a code mirror, and full file bodies would bloat it
      // beyond usefulness while duplicating what git already holds.
      proposal: proposal ? { ...proposal, FILES_CHANGED: proposal.FILES_CHANGED.map((f) => ({ path: f.path, operation: f.operation, bytes: f.content.length })) } : null,
      verdict,
    },
  } as never);
  return evidenceId;
}
