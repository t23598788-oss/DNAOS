#!/usr/bin/env node
/**
 * หน้าที่: thin CLI wrapper around ./segmenter.mjs's `segmentAudio` —
 * `node segment-cli.mjs <wav-path> [out-dir]`. Prints a real summary
 * (segment count, SILENCE vs SPEECH_CANDIDATE counts, evidence file path)
 * to stdout; the full per-segment JSONL is left on disk for inspection.
 * Dependency ที่อนุญาต: ./segmenter.mjs.
 */
import { segmentAudio } from "./segmenter.mjs";
import { dirname } from "node:path";

const wavPath = process.argv[2];
const outDir = process.argv[3] ?? dirname(wavPath ?? ".");

if (!wavPath) {
  console.error("Usage: node segment-cli.mjs <wav-path> [out-dir]");
  process.exitCode = 1;
} else {
  const { evidencePath, segments } = await segmentAudio(wavPath, outDir);
  const silence = segments.filter((s) => s.kind === "SILENCE");
  const speech = segments.filter((s) => s.kind === "SPEECH_CANDIDATE");
  const taggedNonSpeech = segments.filter((s) => s.kind === "SPEECH_CANDIDATE_TAGGED_NONSPEECH");
  const silenceMs = silence.reduce((sum, s) => sum + (s.end_ms - s.start_ms), 0);
  console.log(JSON.stringify({
    wav_path: wavPath,
    evidence_path: evidencePath,
    total_segments: segments.length,
    silence_segments: silence.length,
    silence_total_ms: silenceMs,
    speech_candidate: speech.length,
    speech_candidate_tagged_nonspeech: taggedNonSpeech.length,
  }, null, 2));
}
