/**
 * หน้าที่: the Event Contract — something that already happened, emitted
 * back toward a caller or toward the Operational system's own event
 * stream. Same ownership rule as Command: an Event belongs to exactly one
 * Account.
 *
 * Input: none (pure type definition).
 * Output: `EventEnvelope`.
 * Dependency ที่อนุญาต: ../identity/envelope-identity.ts.
 * สิ่งที่ห้ามแตะ: never let `data` carry business content — an Event
 * describes what happened to a Command/software (e.g. "sync completed"),
 * never the business data that command touched. Never import from
 * permissions/ here.
 *
 * NOT_YET_BUILT: nothing emits or subscribes to this yet — see
 * ../operational-bridge/bridge.ts.
 */

import type { EnvelopeIdentity } from "../identity/envelope-identity";

export interface EventEnvelope<TData = unknown> {
  event_id: string;
  concerns: EnvelopeIdentity; // whose scope this event is about
  event_type: string; // e.g. "connector.sync.completed", "connector.status.changed"
  data: TData;
  occurred_at: string;
  caused_by_command_id?: string; // links back to the CommandEnvelope that caused this, when there is one
}
