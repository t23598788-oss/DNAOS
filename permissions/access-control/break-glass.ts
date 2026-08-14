/**
 * หน้าที่: the ONLY path for the Platform Owner (or an authorized
 * support/security role) to read a tenant's actual data scope — e.g. for
 * a support incident, legal matter, recovery, or security event. Not a
 * standing permission: every real use must carry a reason, expire, and be
 * audited.
 *
 * Input: none (pure type definition).
 * Output: `BreakGlassRequest`.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: never make `reason` or `expires_at` optional — a
 * break-glass grant with no expiry is just a standing right by another
 * name, which is exactly what this file exists to prevent.
 *
 * NOT_YET_BUILT: no approval workflow, no expiry enforcement, no audit
 * sink wired up yet — see ../../audit/command-audit/README.md.
 */

export interface BreakGlassRequest {
  request_id: string;
  requested_by_identity_id: string;
  target_account_id: string;
  reason: string; // required, never optional
  expires_at: string; // required
  approved_by?: string; // NOT_YET_BUILT: approval policy not designed yet
  audit_event_id?: string; // links to ../../audit/command-audit/ once that exists
}
