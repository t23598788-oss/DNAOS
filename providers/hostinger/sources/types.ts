/**
 * หน้าที่: the type contract for one registered Hostinger SOURCE POINTER —
 * metadata/pointer only, never a copy of the source content itself. This
 * is the exact field list the Owner's task specified (provider_id ..
 * verification_state) — no more, no fewer.
 *
 * Input: none (pure type definitions).
 * Output: `SourceAccessMode`, `SourceFreshnessMode`, `SourceVerificationState`, `SourcePointer`.
 * Dependency ที่อนุญาต: none — leaf contract.
 * สิ่งที่ห้ามแตะ: never add a field that could hold a raw secret, a copy
 * of fetched page content, or an HTML/PDF dump. `fingerprint` is a hash
 * string only, never the content it was computed from.
 */

/** How this source is actually reached — never call WEB/DOC "EVENT" without a real event/webhook mechanism. */
export type SourceAccessMode = "API" | "MCP" | "WEB" | "DOC" | "REPOSITORY";

/** Freshness this source can actually deliver, not aspirational. WEB/DOC sources with no push/webhook mechanism are POLLABLE or MANUAL_ONLY at best — never EVENT_DRIVEN. */
export type SourceFreshnessMode = "EVENT_DRIVEN" | "ON_DEMAND" | "POLLABLE" | "CHANGE_DETECTION" | "MANUAL_ONLY";

export type SourceVerificationState = "VERIFIED" | "PARTIAL" | "UNVERIFIED";

export interface SourcePointer {
  provider_id: "hostinger";
  source_type: "DOCUMENTATION" | "REPOSITORY" | "SUPPORT_ARTICLE" | "PRODUCT_PAGE";
  source_id: string;
  source_name: string;
  official_url: string;
  /** The concrete URL a live-fetch actually hits — may differ from official_url (e.g. a raw-content mirror of a doc page). Null when there is no independently fetchable endpoint (e.g. an interactive JS-rendered doc site). */
  endpoint_pointer: string | null;
  documentation_pointer: string;
  access_mode: SourceAccessMode;
  content_category: string;
  /** What this source tells DNA OS about Hostinger's real capability — a short, evidence-traceable label, never invented. */
  capability_scope: string;
  /** This source's relationship to the Hostinger provider identity in ../definition/provider.json. */
  relationship: string;
  freshness_mode: SourceFreshnessMode;
  /** Human-readable description of exactly how a check is performed — see ../live-check/. */
  check_strategy: string;
  last_checked_at: string | null;
  last_change_detected_at: string | null;
  /** SHA-256 hex of the normalized content at last_checked_at — a hash only, never the content. Null until the first live check runs. */
  fingerprint: string | null;
  verification_state: SourceVerificationState;
}
