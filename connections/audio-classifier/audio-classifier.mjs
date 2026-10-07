/**
 * หน้าที่: the Audio Classifier layer — takes segments the Segmenter
 * already found (`../language-listening/segmenter.mjs`'s
 * `*.segments.jsonl`, READ-ONLY input, never overwritten) and classifies
 * each non-SILENCE one as SPEECH / MUSIC / NOISE / MIXED / UNKNOWN, using
 * a real, already-installed system tool: Apple's own
 * `SoundAnalysis.framework` (`SNClassifySoundRequest`, `.version1` — the
 * built-in macOS Core ML sound classifier, confirmed present on this
 * machine, never downloaded) via `./classify-tool/classify-tool`
 * (compiled once by `./classify-tool/build.sh`).
 *
 * This is a separate capability folder from `../language-listening/` on
 * purpose (Owner instruction, 2026-08-21) — it never imports
 * segmenter.mjs, it only reads the JSONL file path it's given, and it
 * writes its OWN evidence file (`*.classified.jsonl`), never touching the
 * Segmenter's own `*.segments.jsonl`. Every output row carries the real
 * WAV path + segment_id + start_ms/end_ms it came from, so a caller can
 * always trace back session -> WAV -> exact sample range that produced a
 * given classification.
 *
 * Classification rule (deliberately simple, deterministic, and honestly
 * limited — see ./README.md for why): only the classifier's own "speech"
 * and "music" confidence scores (aggregated — max — across every
 * classifier window overlapping the segment) decide the category. Every
 * other one of Apple's ~300 labels is NOT individually mapped to
 * "NOISE"/etc. — this is a threshold rule over two labels, not a
 * from-scratch multi-class noise taxonomy:
 *   speech >= 0.5 && music <  0.3  -> SPEECH
 *   music  >= 0.5 && speech <  0.3 -> MUSIC
 *   speech >= 0.3 && music  >= 0.3 -> MIXED
 *   speech <  0.3 && music  <  0.3 && some other label >= 0.3 -> NOISE
 *   otherwise (nothing confident)  -> UNKNOWN
 *
 * Input: `classifySegments(segmentsJsonlPath, wavPath, outDir)`.
 * Output: `{ evidencePath, classifications }`, one entry per non-SILENCE
 * input segment: `{ session_wav, segment_id, start_ms, end_ms,
 * segmenter_kind, speech_score, music_score, top_other_label,
 * top_other_score, classification }`.
 * Dependency ที่อนุญาต: node:child_process (spawn ./classify-tool/classify-tool
 * only), node:fs, node:path. ห้าม import ../language-listening/*.
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const classifyToolBin = join(__dirname, "classify-tool", "classify-tool");

const SPEECH_HIGH = 0.5;
const MUSIC_HIGH = 0.5;
const LOW = 0.3;

function runClassifyTool(wavPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(classifyToolBin, [wavPath]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString("utf-8"); });
    child.stderr.on("data", (d) => { stderr += d.toString("utf-8"); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) { reject(new Error(`CLASSIFY_TOOL_EXIT code=${code} stderr=${stderr.slice(-500)}`)); return; }
      const windows = stdout
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l));
      resolve(windows);
    });
  });
}

function scoreFor(label, windows) {
  let max = 0;
  for (const w of windows) {
    const hit = w.top.find((t) => t.label === label);
    if (hit && hit.confidence > max) max = hit.confidence;
  }
  return max;
}

function topOtherLabel(windows) {
  const best = { label: null, confidence: 0 };
  for (const w of windows) {
    for (const t of w.top) {
      if (t.label === "speech" || t.label === "music") continue;
      if (t.confidence > best.confidence) { best.label = t.label; best.confidence = t.confidence; }
    }
  }
  return best;
}

function decide(speechScore, musicScore, other) {
  if (speechScore >= SPEECH_HIGH && musicScore < LOW) return "SPEECH";
  if (musicScore >= MUSIC_HIGH && speechScore < LOW) return "MUSIC";
  if (speechScore >= LOW && musicScore >= LOW) return "MIXED";
  if (speechScore < LOW && musicScore < LOW && other.confidence >= LOW) return "NOISE";
  return "UNKNOWN";
}

/**
 * `segmentsJsonlPath` — a real `*.segments.jsonl` written by
 * `../language-listening/segmenter.mjs` (read-only). `wavPath` — the same
 * WAV that Segmenter analyzed (must be passed explicitly — this module
 * never guesses or hardcodes a path into another capability's data).
 */
export async function classifySegments(segmentsJsonlPath, wavPath, outDir) {
  mkdirSync(outDir, { recursive: true });
  const segments = readFileSync(segmentsJsonlPath, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));

  const windows = await runClassifyTool(wavPath);

  const classifications = [];
  for (const seg of segments) {
    if (seg.kind === "SILENCE") continue; // Segmenter already decided this — Classifier only ever looks at candidate speech/sound regions.
    const startS = seg.start_ms / 1000;
    const endS = seg.end_ms / 1000;
    const overlapping = windows.filter((w) => w.start_s < endS && w.end_s > startS);
    const speechScore = scoreFor("speech", overlapping);
    const musicScore = scoreFor("music", overlapping);
    const other = topOtherLabel(overlapping);
    classifications.push({
      session_wav: wavPath,
      segment_id: seg.segment_id,
      start_ms: seg.start_ms,
      end_ms: seg.end_ms,
      segmenter_kind: seg.kind,
      speech_score: speechScore,
      music_score: musicScore,
      top_other_label: other.label,
      top_other_score: other.confidence,
      classification: decide(speechScore, musicScore, other),
    });
  }

  const evidencePath = join(outDir, `${basename(wavPath, ".wav")}.classified.jsonl`);
  writeFileSync(evidencePath, `${classifications.map((c) => JSON.stringify(c)).join("\n")}\n`, "utf-8");
  return { evidencePath, classifications };
}
