/**
 * หน้าที่: define Software — WHICH external program/product/system is
 * making a call (e.g. "kimi-code-cli"). Distinct from Account (the
 * specific owner instance) and Identity (the specific credential/
 * session): many different Accounts might connect via the same Software,
 * and one Account might use several Software types. A RESOURCE an Account
 * can be granted use of (see ../../permissions/software-scope/resource-grant.ts)
 * — never a property baked into Account.
 *
 * Input: none (pure type definition).
 * Output: `Software`.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: never add business-domain-specific fields here. The
 * registration record is its own file (software-registration.ts).
 *
 * NOT_YET_BUILT: no real Software has been registered.
 */

export interface Software {
  software_id: string;
  name: string; // e.g. "kimi-code-cli", "dna-os-operational-bridge"
  vendor?: string;
}
