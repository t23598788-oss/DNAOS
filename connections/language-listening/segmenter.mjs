/**
 * หน้าที่: the Segmenter layer — real, offline Voice Activity Detection
 * over an already-recorded WAV file, splitting it into time-bounded
 * segments and classifying each as SILENCE or SPEECH_CANDIDATE. Real
 * VAD, not a guess: uses whisper-cli's `--vad --vad-model` (confirmed via
 * `--help` and a real test run this round — `whisper-stream`, used by
 * `../voice-command/`, has no such option; only `whisper-cli`, the
 * file-based/offline binary, does).
 *
 * Never accepts a hardcoded path into another capability's data folder —
 * the caller passes the WAV path in (see ./README.md's "communication
 * across capability folders" note / CAPABILITY_FOLDER_LAW.md ข้อ 9).
 *
 * Input: `segmentAudio(wavPath, outDir)` — `wavPath` a real 16-bit PCM WAV
 * (mono, any sample rate whisper-cli accepts).
 * Output: `{ wavPath, jsonPath, evidencePath, segments }` where each
 * segment is `{ segment_id, start_ms, end_ms, text, avg_token_confidence,
 * kind }`. `avg_token_confidence` is the real mean of whisper-cli's own
 * per-token `p` values for that segment (from `--output-json-full`) — not
 * fabricated; `null` if the segment has no tokens.
 * Dependency ที่อนุญาต: node:child_process, node:fs, node:path,
 * `/opt/homebrew/bin/whisper-cli` (subprocess only).
 */
import { spawn } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

const whisperCliBin = "/opt/homebrew/bin/whisper-cli";
const modelPath = "/Users/tam/whisper-models/ggml-base.bin";
const vadModelPath = "/Users/tam/whisper-models/ggml-silero-v5.1.2.bin";
const MIN_SILENCE_GAP_MS = 200; // shorter gaps are VAD's own inter-segment padding/jitter, not a real silence region worth reporting.

function classify(text) {
  const t = (text ?? "").trim();
  if (t === "[เสียงดนตรี]" || t.toLowerCase() === "[music]") return "SPEECH_CANDIDATE_TAGGED_NONSPEECH";
  return "SPEECH_CANDIDATE";
}

/**
 * Real, minimal WAV header parse (RIFF/fmt /data chunks) — no external
 * dependency. whisper-cli's own `--output-json-full` JSON does not
 * include a total-duration field, and its `transcription[]` array only
 * ever contains segments VAD found voiced content in (a silent stretch
 * produces NO entry at all, not an empty-text one) — so the only way to
 * know where the real silence gaps are is to read the file's own real
 * duration and diff it against the speech segments VAD did report.
 */
function getWavDurationMs(wavPath) {
  const buf = readFileSync(wavPath);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`NOT_A_WAV_FILE path=${wavPath}`);
  }
  let offset = 12;
  let sampleRate = null;
  let channels = null;
  let bitsPerSample = null;
  let dataBytes = null;
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString("ascii", offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    if (chunkId === "fmt ") {
      channels = buf.readUInt16LE(offset + 10);
      sampleRate = buf.readUInt32LE(offset + 12);
      bitsPerSample = buf.readUInt16LE(offset + 22);
    } else if (chunkId === "data") {
      dataBytes = chunkSize;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  if (!sampleRate || !channels || !bitsPerSample || dataBytes === null) {
    throw new Error(`WAV_HEADER_INCOMPLETE path=${wavPath}`);
  }
  const bytesPerSample = bitsPerSample / 8;
  const totalSamples = dataBytes / (channels * bytesPerSample);
  return Math.round((totalSamples / sampleRate) * 1000);
}

/** Fills the real gaps VAD left between reported segments (and before the first / after the last) with explicit SILENCE entries. */
function withSilenceGaps(speechSegments, totalDurationMs) {
  const filled = [];
  let cursor = 0;
  for (const seg of speechSegments) {
    if (seg.start_ms - cursor >= MIN_SILENCE_GAP_MS) {
      filled.push({ start_ms: cursor, end_ms: seg.start_ms, text: "", avg_token_confidence: null, kind: "SILENCE" });
    }
    filled.push(seg);
    cursor = Math.max(cursor, seg.end_ms);
  }
  if (totalDurationMs - cursor >= MIN_SILENCE_GAP_MS) {
    filled.push({ start_ms: cursor, end_ms: totalDurationMs, text: "", avg_token_confidence: null, kind: "SILENCE" });
  }
  return filled.map((s, i) => ({ segment_id: i, ...s }));
}

/**
 * Runs whisper-cli with real VAD over `wavPath`, writes its raw
 * `--output-json-full` JSON plus a derived `.segments.jsonl` evidence
 * file into `outDir`, and returns the parsed segments.
 */
export async function segmentAudio(wavPath, outDir) {
  if (!existsSync(wavPath)) throw new Error(`WAV_NOT_FOUND path=${wavPath}`);
  mkdirSync(outDir, { recursive: true });
  const outBase = join(outDir, basename(wavPath, ".wav"));

  await new Promise((resolve, reject) => {
    const args = [
      "-m", modelPath,
      "-l", "th",
      "--vad", "--vad-model", vadModelPath,
      "-f", wavPath,
      "-oj", "--output-json-full",
      "-of", outBase,
      "-np",
    ];
    // stdio[1] explicitly "ignore" — real bug found and fixed 2026-08-21:
    // whisper-cli's stdout was left piped but never drained; on a long
    // (~57min) real recording it produced enough stdout output during
    // audio decode/VAD to fill the OS pipe buffer, which blocks the
    // child's write() call and hangs the whole process (confirmed via a
    // real run: killed after 3m09s real time but only 61s of actual CPU
    // time — the gap is time spent blocked, not computing). Discarding
    // stdout at the OS level removes the possibility entirely, for any
    // file length.
    const child = spawn(whisperCliBin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => { stderr += d.toString("utf-8"); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`WHISPER_CLI_EXIT code=${code} stderr_tail=${stderr.slice(-800)}`));
    });
  });

  const jsonPath = `${outBase}.json`;
  const raw = JSON.parse(readFileSync(jsonPath, "utf-8"));
  const speechSegments = (raw.transcription ?? []).map((seg) => {
    const probs = (seg.tokens ?? [])
      .map((t) => t.p)
      .filter((p) => typeof p === "number");
    const avgConfidence = probs.length > 0 ? probs.reduce((a, b) => a + b, 0) / probs.length : null;
    return {
      start_ms: seg.offsets?.from ?? null,
      end_ms: seg.offsets?.to ?? null,
      text: (seg.text ?? "").trim(),
      avg_token_confidence: avgConfidence,
      kind: classify(seg.text),
    };
  });

  const totalDurationMs = getWavDurationMs(wavPath);
  const segments = withSilenceGaps(speechSegments, totalDurationMs);

  const evidencePath = `${outBase}.segments.jsonl`;
  writeFileSync(evidencePath, `${segments.map((s) => JSON.stringify(s)).join("\n")}\n`, "utf-8");

  return { wavPath, jsonPath, evidencePath, segments };
}
