/**
 * หน้าที่: the Command Contract — the shape every external caller (an
 * external program, an AI agent, or DNA OS's own operational system) must
 * use to ask the control system to DO something. Every Command resolves
 * to exactly one Account's scope; there is no field here for "target a
 * different account."
 *
 * Input: none (pure type definition) — this IS the input contract other
 * modules validate against.
 * Output: `CommandEnvelope`.
 * Dependency ที่อนุญาต: ../identity/envelope-identity.ts.
 * สิ่งที่ห้ามแตะ: never add a "target_account_id" override field — the
 * only account a Command may affect is issued_by.acting_as_account_id.
 * Never import from permissions/ here — contracts/ has zero dependency on
 * permissions/, always.
 *
 * NOT_YET_BUILT: no controller reads or validates this yet — see
 * ../../control/command-router/README.md.
 */

import type { EnvelopeIdentity } from "../identity/envelope-identity";

export interface CommandEnvelope<TPayload = unknown> {
  command_id: string; // this Command's own unique id
  issued_by: EnvelopeIdentity;
  intent: string; // e.g. "connector.sync", "connector.register" — classified by the router, not asserted by the caller
  payload: TPayload;
  issued_at: string;
}
