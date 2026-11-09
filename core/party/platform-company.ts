/**
 * Party identity — the ONE place that knows which `companies` row is DNA OS.
 *
 * Why this file exists:
 * The schema has always carried `CompanyType.CORE` and no TypeScript ever read
 * it, so "who issued this document?" had no answer other than "the system".
 * `issuer_company_id` (migration 20261109181000) makes the platform a real
 * party; this module is the code-side name for that party.
 *
 * The UUID below is the reserved id seeded by migration
 * 20261109180000_seed_platform_company.sql. It is the only copy in code — if
 * you need it elsewhere, import it from here.
 *
 * Pure: no DB call, no side effects, no caching. Callers pass the enum value
 * they already have (companies.type, as a string) and get the party kind back.
 */

export const PLATFORM_COMPANY_ID = "00000000-0000-0000-0000-00000000d0a0";

/** Who a row belongs to. The four values mirror public."CompanyType". */
export type PartyKind = "BUYER" | "SUPPLIER" | "CARRIER" | "PLATFORM";

/**
 * companies.type -> PartyKind.
 *
 * CUSTOMER -> BUYER · SUPPLIER -> SUPPLIER · FLEET -> CARRIER · CORE -> PLATFORM
 *
 * Anything else (unknown, empty, null) returns null. This never guesses: a new
 * enum value added to the database must be mapped here deliberately, and a
 * caller that receives null must decide what to do rather than inherit an
 * accidental party.
 */
export function partyKindFromCompanyType(type: string | null | undefined): PartyKind | null {
  switch ((type ?? "").trim().toUpperCase()) {
    case "CUSTOMER":
      return "BUYER";
    case "SUPPLIER":
      return "SUPPLIER";
    case "FLEET":
      return "CARRIER";
    case "CORE":
      return "PLATFORM";
    default:
      return null;
  }
}
