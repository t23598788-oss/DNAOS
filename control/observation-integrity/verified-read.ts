/**
 * หน้าที่: read a file the way a verification boundary must — through two
 * independent methods, with metadata before and after, so that a silent wrong
 * answer cannot pass as content (Owner, 2026-09-02).
 *
 * WHY TWO METHODS AND NOT A RETRY. Retrying the same method twice proves only
 * that the method is consistent with itself; the incident's failing method was
 * perfectly consistent — it returned zero every time until something else
 * touched the file. Independence has to be in the METHOD, which is why
 * `deriveIntegrity` counts distinct methods rather than distinct calls.
 *
 * THE ORDER IS PART OF THE MEASUREMENT. The high-level read runs FIRST, before
 * any positioned read, because a positioned read appears to make subsequent
 * high-level reads succeed. Running it second would erase the very anomaly this
 * boundary exists to catch, and the result would look clean while hiding the
 * conflict. Preserving that order is the difference between measuring and
 * accidentally repairing.
 *
 * STAT BRACKETS THE READS. Size and mtime are captured before and after; a
 * change between them means the target moved under the observation, which is
 * reported as TARGET_CHANGED_DURING_READ rather than resolved. A file being
 * appended to while read is a normal event in this repo — the 94 MB operations
 * store grows constantly — and it must not be mistaken for corruption.
 *
 * CONTENT IS WITHHELD ON CONFLICT. `content` is null unless the methods agreed.
 * A caller cannot accidentally act on the reading that happened to be returned.
 *
 * Input: a path.
 * Output: verifiedReadFile, verifiedReadJsonl.
 * Dependency ที่อนุญาต: ./contract, node:fs, node:crypto.
 * สิ่งที่ห้ามแตะ: ห้ามสลับลำดับให้ positioned read มาก่อน, ห้ามคืนเนื้อหาเมื่อ
 * ผลขัดแย้ง, ห้าม retry จนกว่าจะได้คำตอบที่ชอบ.
 */
import { createHash } from "node:crypto";
import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { deriveIntegrity, readOutcomeFrom, type Observation, type VerifiedRead } from "./contract";

const hash = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 16);

/**
 * Reads one file through metadata + two independent content methods, in a fixed
 * order, and accepts the content only when they agree.
 */
export function verifiedReadFile(path: string, now: () => Date = () => new Date()): VerifiedRead {
  const observations: Observation[] = [];
  const stamp = () => now().toISOString();

  // ---- metadata, before ----
  let sizeBefore: number | null = null, mtimeBefore = "";
  try {
    const st = statSync(path);
    sizeBefore = st.size; mtimeBefore = st.mtimeMs.toString();
    observations.push({ method: "METADATA_STAT", result_bytes: st.size, error: null, content_hash: null, observed_at: stamp() });
  } catch (e) {
    observations.push({ method: "METADATA_STAT", result_bytes: null, error: String(e), content_hash: null, observed_at: stamp() });
  }

  // ---- METHOD 1: high-level read. FIRST, always — see the header. ----
  let contentA: string | null = null;
  try {
    contentA = readFileSync(path, "utf8");
    observations.push({ method: "HIGH_LEVEL_READ", result_bytes: Buffer.byteLength(contentA, "utf8"), error: null, content_hash: hash(contentA), observed_at: stamp() });
  } catch (e) {
    observations.push({ method: "HIGH_LEVEL_READ", result_bytes: null, error: String(e), content_hash: null, observed_at: stamp() });
  }

  // ---- METHOD 2: positioned descriptor read ----
  let contentB: string | null = null;
  try {
    const size = sizeBefore ?? 0;
    const fd = openSync(path, "r");
    const buf = Buffer.alloc(size);
    const n = readSync(fd, buf, 0, size, 0);
    closeSync(fd);
    contentB = buf.subarray(0, n).toString("utf8");
    observations.push({ method: "POSITIONED_DESCRIPTOR_READ", result_bytes: n, error: null, content_hash: hash(contentB), observed_at: stamp() });
  } catch (e) {
    observations.push({ method: "POSITIONED_DESCRIPTOR_READ", result_bytes: null, error: String(e), content_hash: null, observed_at: stamp() });
  }

  // ---- metadata, after: did the target move under us? ----
  // A file that never had a before-stat cannot have "changed" — a second failing
  // stat on a missing file is the same absence, not movement. Only compare when
  // there was something to compare against.
  let changed = false;
  if (sizeBefore !== null) {
    try {
      const st = statSync(path);
      changed = st.size !== sizeBefore || st.mtimeMs.toString() !== mtimeBefore;
    } catch { changed = true; }
  }

  const integrity = deriveIntegrity(path, observations, [path], changed);
  // Content is offered only when the methods agreed; on conflict the caller
  // gets nothing to act on, which is the point.
  const agreed = integrity.consistency_state === "CONSISTENT" ? (contentA ?? contentB) : null;
  return { path, outcome: readOutcomeFrom(integrity, agreed), integrity, content: agreed };
}

export interface VerifiedJsonl<T> {
  path: string;
  outcome: VerifiedRead["outcome"];
  integrity: VerifiedRead["integrity"];
  /** Null on any outcome other than READ_SUCCEEDED — a conflicted store yields no rows. */
  rows: readonly T[] | null;
  row_count: number | null;
  /** Set when the content read fine but a line failed to parse — a different failure from a read conflict. */
  parse_error: string | null;
}

/** Same discipline for a JSONL store: no rows are returned unless the read itself was corroborated. */
export function verifiedReadJsonl<T>(path: string, now: () => Date = () => new Date()): VerifiedJsonl<T> {
  const read = verifiedReadFile(path, now);
  if (read.outcome !== "READ_SUCCEEDED" || read.content === null) {
    return { path, outcome: read.outcome, integrity: read.integrity, rows: null, row_count: null, parse_error: null };
  }
  const lines = read.content.split("\n").filter((l) => l.trim());
  try {
    return { path, outcome: read.outcome, integrity: read.integrity, rows: lines.map((l) => JSON.parse(l) as T), row_count: lines.length, parse_error: null };
  } catch (e) {
    return { path, outcome: read.outcome, integrity: read.integrity, rows: null, row_count: lines.length, parse_error: String(e) };
  }
}
