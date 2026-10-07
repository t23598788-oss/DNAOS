/**
 * หน้าที่: pure normalize + fingerprint — no fs, no network, no host
 * ambient. Given raw fetched text, produces a SHA-256 hex digest of its
 * normalized form. The caller (./live-fetch.ts) is the only place the raw
 * text this function receives is ever allowed to exist in memory; this
 * function itself never persists anything.
 *
 * Input: raw fetched text.
 * Output: `normalizeText`, `sha256Hex`.
 * Dependency ที่อนุญาต: node:crypto.
 * สิ่งที่ห้ามแตะ: never write the input text anywhere, never return it —
 * only the normalized hash.
 */

import { createHash } from "node:crypto";

/** Collapses whitespace so a page's fingerprint doesn't flap on irrelevant reflow/whitespace-only diffs. */
export function normalizeText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export function sha256Hex(normalized: string): string {
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}
