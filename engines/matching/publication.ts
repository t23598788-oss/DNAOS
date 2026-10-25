/**
 * PUBLICATION & OWNERSHIP EVIDENCE POLICY — single decision point (owner mission
 * 2026-10-19, STEP 1). Read-only: this module never queries a database and never
 * writes anything. It only classifies a supply row that a reader already fetched.
 *
 * WHY THIS EXISTS
 * The audit (2026-10-19) proved two different meanings were being conflated:
 *   · `pit_profiles.is_open`  = the supplier's own "accepting orders" flag
 *   · "published / allowed to be offered" = is_open + a real sellable price
 * and `is_open` was ALSO being read as if it proved who owns the record. It does
 * not: 74 of 77 live supply rows have no owner account at all.
 *
 * RULES (no assumption beyond the columns that exist today):
 *   DELETED      deleted_at IS NOT NULL           → never public, never matched
 *   NO_PRICE     no pit_materials row with price>0 → not an offer, never matched
 *   UNPUBLISHED  is_open is not true              → not public, not matched
 *   PUBLISHED    otherwise                        → public + matchable
 *
 * OWNER EVIDENCE (evidence only — NOT verification):
 *   USER_ACCOUNT  pit_profiles.user_id is set (a real authenticated account id)
 *   LINE_CHANNEL  only pit_profiles.line_user_id is set (a chat channel, not an owner)
 *   NONE          neither
 * `owner_verified` stays FALSE until a verification record actually exists.
 * There is no owner-verification column in the live schema (checked: pit_profiles
 * has source_verified_at for the PLACE source, not for the owner), so this
 * function must never return true. is_open is deliberately NOT an input to it —
 * the owner flag can never stand in for proof of ownership.
 */

export type PublicationState = "DELETED" | "NO_PRICE" | "UNPUBLISHED" | "PUBLISHED";
export type OwnerEvidence = "USER_ACCOUNT" | "LINE_CHANNEL" | "NONE";

export interface SupplyRowForPublication {
  deleted_at?: string | null;
  is_open?: boolean | null;
  user_id?: string | null;
  line_user_id?: string | null;
  /** prices of the sellable material rows linked to this supply row (any unit). */
  prices?: readonly (number | string | null | undefined)[] | null;
  /** only a future, real verification timestamp could make this true. */
  owner_verified_at?: string | null;
}

/** A price is a real offer only when it parses to a finite number > 0. */
export function hasSellablePrice(prices: SupplyRowForPublication["prices"]): boolean {
  if (!prices || prices.length === 0) return false;
  return prices.some((p) => {
    const n = Number(p);
    return Number.isFinite(n) && n > 0;
  });
}

export function publicationState(row: SupplyRowForPublication): PublicationState {
  if (row.deleted_at) return "DELETED";
  if (!hasSellablePrice(row.prices)) return "NO_PRICE";
  if (row.is_open !== true) return "UNPUBLISHED";
  return "PUBLISHED";
}

/** External search / AI answer / quote eligibility. */
export function isPubliclyMatchable(row: SupplyRowForPublication): boolean {
  return publicationState(row) === "PUBLISHED";
}

/**
 * Evidence of a possible owner — never proof. Ordered by strength:
 * an authenticated account id is stronger than a LINE chat channel.
 */
export function ownerEvidence(row: SupplyRowForPublication): OwnerEvidence {
  if (row.user_id) return "USER_ACCOUNT";
  if (row.line_user_id) return "LINE_CHANNEL";
  return "NONE";
}

/**
 * TRUE only when a real owner-verification record exists. The live schema has
 * no such column for pit_profiles today, so this is always false; it is written
 * as a real check (not a hardcoded literal) so a future column can enable it
 * without inventing semantics here.
 */
export function isOwnerVerified(row: SupplyRowForPublication): boolean {
  return Boolean(row.owner_verified_at);
}

export interface PublicationDecision {
  state: PublicationState;
  matchable: boolean;
  owner_evidence: OwnerEvidence;
  owner_verified: boolean;
}

/** One call for readers that must expose the decision to callers. */
export function decidePublication(row: SupplyRowForPublication): PublicationDecision {
  return {
    state: publicationState(row),
    matchable: isPubliclyMatchable(row),
    owner_evidence: ownerEvidence(row),
    owner_verified: isOwnerVerified(row),
  };
}
