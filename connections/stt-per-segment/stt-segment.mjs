/**
 * หน้าที่: the STT-per-segment layer — takes segments
 * `../audio-classifier/audio-classifier.mjs` already classified
 * (`*.classified.jsonl`, READ-ONLY input, never overwritten) and, for
 * every segment whose `classification` indicates real speech content
 * (`SPEECH` or `MIXED` — see "which segments get transcribed" below),
 * runs real, existing `whisper-cli` + `ggml-base.bin` over EXACTLY that
 * segment's time window (`--offset-t`/`--duration`, real flags confirmed
 * via `--help` and a real test run this round — no audio slicing/sox
 * needed, whisper-cli seeks the window itself).
 *
 * Language discipline (Owner instruction, 2026-08-21): the raw transcript
 * is recorded EXACTLY as whisper-cli produced it — no translation, no
 * Isaan-to-standard-Thai normalization, no LLM rewrite. Meaning/language
 * classification is the next layer's job, not this one's.
 *
 * speaker_id is always the literal string `"UNKNOWN"` — Speaker
 * Separation is `⏸ NOT_IMPLEMENTED` (Owner decision, 2026-08-21, see
 * `../language-listening/README.md`) — never a guessed label.
 *
 * This is a separate capability folder from `../audio-classifier/` and
 * `../language-listening/` on purpose — never imports either, only reads
 * the file paths it's given. Every output row carries `session_wav`,
 * `segment_id`, `start_ms`, `end_ms` for full traceability back to the
 * original WAV + sample range.
 *
 * Input: `transcribeSegments(classifiedJsonlPath, wavPath, outDir)`.
 * Output: `{ evidencePath, records }`, one record per classified segment
 * (not just the transcribed ones — every segment gets a row so the
 * pipeline stays fully auditable):
 *   transcribed: `{ session_wav, segment_id, start_ms, end_ms,
 *     classification, speaker_id: "UNKNOWN", status: "TRANSCRIBED",
 *     raw_transcript, avg_token_confidence }`
 *   skipped (MUSIC/NOISE/UNKNOWN classification): `{ ..., speaker_id:
 *     "UNKNOWN", status: "SKIPPED_NOT_SPEECH", raw_transcript: null,
 *     avg_token_confidence: null }`
 * Dependency ที่อนุญาต: node:child_process (spawn `whisper-cli` only),
 * node:fs, node:path. ห้าม import ../audio-classifier/* หรือ
 * ../language-listening/*.
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

const whisperCliBin = "/opt/homebrew/bin/whisper-cli";
const modelPath = "/Users/tam/whisper-models/ggml-base.bin";

const SPEECH_LIKE = new Set(["SPEECH", "MIXED"]);

function runWhisperCliOnWindow(wavPath, startMs, endMs, outBase) {
  return new Promise((resolve, reject) => {
    const args = [
      "-m", modelPath,
      "-l", "th",
      "-f", wavPath,
      "-ot", String(startMs),
      "-d", String(Math.max(1, endMs - startMs)),
      "-oj", "--output-json-full",
      "-of", outBase,
      "-np",
    ];
    // stdio[1] explicitly "ignore" — same real stdout-pipe-backpressure
    // hang found and fixed in ../language-listening/segmenter.mjs this
    // round (undrained stdout can block the child's write() and hang the
    // whole process on a large enough window); discarding it at the OS
    // level removes the possibility entirely here too.
    const child = spawn(whisperCliBin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => { stderr += d.toString("utf-8"); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`WHISPER_CLI_EXIT code=${code} stderr_tail=${stderr.slice(-800)}`));
    });
  });
}

/**
 * `classifiedJsonlPath` — a real `*.classified.jsonl` from
 * `../audio-classifier/audio-classifier.mjs` (read-only). `wavPath` — the
 * same WAV that Segmenter/Classifier already analyzed (passed explicitly,
 * never hardcoded/guessed).
 */
export async function transcribeSegments(classifiedJsonlPath, wavPath, outDir) {
  mkdirSync(outDir, { recursive: true });
  const classified = readFileSync(classifiedJsonlPath, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));

  const records = [];
  for (const seg of classified) {
    const base = {
      session_wav: wavPath,
      segment_id: seg.segment_id,
      start_ms: seg.start_ms,
      end_ms: seg.end_ms,
      classification: seg.classification,
      speaker_id: "UNKNOWN",
    };

    if (!SPEECH_LIKE.has(seg.classification)) {
      records.push({ ...base, status: "SKIPPED_NOT_SPEECH", raw_transcript: null, avg_token_confidence: null });
      continue;
    }

    const outBase = join(outDir, `${basename(wavPath, ".wav")}-seg${seg.segment_id}`);
    try {
      await runWhisperCliOnWindow(wavPath, seg.start_ms, seg.end_ms, outBase);
      const jsonPath = `${outBase}.json`;
      const raw = JSON.parse(readFileSync(jsonPath, "utf-8"));
      const pieces = raw.transcription ?? [];
      const rawTranscript = pieces.map((p) => (p.text ?? "").trim()).filter(Boolean).join(" ");
      const probs = pieces.flatMap((p) => (p.tokens ?? []).map((t) => t.p)).filter((p) => typeof p === "number");
      const avgConfidence = probs.length > 0 ? probs.reduce((a, b) => a + b, 0) / probs.length : null;
      records.push({ ...base, status: "TRANSCRIBED", raw_transcript: rawTranscript, avg_token_confidence: avgConfidence });
      if (existsSync(jsonPath)) unlinkSync(jsonPath); // per-window whisper-cli JSON is intermediate — the evidence JSONL below is the durable record.
    } catch (err) {
      records.push({ ...base, status: "TRANSCRIBE_FAILED", raw_transcript: null, avg_token_confidence: null, error: String(err) });
    }
  }

  const evidencePath = join(outDir, `${basename(wavPath, ".wav")}.transcribed.jsonl`);
  writeFileSync(evidencePath, `${records.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf-8");
  return { evidencePath, records };
}
