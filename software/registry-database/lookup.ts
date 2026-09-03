/**
 * หน้าที่: `findCapability()` — the only read path into `software_registry`
 * this capability exposes. Thin wrapper over `RegistryStore`'s read
 * methods; no query logic of its own beyond picking which store method a
 * given `CapabilityLookupQuery` maps to.
 *
 * Input: `CapabilityLookupQuery`, `RegistryStore`.
 * Output: `CapabilityLookupResult | null`.
 * Dependency ที่อนุญาต: ./types.ts, ./store-port.ts.
 * สิ่งที่ห้ามแตะ: never let this file mutate anything — read-only, always.
 * Never let a caller pass a raw SQL fragment or unvalidated string through
 * to a store adapter; the three query fields on `CapabilityLookupQuery`
 * are the entire surface.
 */

import type { CapabilityLookupQuery, CapabilityLookupResult } from "./types";
import type { RegistryStore } from "./store-port";

export function findCapability(query: CapabilityLookupQuery, store: RegistryStore): CapabilityLookupResult | null {
  if (query.capability_id !== undefined) return store.findCapabilityById(query.capability_id);
  if (query.semantic_fingerprint !== undefined) return store.findCapabilityBySemanticFingerprint(query.semantic_fingerprint);
  if (query.canonical_name !== undefined) return store.findCapabilityByCanonicalName(query.canonical_name);
  return null;
}

export function findResourceById(resource_id: string, store: RegistryStore) {
  return store.findResourceById(resource_id);
}

/**
 * ENUMERATED SEARCH (Owner, 2026-08-26). The second sanctioned read path,
 * added because `findCapability` is lookup-by-exact-key and therefore can
 * never answer "does anything like this already exist?" — only "is this
 * exact name present?". Without it, deterministic resolution had to scan
 * every repository on disk to rediscover things the Registry already knew.
 *
 * Ranking is an integer token-overlap count over fields the Registry
 * already stores (canonical_name, purpose, resource source_location). No
 * model, no embedding, no fuzzy distance — the same query always returns
 * the same order.
 *
 * Returns `null` when the store cannot enumerate. A caller MUST treat that
 * as ENUMERATION_UNAVAILABLE and must never read it as "registry empty".
 */
export interface CapabilitySearchHit {
  capability_id: string;
  canonical_name: string;
  purpose: string;
  capability_type: string;
  status: string;
  input_contract: readonly string[];
  output_contract: readonly string[];
  side_effects: readonly string[];
  resource_ids: readonly string[];
  source_locations: readonly string[];
  evidence_refs: readonly string[];
  /** Integer count of matched tokens. Deterministic. */
  score: number;
  matched_on: readonly string[];
}

export function searchCapabilities(tokens: readonly string[], store: RegistryStore, limit = 10): readonly CapabilitySearchHit[] | null {
  if (!store.listCapabilityRows || !store.listResourceRows || !store.listResourceCapabilityLinks) return null;
  const lower = tokens.map((t) => t.toLowerCase()).filter(Boolean);
  if (lower.length === 0) return [];

  const resources = store.listResourceRows();
  const links = store.listResourceCapabilityLinks();
  const evidence = store.listEvidenceRows ? store.listEvidenceRows() : [];
  const resourceById = new Map(resources.map((r) => [r.resource_id, r]));

  const hits: CapabilitySearchHit[] = [];
  for (const cap of store.listCapabilityRows()) {
    const resourceIds = links.filter((l) => l.capability_id === cap.capability_id).map((l) => l.resource_id);
    const sourceLocations = resourceIds.map((id) => resourceById.get(id)?.source_location ?? "").filter(Boolean);
    // WEIGHTED, because a token in the NAME is much stronger evidence than
    // the same token appearing in a description. Observed live: an adapter
    // whose purpose text merely mentioned "Gmail reader" tied with the
    // actual gmail reader, and an alphabetical tiebreak then picked the
    // adapter over the thing it adapts. Name 3, path 2, purpose 1.
    const nameHay = cap.canonical_name.toLowerCase();
    const pathHay = sourceLocations.join(" ").toLowerCase();
    const purposeHay = (cap.purpose ?? "").toLowerCase();
    let score = 0;
    const matched: string[] = [];
    for (const t of lower) {
      const w = nameHay.includes(t) ? 3 : pathHay.includes(t) ? 2 : purposeHay.includes(t) ? 1 : 0;
      if (w > 0) { score += w; matched.push(t); }
    }
    if (matched.length === 0) continue;
    hits.push({
      capability_id: cap.capability_id,
      canonical_name: cap.canonical_name,
      purpose: cap.purpose,
      capability_type: cap.capability_type,
      status: String(cap.status),
      input_contract: cap.input_contract,
      output_contract: cap.output_contract,
      side_effects: cap.side_effects,
      resource_ids: resourceIds,
      source_locations: sourceLocations,
      evidence_refs: evidence.filter((e) => resourceIds.includes((e as unknown as { resource_id?: string }).resource_id ?? "")).map((e) => String((e as unknown as { evidence_ref?: string }).evidence_ref ?? "")).filter(Boolean),
      score,
      matched_on: matched,
    });
  }
  // Deterministic order: score desc, then canonical_name asc as the tiebreak.
  return hits.sort((a, b) => b.score - a.score || a.canonical_name.localeCompare(b.canonical_name)).slice(0, limit);
}
