/**
 * หน้าที่: the ONLY file in this capability folder allowed to touch the
 * network — same host-ambient-isolation pattern as
 * `software/registry-database/host-runtime.ts`. Fetches a source pointer's
 * `endpoint_pointer` (read-only GET, never a write/destructive call —
 * these are all public documentation/repository URLs, no credential ever
 * used or needed), normalizes + fingerprints it, compares against the
 * last known fingerprint, appends one Change Detection log row, and then
 * lets the raw response body fall out of scope — this function never
 * returns the body and never writes it to disk. TRANSIENT BY
 * CONSTRUCTION: the raw text lives only inside this function's stack for
 * the duration of one fetch.
 *
 * Input: a `SourcePointer`.
 * Output: `checkSourceLiveNow` -> `LiveCheckResult` (fingerprint + change
 * status only — no content).
 * Dependency ที่อนุญาต: node:https, ./fingerprint.ts, ./change-log.ts,
 * ../sources/types.ts.
 * สิ่งที่ห้ามแตะ: never add a return field that carries response body
 * text, never write the body to a file, never log the body.
 */

import { request } from "node:https";
import type { SourcePointer } from "../sources/types";
import { normalizeText, sha256Hex } from "./fingerprint";
import { appendChangeLogEntry, readLatestFingerprint, type ChangeLogEntry } from "./change-log";

export interface LiveCheckResult {
  source_id: string;
  status: "OK" | "NO_ENDPOINT" | "FETCH_FAILED";
  fingerprint: string | null;
  what_changed: ChangeLogEntry["what_changed"];
  http_status: number | null;
  bytes_fetched: number | null;
}

function fetchText(url: string, timeoutMs = 15000): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: "GET", headers: { "user-agent": "dna-os-hostinger-source-watch/1.0 (+read-only documentation change detection)" } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error("TIMEOUT")));
    req.end();
  });
}

/** Runs one real, transient live check for one source pointer. Never called for a source with no endpoint_pointer (DOC-only interactive sites). */
export async function checkSourceLiveNow(source: SourcePointer, dataDir?: string): Promise<LiveCheckResult> {
  if (!source.endpoint_pointer) {
    return { source_id: source.source_id, status: "NO_ENDPOINT", fingerprint: null, what_changed: "FETCH_FAILED", http_status: null, bytes_fetched: null };
  }
  let httpStatus: number;
  let bodyLength: number;
  let newFingerprint: string;
  try {
    const { status, text } = await fetchText(source.endpoint_pointer);
    httpStatus = status;
    bodyLength = Buffer.byteLength(text, "utf8");
    const normalized = normalizeText(text);
    newFingerprint = sha256Hex(normalized);
    // `text`/`normalized` fall out of scope at the end of this try block —
    // never referenced again, never returned, never written anywhere.
  } catch {
    const entry: ChangeLogEntry = { source_id: source.source_id, what_changed: "FETCH_FAILED", when_detected: new Date().toISOString(), source_pointer: source.endpoint_pointer, old_fingerprint: readLatestFingerprint(source.source_id, dataDir), new_fingerprint: null, verification_state: "UNVERIFIED" };
    appendChangeLogEntry(entry, dataDir);
    return { source_id: source.source_id, status: "FETCH_FAILED", fingerprint: null, what_changed: "FETCH_FAILED", http_status: null, bytes_fetched: null };
  }

  const oldFingerprint = readLatestFingerprint(source.source_id, dataDir);
  const whatChanged: ChangeLogEntry["what_changed"] = oldFingerprint === null ? "INITIAL_BASELINE" : oldFingerprint === newFingerprint ? "NO_CHANGE" : "CONTENT_CHANGED";
  const entry: ChangeLogEntry = { source_id: source.source_id, what_changed: whatChanged, when_detected: new Date().toISOString(), source_pointer: source.endpoint_pointer, old_fingerprint: oldFingerprint, new_fingerprint: newFingerprint, verification_state: httpStatus >= 200 && httpStatus < 300 ? source.verification_state : "UNVERIFIED" };
  appendChangeLogEntry(entry, dataDir);
  return { source_id: source.source_id, status: "OK", fingerprint: newFingerprint, what_changed: whatChanged, http_status: httpStatus, bytes_fetched: bodyLength };
}
