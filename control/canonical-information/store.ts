import { createHash } from "node:crypto";
import type { CanonicalStoreV1 } from "./types";

export function emptyStore(): CanonicalStoreV1 {
  return {
    entities: [], facts: [], relationships: [], boundaries: [], states: [], events: [], activities: [], evidence: [],
    metrics: { REGISTERED_FACT_CACHE_HITS: 0, SOURCE_SEARCH_FALLBACKS: 0, SOURCE_SEARCH_BYTES_AVOIDED: 0, CANONICAL_QUERY_BYTES: 0 },
  };
}

let STORE: CanonicalStoreV1 = emptyStore();

export function getStore(): CanonicalStoreV1 {
  return STORE;
}

export function resetCanonicalStore(): void {
  STORE = emptyStore();
}

export function replaceStore(next: CanonicalStoreV1): void {
  STORE = next;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function hashRef(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function bytesOf(value: unknown): number {
  return Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value), "utf8");
}
