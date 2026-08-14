/**
 * หน้าที่: the default authorization check — an Identity may only act
 * within the Account scope it is currently exercising
 * (issued_by.acting_as_account_id), never a fixed "home account." Denied
 * by default, no exceptions baked in here — including for the Platform
 * Owner, who must go through break-glass.ts instead of an ambient
 * always-allow rule.
 *
 * Input: a CommandEnvelope-shaped object + a target account id.
 * Output: `isWithinOwnScope()`.
 * Dependency ที่อนุญาต: ../../contracts/command/command-envelope.ts (type
 * only — permissions/ MAY depend on contracts/, never the reverse).
 * สิ่งที่ห้ามแตะ: this function only checks the envelope's OWN internal
 * consistency (does it claim to act as the account it's targeting). It
 * does NOT verify a real Membership row backs that claim — that lookup
 * needs a real data source and belongs in
 * ../../control/command-router/ once one exists, not here.
 *
 * NOT_YET_BUILT: nothing calls this yet.
 */

import type { CommandEnvelope } from "../../contracts/command/command-envelope";

export function isWithinOwnScope(envelope: CommandEnvelope, targetAccountId: string): boolean {
  return envelope.issued_by.acting_as_account_id === targetAccountId;
}
