/**
 * หน้าที่: the GENERIC (provider-agnostic) SourcePointer contract — Owner
 * correction 2026-08-22 (DIGITALOCEAN ARCHITECTURE REBUILD, Section 2 +
 * Section 12 "GLOBAL PROVIDER RULE"). Every field name here is exactly
 * the list Owner specified: provider_id, source_id, source_type,
 * official_location, access_method, authority, freshness_mode,
 * verification_method, feeds, relationships, last_checked_at,
 * current_state_reference — no more, no fewer. This supersedes
 * `providers/hostinger/sources/types.ts`'s own (differently-shaped,
 * still-real, not deleted) `SourcePointer` for any NEW provider — see
 * this folder's README for why Hostinger's existing files were left
 * as-is rather than force-migrated in the same round that also touched
 * the router.
 *
 * A SourcePointer is IDENTITY + CONTRACT ONLY. It is illegal by
 * construction to store a current price/product/capability-list VALUE
 * here — see `current_state_reference`'s own doc comment; the field
 * exists precisely so this type never needs a "current_value" field of
 * its own.
 *
 * Input: none (pure type definitions).
 * Output: `SourceType`, `AccessMethod`, `FreshnessStrategy`,
 * `VerificationMethod`, `SourceFeed`, `SourceRelationship`, `SourcePointer`.
 * Dependency ที่อนุญาต: none — leaf contract.
 * สิ่งที่ห้ามแตะ: never add a field that could hold a raw secret, a price,
 * a product name/spec value, a tool-list value, or any other dynamic
 * external fact — those live only in the transient Current State produced
 * by `./current-state.ts`, never persisted here.
 */

export type SourceType = "DOCUMENTATION" | "REPOSITORY" | "SUPPORT_ARTICLE" | "PRODUCT_PAGE" | "API_SPEC" | "STATUS_FEED" | "CHANGELOG";

/** How this source is actually reached — never call WEB "EVENT" without a real, confirmed push mechanism. */
export type AccessMethod = "WEB" | "API" | "MCP" | "REPOSITORY" | "CLI" | "SDK" | "STATUS_API" | "FEED";

/**
 * Section 4 (Owner correction): freshness is SOURCE-DEPENDENT, never a
 * hardcoded global interval. `EVENT` = a confirmed push/webhook exists
 * (use it first). `POLL` = no push exists but the source is machine-
 * readable enough to poll on a schedule. `REQUEST_TIME` = fetch fresh on
 * every real request that needs it (no caching at all — for facts too
 * volatile/decision-critical to trust any cache). `TTL` = cache for a
 * bounded, source-declared duration. `CONTRACT_DIFF` = compare a
 * structured contract (e.g. an OpenAPI spec) rather than raw text.
 */
export type FreshnessStrategy = "EVENT" | "POLL" | "REQUEST_TIME" | "TTL" | "CONTRACT_DIFF";

export type VerificationMethod = "DIRECT_FETCH_200" | "SHA256_FINGERPRINT" | "CONTRACT_SCHEMA_DIFF" | "MANUAL_REVIEW" | "UNVERIFIABLE_AUTOMATED";

/** What this source structurally feeds — identity only, never a value. E.g. "digitalocean.pricing.droplets.current_state" (a current-state slot this source resolves into), never the price itself. */
export interface SourceFeed {
  feeds_into: string;
  relationship_kind: "CURRENT_STATE_INPUT" | "CONTRACT_DIFF_INPUT" | "CHANGE_DETECTION_INPUT" | "LAB_FINDING_INPUT";
}

export interface SourceRelationship {
  to_type: "PROVIDER" | "SERVICE" | "CAPABILITY" | "MCP_SERVER" | "MCP_SERVICE";
  to_id: string;
  relationship_kind: string;
}

export interface SourcePointer {
  provider_id: string;
  source_id: string;
  source_type: SourceType;
  official_location: string;
  access_method: AccessMethod;
  /** Always "OFFICIAL" in this repo — Section 13: "ห้ามใช้ third-party source เป็น authority ถ้ามี Official Source." A non-official source is never registered as a SourcePointer at all. */
  authority: "OFFICIAL";
  freshness_mode: FreshnessStrategy;
  verification_method: VerificationMethod;
  feeds: readonly SourceFeed[];
  relationships: readonly SourceRelationship[];
  /** Null until the first live check runs — see ./current-state.ts. Never hand-filled. */
  last_checked_at: string | null;
  /** The identity of the transient Current State slot this source resolves into (a key, not a value) — e.g. "digitalocean.droplets.current_state". Consumers call ./current-state.ts's `resolveCurrentState(source)` to get the real, live, replaceable value; this field is never itself the value. */
  current_state_reference: string;
}
