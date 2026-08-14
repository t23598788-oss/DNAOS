/**
 * Operational <-> Infrastructure bridge contract (Owner directive
 * 2026-08-14, point 4): the two systems connect ONLY through
 * Contract/API/Event. No direct database dependency in either direction —
 * `dna-os-deadboard` keeps its own Supabase project and queries it
 * directly (it owns that data); this repo must never reach into it
 * directly, and `dna-os-deadboard` must never reach into whatever
 * database this repo eventually owns directly either.
 *
 * This file is the TYPE shape of that contract. NOT_YET_BUILT: there is no
 * real HTTP endpoint, message queue, or webhook wiring either direction
 * yet. TASK-172's connector/sync tables in dna-os-deadboard are frozen in
 * a legacy/pending-migration state specifically because they were built
 * before this contract existed and reached Supabase directly from an
 * /api/admin/* route gated only by ADMIN_TIER — exactly the pattern this
 * contract replaces.
 */

import type { CommandEnvelope, EventEnvelope } from "./envelope";

/**
 * Calls Operational is allowed to make INTO Infrastructure. Kept
 * deliberately narrow and named by real intent, not generic CRUD —
 * matches this whole system's principle that the boundary should
 * authenticate/authorize/classify/route, never expose free-form data
 * access.
 */
export interface OperationalToInfrastructureContract {
  /** Register or update an external Account's connection to a piece of Software (e.g. a GitHub connector). */
  submitCommand(envelope: CommandEnvelope): Promise<{ accepted: boolean; command_id: string }>;

  /** Ask for the current status of one Account's scope — never "list everything." */
  queryAccountStatus(account_id: string, requested_by: CommandEnvelope["issued_by"]): Promise<Record<string, unknown>>;
}

/**
 * Events Infrastructure emits OUTWARD, that Operational (or any other
 * authorized subscriber) may listen for. Operational never polls
 * Infrastructure's database — it receives Events.
 */
export interface InfrastructureEventStream {
  subscribe(handler: (event: EventEnvelope) => void | Promise<void>): () => void; // returns an unsubscribe function
}

/**
 * Real transport for both of the above — NOT_YET_BUILT. Candidates worth
 * evaluating when this becomes real (not decided here): a signed HTTP
 * webhook each direction (mirrors this repo's own existing
 * ai-callback/bank-email-sync pattern for cloud<->local bridging), or a
 * durable queue table each side polls (mirrors dna-os-deadboard's own
 * ai_tasks pattern). Whichever is chosen, it carries CommandEnvelope /
 * EventEnvelope payloads unchanged — the transport is swappable, the
 * contract shape is not.
 */
