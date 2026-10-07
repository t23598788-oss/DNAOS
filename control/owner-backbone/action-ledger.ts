/**
 * หน้าที่: separate WHO IS WAITING from WHAT PHYSICALLY HAPPENS.
 *
 * Nine work items waiting on "deadboard healthy" is nine WAITERS and ONE
 * physical action. Before this file existed the loop performed nine real
 * restarts of the same service for one condition — proven live on
 * 2026-08-26, and the reason this exists.
 *
 * It also carries the loop's safety state, because that state is about the
 * CONDITION, not about any one waiter:
 *   - how many times this condition has been acted on (bounded retry)
 *   - what the last verification saw (replay of an old event repeats nothing)
 *   - whether the condition has terminally blocked
 *
 * NO NEW STORE. Every row is an append into `../agent-gateway/`'s existing
 * durable evidence store — the same one resolutions, events and remediation
 * records already live in. That is what makes this state survive a process
 * crash and a machine restart without anything being reconstructed by an AI
 * or re-derived by a repo scan.
 *
 * Input: a condition identity (service + action + target state).
 * Output: `conditionIdFor`, `openCondition`, `conditionState`,
 * `recordAttempt`, `recordCanonicalAction`, `reusableAction`,
 * `closeCondition`, `blockCondition`, `MAX_CONDITION_ATTEMPTS`.
 * Dependency ที่อนุญาต: ../agent-gateway/contract.ts, node:crypto.
 * สิ่งที่ห้ามแตะ: never merge work identities — coalescing applies to the
 * ACTION, and every waiting work_id stays its own work. Never let a
 * reusable action be returned when the target state is not currently
 * observed to hold: a stale success is how a broken service gets reported
 * healthy.
 */

import { createHash } from "node:crypto";
import { saveEvidence, loadEvidenceForTask } from "../agent-gateway/contract";

const SOURCE_MARKER = "control/owner-backbone/action-ledger.ts";

/**
 * How many times ONE condition may be acted on before the loop stops and
 * hands it to an Owner. Declared, not implicit — a permanent supervisor
 * with an implicit bound is an infinite remediation machine.
 */
export const MAX_CONDITION_ATTEMPTS = 3;

/** How long a verified action stays reusable for other waiters of the SAME condition. */
export const ACTION_REUSE_WINDOW_MS = 10 * 60 * 1000;

export type LedgerRowKind = "CONDITION_OPENED" | "ATTEMPT" | "CANONICAL_ACTION" | "CONDITION_CLOSED" | "CONDITION_BLOCKED";

export interface LedgerRow {
  readonly kind: LedgerRowKind;
  readonly condition_id: string;
  readonly at: string;
  /** Set on CANONICAL_ACTION: the one physical execution every waiter of this condition shares. */
  readonly action_id: string | null;
  readonly service_id: string;
  readonly action: string;
  readonly target_state: string;
  /** What the machine was observed to be AFTER the action. Never what the action reported. */
  readonly verified_state: string | null;
  readonly evidence_ref: string | null;
  /** Digest of the trigger that caused this row. An identical replay is recognised by this. */
  readonly input_digest: string | null;
  readonly detail: string;
}

/**
 * A condition is (service, action, target state) — NOT a work_id and NOT an
 * event. Two waiters that need the same thing are the same condition, which
 * is exactly what makes one action serve both.
 */
export function conditionIdFor(serviceId: string, action: string, targetState: string): string {
  return `cond-${createHash("sha256").update(`${serviceId}|${action}|${targetState}`).digest("hex").slice(0, 16)}`;
}

export function digestOfTrigger(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 32);
}

function append(row: LedgerRow): LedgerRow {
  saveEvidence({
    evidence_id: `ledger-${row.condition_id}-${row.kind}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    task_id: row.condition_id,
    kind: "execution_output",
    source: SOURCE_MARKER,
    recorded_at: row.at,
    payload: row,
  });
  return row;
}

/** Every row for a condition, oldest first. Read straight off disk — no in-memory cache to lose. */
export function ledgerFor(conditionId: string): readonly LedgerRow[] {
  return loadEvidenceForTask(conditionId)
    .filter((r) => r.source === SOURCE_MARKER)
    .map((r) => r.payload as LedgerRow)
    .sort((a, b) => a.at.localeCompare(b.at));
}

export interface ConditionState {
  readonly condition_id: string;
  readonly known: boolean;
  readonly open: boolean;
  readonly attempts: number;
  readonly blocked: boolean;
  readonly blocker: string | null;
  readonly last_verified_state: string | null;
  readonly last_action_id: string | null;
  readonly last_action_at: string | null;
  readonly last_input_digest: string | null;
  readonly retry_budget_remaining: number;
}

/**
 * Reduce the append-only rows to the condition's current state. This is the
 * whole of the loop's memory: it is rebuilt from disk on every call, so a
 * killed supervisor comes back knowing exactly what it knew before.
 */
export function conditionState(conditionId: string): ConditionState {
  const rows = ledgerFor(conditionId);
  let open = false;
  let attempts = 0;
  let blocked = false;
  let blocker: string | null = null;
  let lastVerified: string | null = null;
  let lastActionId: string | null = null;
  let lastActionAt: string | null = null;
  let lastInputDigest: string | null = null;

  for (const row of rows) {
    if (row.kind === "CONDITION_OPENED") { open = true; blocked = false; blocker = null; }
    if (row.kind === "ATTEMPT") { attempts += 1; lastInputDigest = row.input_digest ?? lastInputDigest; }
    if (row.kind === "CANONICAL_ACTION") { lastActionId = row.action_id; lastActionAt = row.at; lastVerified = row.verified_state; }
    if (row.kind === "CONDITION_CLOSED") { open = false; blocked = false; blocker = null; attempts = 0; lastVerified = row.verified_state; }
    if (row.kind === "CONDITION_BLOCKED") { blocked = true; blocker = row.detail; open = false; }
  }

  return {
    condition_id: conditionId, known: rows.length > 0, open, attempts, blocked, blocker,
    last_verified_state: lastVerified, last_action_id: lastActionId, last_action_at: lastActionAt,
    last_input_digest: lastInputDigest,
    retry_budget_remaining: Math.max(0, MAX_CONDITION_ATTEMPTS - attempts),
  };
}

export function openCondition(input: { condition_id: string; service_id: string; action: string; target_state: string; evidence_ref: string; detail: string }): LedgerRow {
  return append({ kind: "CONDITION_OPENED", condition_id: input.condition_id, at: new Date().toISOString(), action_id: null, service_id: input.service_id, action: input.action, target_state: input.target_state, verified_state: null, evidence_ref: input.evidence_ref, input_digest: null, detail: input.detail });
}

export function recordAttempt(input: { condition_id: string; service_id: string; action: string; target_state: string; input_digest: string; detail: string }): LedgerRow {
  return append({ kind: "ATTEMPT", condition_id: input.condition_id, at: new Date().toISOString(), action_id: null, service_id: input.service_id, action: input.action, target_state: input.target_state, verified_state: null, evidence_ref: null, input_digest: input.input_digest, detail: input.detail });
}

export function recordCanonicalAction(input: { condition_id: string; action_id: string; service_id: string; action: string; target_state: string; verified_state: string; evidence_ref: string; detail: string }): LedgerRow {
  return append({ kind: "CANONICAL_ACTION", condition_id: input.condition_id, at: new Date().toISOString(), action_id: input.action_id, service_id: input.service_id, action: input.action, target_state: input.target_state, verified_state: input.verified_state, evidence_ref: input.evidence_ref, input_digest: null, detail: input.detail });
}

export function closeCondition(input: { condition_id: string; service_id: string; action: string; target_state: string; verified_state: string; evidence_ref: string; detail: string }): LedgerRow {
  return append({ kind: "CONDITION_CLOSED", condition_id: input.condition_id, at: new Date().toISOString(), action_id: null, service_id: input.service_id, action: input.action, target_state: input.target_state, verified_state: input.verified_state, evidence_ref: input.evidence_ref, input_digest: null, detail: input.detail });
}

export function blockCondition(input: { condition_id: string; service_id: string; action: string; target_state: string; detail: string; evidence_ref: string }): LedgerRow {
  return append({ kind: "CONDITION_BLOCKED", condition_id: input.condition_id, at: new Date().toISOString(), action_id: null, service_id: input.service_id, action: input.action, target_state: input.target_state, verified_state: null, evidence_ref: input.evidence_ref, input_digest: null, detail: input.detail });
}

export interface ReusableAction {
  readonly reusable: boolean;
  readonly action_id: string | null;
  readonly evidence_ref: string | null;
  readonly verified_state: string | null;
  readonly age_ms: number | null;
  readonly reason: string;
}

/**
 * §6 COALESCING. Answers one question: has this exact condition ALREADY been
 * acted on, with the target state verified, recently enough that the result
 * still stands?
 *
 * `currentlyObservedState` is required and is compared against the recorded
 * verification. A reusable action is never returned on the strength of the
 * ledger alone — the machine has to still agree, or the "reuse" would be a
 * stale success.
 */
export function reusableAction(conditionId: string, currentlyObservedState: string, nowMs: number = Date.now()): ReusableAction {
  const state = conditionState(conditionId);
  if (state.last_action_id === null || state.last_action_at === null) {
    return { reusable: false, action_id: null, evidence_ref: null, verified_state: null, age_ms: null, reason: "no canonical action has been recorded for this condition" };
  }
  const rows = ledgerFor(conditionId);
  const canonical = [...rows].reverse().find((r) => r.kind === "CANONICAL_ACTION");
  const ageMs = nowMs - Date.parse(state.last_action_at);

  if (canonical?.verified_state !== currentlyObservedState) {
    return { reusable: false, action_id: state.last_action_id, evidence_ref: canonical?.evidence_ref ?? null, verified_state: canonical?.verified_state ?? null, age_ms: ageMs, reason: `the machine now reads "${currentlyObservedState}" but the canonical action verified "${String(canonical?.verified_state)}" — the earlier result no longer stands` };
  }
  if (ageMs > ACTION_REUSE_WINDOW_MS) {
    return { reusable: false, action_id: state.last_action_id, evidence_ref: canonical.evidence_ref, verified_state: canonical.verified_state, age_ms: ageMs, reason: `the canonical action is ${Math.round(ageMs / 1000)}s old, past the ${ACTION_REUSE_WINDOW_MS / 1000}s reuse window` };
  }
  return { reusable: true, action_id: state.last_action_id, evidence_ref: canonical.evidence_ref, verified_state: canonical.verified_state, age_ms: ageMs, reason: `one canonical action already achieved "${currentlyObservedState}" ${Math.round(ageMs / 1000)}s ago; this waiter shares that evidence instead of repeating the action` };
}
