/**
 * หน้าที่: the Operational <-> Infrastructure bridge contract (Owner
 * directive 2026-08-14): the two systems connect ONLY through
 * Contract/API/Event. No direct database dependency in either direction.
 * **This contract itself must never carry business data** — payloads
 * crossing this bridge describe Commands/Events about Software (what to
 * do, what happened, execution status, commit, test result, deployment
 * result), never business content (customer names, invoices, business
 * documents, financial figures).
 *
 * Input: a CommandEnvelope from Operational (see ../command/envelope.ts).
 * Output: an accepted/rejected result, and an EventEnvelope stream (see
 * ../event/envelope.ts) Operational may subscribe to.
 * Dependency ที่อนุญาต: ../command/envelope.ts, ../event/envelope.ts.
 * สิ่งที่ห้ามแตะ: never add a field here that would let a payload carry
 * business data "just this once" — if a future need looks like that,
 * it's a sign the need belongs to a Business Domain's own system, not
 * this bridge.
 *
 * NOT_YET_BUILT: no real HTTP endpoint, message queue, or webhook wiring
 * either direction yet. TASK-172's connector/sync tables in
 * dna-os-deadboard are frozen legacy/pending-migration specifically
 * because they were built before this contract existed and reached
 * Supabase directly from an /api/admin/* route — exactly the pattern this
 * contract replaces.
 */

import type { CommandEnvelope } from "../command/command-envelope";
import type { EventEnvelope } from "../event/event-envelope";

export interface OperationalToInfrastructureContract {
  /** Register or update an external Account's connection to a piece of Software (e.g. a GitHub connector). */
  submitCommand(envelope: CommandEnvelope): Promise<{ accepted: boolean; command_id: string }>;

  /** Ask for the current status of one Account's scope — never "list everything." */
  queryAccountStatus(account_id: string, requested_by: CommandEnvelope["issued_by"]): Promise<Record<string, unknown>>;
}

export interface InfrastructureEventStream {
  subscribe(handler: (event: EventEnvelope) => void | Promise<void>): () => void; // returns an unsubscribe function
}

/**
 * Real transport for both of the above — NOT_YET_BUILT. Candidates worth
 * evaluating when this becomes real (not decided here): a signed HTTP
 * webhook each direction (mirrors dna-os-deadboard's own existing
 * ai-callback/bank-email-sync pattern), or a durable queue table each
 * side polls (mirrors dna-os-deadboard's own ai_tasks pattern). Whichever
 * is chosen, it carries CommandEnvelope/EventEnvelope payloads unchanged
 * — the transport is swappable, the contract shape is not.
 */
