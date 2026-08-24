/**
 * หน้าที่: External Agent identity -> DNA OS identity mapping. This file
 * makes no authorization decision itself — it only shapes whatever
 * identity the MCP transport received into exactly the `ownerIdentity`
 * object `transport/owner-command-http/server.ts` already accepts and
 * resolves through the real identity/permission boundary
 * (`permissions/access-control/`, `permissions/execution-policy/`) —
 * same pattern that server already uses for dna-os-deadboard's forwarded,
 * already-verified Supabase JWT identity.
 *
 * An MCP caller cannot choose its own account/workspace/permission scope:
 * DNA OS's existing boundary still resolves every identity into the one
 * fixed, already-provisioned Account/Workspace/execution-grant scope
 * (single-owner dev phase, unchanged) — this file only carries an id/email
 * label through, exactly like server.ts's own `resolveOwnerIdentity`
 * already does. No new authorization model is introduced here.
 *
 * Input: whatever identity the MCP transport/session carries (may be
 * absent for a local stdio caller).
 * Output: `DnaOsAgentIdentity | undefined`, ready to forward as
 * `ownerIdentity` on any DnaOsHttpClient call.
 * Dependency ที่อนุญาต: ./types.ts.
 * สิ่งที่ห้ามแตะ: never invent a new permission/role field here — identity
 * only, authorization stays entirely inside DNA OS's existing boundary.
 */

import type { DnaOsAgentIdentity } from "./types";

export function resolveAgentIdentity(input: { id?: unknown; email?: unknown } | undefined): DnaOsAgentIdentity | undefined {
  if (!input || typeof input.id !== "string" || input.id.length === 0) return undefined;
  const email = typeof input.email === "string" && input.email.length > 0 ? input.email : input.id;
  return { id: input.id, email };
}
