/**
 * หน้าที่: the Evidence layer — the LAST stage of the base Listening
 * pipeline (2026-08-21, Owner instruction). Does NOT analyze, classify,
 * decide, or interpret anything new — it only consolidates what every
 * earlier layer already decided into one canonical, fully-traceable
 * record per line, reading `../context-boundary/context-boundary.mjs`'s
 * `*.context.jsonl` (READ-ONLY, never overwritten) and renaming/
 * reordering fields into the exact chain the Owner specified:
 *
 *   context_id -> segment_id -> classification -> speaker_id ->
 *   raw_transcript -> language -> dialect -> start_ms/end_ms -> source_wav
 *
 * plus `sample_offset_start`/`sample_offset_end` — a mechanical unit
 * conversion (ms -> PCM sample index at the real 16000 Hz every WAV this
 * pipeline has produced/consumed uses, per
 * `../voice-command/listen-observe.mjs`'s own header note), not a new
 * decision — and a `verify_command` string: a real, ready-to-run `sox`
 * command that extracts exactly that record's audio slice from the
 * original WAV for manual listening, so "trace this line of text back to
 * the exact original sound" is something a human can actually DO, not
 * just a theoretical property.
 *
 * Every field ANY earlier layer produced is preserved (nothing dropped,
 * nothing renamed away, nothing recomputed) — only reshaped into this
 * canonical order/name set. This closes the base pipeline:
 *   Raw -> Segment -> Classify -> Speaker -> STT -> Language -> Context -> Evidence
 *
 * Input: `buildEvidence(contextJsonlPath, outDir)`.
 * Output: `{ evidencePath, evidence }`.
 * Dependency ที่อนุญาต: node:fs, node:path. ห้าม import
 * ../context-boundary/*, ../stt-per-segment/*, ../audio-classifier/*,
 * ../language-listening/*.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";

const SAMPLE_RATE_HZ = 16000; // real, consistent across this whole pipeline's WAVs (mono, 16-bit PCM) — see ../voice-command/listen-observe.mjs.

const CANONICAL_KEYS = [
  "context_id", "segment_id", "classification", "speaker_id",
  "raw_transcript", "language", "dialect", "start_ms", "end_ms",
  "source_wav", "sample_offset_start", "sample_offset_end",
  "status", "verify_command",
];

function msToSampleOffset(ms) {
  return typeof ms === "number" ? Math.round((ms * SAMPLE_RATE_HZ) / 1000) : null;
}

function buildVerifyCommand(sourceWav, startMs, endMs) {
  if (typeof startMs !== "number" || typeof endMs !== "number" || !sourceWav) return null;
  const startS = (startMs / 1000).toFixed(3);
  const durS = ((endMs - startMs) / 1000).toFixed(3);
  return `sox "${sourceWav}" -d trim ${startS} ${durS}`; // -d = play through the default audio device; swap for an output path to save the slice instead of playing it.
}

/**
 * `contextJsonlPath` — a real `*.context.jsonl` from
 * `../context-boundary/context-boundary.mjs` (read-only).
 */
export function buildEvidence(contextJsonlPath, outDir) {
  mkdirSync(outDir, { recursive: true });
  const sessionLabel = basename(contextJsonlPath, ".context.jsonl");

  const rows = readFileSync(contextJsonlPath, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));

  const evidence = rows.map((r) => {
    const { session_wav, ...rest } = r;
    const canonical = {
      context_id: r.context_id,
      segment_id: r.segment_id,
      classification: r.classification,
      speaker_id: r.speaker_id,
      raw_transcript: r.raw_transcript,
      language: r.language,
      dialect: r.dialect,
      start_ms: r.start_ms,
      end_ms: r.end_ms,
      source_wav: session_wav,
      sample_offset_start: msToSampleOffset(r.start_ms),
      sample_offset_end: msToSampleOffset(r.end_ms),
      status: r.status,
      verify_command: buildVerifyCommand(session_wav, r.start_ms, r.end_ms),
    };
    // Every other field any earlier layer produced (avg_token_confidence,
    // gap_from_prev_transcribed_ms, error, ...) rides along unchanged —
    // this layer only ever adds/renames, never drops.
    const leftover = Object.fromEntries(Object.entries(rest).filter(([k]) => !CANONICAL_KEYS.includes(k)));
    return { ...canonical, ...leftover };
  });

  const evidencePath = join(outDir, `${sessionLabel}.evidence.jsonl`);
  writeFileSync(evidencePath, `${evidence.map((e) => JSON.stringify(e)).join("\n")}\n`, "utf-8");
  return { evidencePath, evidence };
}
