/**
 * หน้าที่: the ONE generic Current-State pipeline every provider reuses —
 * Owner correction 2026-08-22, Section 3: SOURCE -> FETCH -> VERIFY ->
 * NORMALIZE -> CURRENT STATE -> (LAB / CONSUMER). Current State is
 * REPLACEABLE, in-process-memory only, never written to disk — Section 1
 * forbids persisting dynamic external content (price/product/GPU
 * model/instance size/MCP tool list/etc) permanently. When a fetch's
 * fingerprint differs from what is currently held, the old value is
 * INVALIDATED and REPLACED atomically before any consumer can read it —
 * no consumer ever sees a torn/half-updated state (see `replace()`).
 *
 * What IS persisted (via `./change-log.ts`, append-only, metadata only):
 * source_id, detected_at, old_fingerprint, new_fingerprint, change_type,
 * verification_result. The fetched body itself is never written to disk
 * anywhere in this file.
 *
 * Input: a `SourcePointer`, an injectable fetch function (production
 * default = a real HTTPS GET; tests inject a fixture/mock upstream — see
 * `./tests/current-state.test.ts`'s VALUE_A -> refresh -> VALUE_B proof).
 * Output: `resolveCurrentState` -> `CurrentStateResult`.
 * Dependency ที่อนุญาต: node:https, node:crypto, ./types.ts,
 * ./change-log.ts.
 * สิ่งที่ห้ามแตะ: never add a disk-write for the normalized/raw content
 * itself — only `./change-log.ts`'s metadata-only row may touch disk.
 * Never let a partially-fetched/failed check overwrite a good, existing
 * current-state entry — a `FETCH_FAILED` leaves the prior state (if any)
 * exactly as it was, marked stale via `is_stale`, never silently replaced
 * with nothing.
 */

import { request } from "node:https";
import { createHash } from "node:crypto";
import type { SourcePointer } from "./types";
import { appendChangeLogEntry } from "./change-log";

export interface CurrentStateResult {
  source_id: string;
  status: "OK" | "NO_ENDPOINT" | "FETCH_FAILED";
  change_type: "INITIAL_BASELINE" | "CONTENT_CHANGED" | "NO_CHANGE" | "FETCH_FAILED";
  fingerprint: string | null;
  /** Present only for OK — this in-memory value is what a Lab/consumer reads THIS call; it is never separately persisted to disk by this module. */
  normalized_value: string | null;
  is_stale: boolean;
  fetched_at: string;
}

export type FetchFn = (url: string) => Promise<{ status: number; text: string }>;

const defaultFetch: FetchFn = (url) =>
  new Promise((resolve, reject) => {
    const req = request(url, { method: "GET", headers: { "user-agent": "dna-os-current-state-resolver/1.0 (+read-only, transient)" } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("TIMEOUT")));
    req.end();
  });

function normalize(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}
function fingerprintOf(normalized: string): string {
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

/**
 * In-process-memory only, module-scoped — REPLACEABLE by construction: a
 * new `set()` call is the only way an entry's value ever changes, and it
 * always replaces the whole entry atomically (never a partial mutation).
 * Restarting the process clears this — by design, nothing here is meant
 * to survive a restart; a fresh process re-fetches fresh, per Section 1.
 */
const currentStateMemory = new Map<string, { normalized_value: string; fingerprint: string; fetched_at: string }>();

export function peekCurrentState(source_id: string): { normalized_value: string; fingerprint: string; fetched_at: string } | undefined {
  return currentStateMemory.get(source_id);
}

/** Test-only reset — production code never calls this (there is no "clear all state" operation exposed for normal use). */
export function __resetCurrentStateMemoryForTests(): void {
  currentStateMemory.clear();
}

export async function resolveCurrentState(source: SourcePointer, fetchFn: FetchFn = defaultFetch, dataDir?: string): Promise<CurrentStateResult> {
  const fetchedAt = new Date().toISOString();
  if (!source.official_location.startsWith("http")) {
    return { source_id: source.source_id, status: "NO_ENDPOINT", change_type: "FETCH_FAILED", fingerprint: null, normalized_value: null, is_stale: false, fetched_at: fetchedAt };
  }

  let httpStatus: number;
  let normalized: string;
  try {
    const { status, text } = await fetchFn(source.official_location);
    httpStatus = status;
    normalized = normalize(text);
  } catch {
    const existing = currentStateMemory.get(source.source_id);
    appendChangeLogEntry({ source_id: source.source_id, detected_at: fetchedAt, old_fingerprint: existing?.fingerprint ?? null, new_fingerprint: null, change_type: "FETCH_FAILED", verification_result: "UNVERIFIABLE_AUTOMATED" }, dataDir);
    return { source_id: source.source_id, status: "FETCH_FAILED", change_type: "FETCH_FAILED", fingerprint: existing?.fingerprint ?? null, normalized_value: null, is_stale: existing !== undefined, fetched_at: fetchedAt };
  }

  if (httpStatus < 200 || httpStatus >= 300) {
    const existing = currentStateMemory.get(source.source_id);
    appendChangeLogEntry({ source_id: source.source_id, detected_at: fetchedAt, old_fingerprint: existing?.fingerprint ?? null, new_fingerprint: null, change_type: "FETCH_FAILED", verification_result: "UNVERIFIABLE_AUTOMATED" }, dataDir);
    return { source_id: source.source_id, status: "FETCH_FAILED", change_type: "FETCH_FAILED", fingerprint: existing?.fingerprint ?? null, normalized_value: null, is_stale: existing !== undefined, fetched_at: fetchedAt };
  }

  const newFingerprint = fingerprintOf(normalized);
  const existing = currentStateMemory.get(source.source_id);
  const changeType: CurrentStateResult["change_type"] = existing === undefined ? "INITIAL_BASELINE" : existing.fingerprint === newFingerprint ? "NO_CHANGE" : "CONTENT_CHANGED";

  // REPLACE — atomic: the whole entry is swapped in one Map.set() call, never a partial field update. This IS the "OLD CURRENT STATE -> INVALIDATE -> FETCH NEW -> VERIFY -> REPLACE -> PROPAGATE" line from Section 3, enacted.
  currentStateMemory.set(source.source_id, { normalized_value: normalized, fingerprint: newFingerprint, fetched_at: fetchedAt });

  appendChangeLogEntry(
    { source_id: source.source_id, detected_at: fetchedAt, old_fingerprint: existing?.fingerprint ?? null, new_fingerprint: newFingerprint, change_type: changeType, verification_result: "DIRECT_FETCH_200" },
    dataDir,
  );

  return { source_id: source.source_id, status: "OK", change_type: changeType, fingerprint: newFingerprint, normalized_value: normalized, is_stale: false, fetched_at: fetchedAt };
}
