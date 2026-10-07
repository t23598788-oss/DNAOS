/**
 * หน้าที่: the Context Boundary layer — groups consecutive TRANSCRIBED
 * segments from `../stt-per-segment/stt-segment.mjs`'s
 * `*.transcribed.jsonl` (READ-ONLY input, never overwritten) into
 * `context_id` runs, using ONLY `session (wav path) + segment_id +
 * timestamp (start_ms/end_ms) + gap` — deliberately never language,
 * dialect, or transcript CONTENT (Owner instruction, 2026-08-21: this
 * layer does not need to know Thai vs Isaan, and must not start
 * interpreting meaning — that is a later layer's job, not this one's).
 *
 * Rule (simple, deterministic, time-only): two consecutive TRANSCRIBED
 * segments belong to the same `context_id` if the real gap between the
 * previous one's `end_ms` and this one's `start_ms` is <=
 * `MAX_CONTINUATION_GAP_MS`; otherwise a new `context_id` starts. A
 * segment with `status !== "TRANSCRIBED"` (e.g. `SKIPPED_NOT_SPEECH`)
 * gets `context_id: null` — it was never part of a conversation run, but
 * it is still preserved as a row so nothing silently disappears from the
 * evidence trail, and its real elapsed time still counts toward the next
 * TRANSCRIBED segment's gap calculation (the gap is real elapsed time,
 * regardless of what filled it).
 *
 * `language`/`dialect` are stamped `"UNKNOWN"` on every output row (Owner
 * instruction, 2026-08-21 — Language Layer is `⏸ NOT_IMPLEMENTED`, see
 * `../language-listening/README.md`) — this layer does not compute them,
 * only carries the literal placeholder forward so downstream consumers
 * always see the field. `raw_transcript` is passed through byte-for-byte
 * unchanged from the STT layer — never edited, translated, or summarized.
 *
 * Input: `groupContext(transcribedJsonlPath, outDir)`.
 * Output: `{ evidencePath, records }` — one record per input row, each
 * the original STT record plus `{ language: "UNKNOWN", dialect:
 * "UNKNOWN", context_id: string|null, gap_from_prev_transcribed_ms:
 * number|null }`.
 * Dependency ที่อนุญาต: node:fs, node:path. ห้าม import
 * ../stt-per-segment/*, ../audio-classifier/*, ../language-listening/*.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";

const MAX_CONTINUATION_GAP_MS = 5000; // first-pass default, not validated against real ground-truth — see ./README.md.

/**
 * `transcribedJsonlPath` — a real `*.transcribed.jsonl` from
 * `../stt-per-segment/stt-segment.mjs` (read-only).
 */
export function groupContext(transcribedJsonlPath, outDir) {
  mkdirSync(outDir, { recursive: true });
  const sessionLabel = basename(transcribedJsonlPath, ".transcribed.jsonl");

  const records = readFileSync(transcribedJsonlPath, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
    .sort((a, b) => a.start_ms - b.start_ms);

  let contextId = null;
  let contextSeq = -1;
  let prevTranscribedEndMs = null;

  const grouped = records.map((r) => {
    const base = { ...r, language: "UNKNOWN", dialect: "UNKNOWN" };

    if (r.status !== "TRANSCRIBED") {
      return { ...base, context_id: null, gap_from_prev_transcribed_ms: null };
    }

    const gap = prevTranscribedEndMs === null ? null : r.start_ms - prevTranscribedEndMs;
    if (contextId === null || gap === null || gap > MAX_CONTINUATION_GAP_MS) {
      contextSeq += 1;
      contextId = `${sessionLabel}-ctx${contextSeq}`;
    }
    prevTranscribedEndMs = r.end_ms;

    return { ...base, context_id: contextId, gap_from_prev_transcribed_ms: gap };
  });

  const evidencePath = join(outDir, `${sessionLabel}.context.jsonl`);
  writeFileSync(evidencePath, `${grouped.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf-8");
  return { evidencePath, records: grouped };
}
