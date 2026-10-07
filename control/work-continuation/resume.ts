/**
 * หน้าที่: the join. Real events -> existing index -> existing evaluator ->
 * a resume decision per waiting work item, carrying the persisted context
 * forward so nothing rediscovers anything.
 *
 * IT CREATES NO SCHEDULER. It produces `ResumeDecision[]`; dispatching them is
 * `control/scheduler/`'s job and stays there. Keeping the decision separate from
 * the dispatch is also what lets the whole path be proven without launching a
 * worker.
 *
 * Input: waiting rows (from ./store), events (from ./adapter), and the current
 * resolution digest per work item.
 * Output: `decideResumes`, `satisfiedKeysFrom`.
 * Dependency ที่อนุญาต: ./evaluate.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never mint a work_id here, and never mutate a waiting row in
 * place — a decision is recorded by APPENDING a new row, so the journal stays
 * the only history.
 */

import { buildIndex, affectedWorkIds, evaluate } from "./evaluate";
import type { DependencyEvent, DependencyKey, Evaluation, WaitingWork } from "./types";

export interface ResumeDecision {
  work_id: string;
  evaluation: Evaluation;
  /** Carried forward from the persisted row — never re-derived by an agent. */
  next_action: string;
  resolved_work_context_ref: string | null;
  required_worker_class: string | null;
  /** The event that caused this decision, for the audit trail. */
  triggered_by: DependencyEvent;
}

/**
 * The keys already known satisfied, derived from the events themselves. An event
 * that arrived IS its key being available — there is no separate "satisfied
 * store" to drift from the event stream.
 */
export function satisfiedKeysFrom(events: readonly DependencyEvent[]): Set<DependencyKey> {
  return new Set(events.map((e) => e.key));
}

/**
 * For each event, wake ONLY the work the index says is waiting on it. The other
 * rows are never read, never evaluated, and never touched — that is the "no full
 * work scan" guarantee, and it is a property of the lookup, not a promise.
 */
export function decideResumes(
  rows: readonly WaitingWork[],
  events: readonly DependencyEvent[],
  resolutionDigestOf: (workId: string) => string | null,
  resultDigestOf: (workId: string) => string | null,
  now: string,
): ResumeDecision[] {
  const index = buildIndex(rows, now);
  const byId = new Map(rows.map((r) => [r.work_id, r]));
  const satisfied = satisfiedKeysFrom(events);
  const decisions: ResumeDecision[] = [];
  const seen = new Set<string>();

  for (const event of events) {
    for (const workId of affectedWorkIds(index, event)) {
      // One decision per work item per batch. A second event in the same batch
      // touching the same work cannot produce a second dispatch.
      if (seen.has(workId)) continue;
      const row = byId.get(workId);
      if (!row) continue;
      const evaluation = evaluate(row, event, satisfied, resolutionDigestOf(workId), resultDigestOf(workId));
      seen.add(workId);
      decisions.push({
        work_id: row.work_id,
        evaluation,
        next_action: row.next_action,
        resolved_work_context_ref: row.resolved_work_context_ref,
        required_worker_class: row.required_worker_class,
        triggered_by: event,
      });
    }
  }
  return decisions;
}
