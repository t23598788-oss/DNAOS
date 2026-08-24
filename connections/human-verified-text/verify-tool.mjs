#!/usr/bin/env node
/**
 * หน้าที่: the Human Verified Text layer — a real, interactive terminal
 * tool, self-contained in ONE terminal window (2026-08-21 Owner
 * instruction: no copy-pasting a `sox` command into a second window).
 * Reads `../evidence-store/evidence-store.mjs`'s `*.evidence.jsonl`
 * (READ-ONLY, never overwritten) and, for every `TRANSCRIBED` record:
 *   1. Automatically spawns real `sox` to play that segment's original
 *      audio through the default output device (`stdio: "inherit"`, same
 *      process/terminal — never a second window), and waits for it to
 *      finish before asking anything.
 *   2. Asks a REAL HUMAN (never simulated, never LLM-guessed) what they
 *      heard, then to label it THAI / ISAN / MIXED / OTHER / UNKNOWN.
 * Nothing here is decided by code — this file only plays the real audio
 * and records exactly what the human typed.
 *
 * Shortcuts at the transcript prompt: `r` = replay the same audio and ask
 * again, `s` = skip this segment (no record written, revisit later),
 * `q` = save (already-written records are already on disk — see
 * Resumable, below) and end the session now.
 *
 * This is the first stage of a separate, NEW pipeline (Owner instruction,
 * 2026-08-21) — never touches `../evidence-store/` or any earlier
 * Listening-pipeline capability folder:
 *   Evidence -> Human Verified Text (HERE) -> Ground Truth Dataset
 *
 * Resumable: each record is appended to disk immediately after its label
 * is chosen (not batched at the end), and re-running against the same
 * evidence file skips any `(source_wav, segment_id)` pair already present
 * in the output file — a long labeling session can be done across
 * multiple sittings, and `q` never loses already-answered segments.
 *
 * Input: `node verify-tool.mjs <evidence.jsonl> [out-dir] [labeled-by]`.
 * Output: appends to `<session>.verified.jsonl` — every original evidence
 * field, plus `{ verified_text, language_label, labeled_by, labeled_at }`.
 * `verified_text` is exactly what the human typed (or the original
 * `raw_transcript`, if they pressed Enter to accept it as-is) — never
 * auto-corrected, translated, or LLM-rewritten.
 * Dependency ที่อนุญาต: node:fs, node:path, node:readline,
 * node:child_process (spawn `sox` only — same real binary
 * `../evidence-store/`'s own `verify_command` already names). ห้าม import
 * ../evidence-store/* หรือ layer อื่นใดใน Listening pipeline.
 */
import { readFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";

const VALID_LABELS = new Set(["THAI", "ISAN", "MIXED", "OTHER", "UNKNOWN"]);

const evidencePath = process.argv[2];
const outDir = process.argv[3] ?? (evidencePath ? join(evidencePath, "..") : ".");
const labeledBy = process.argv[4] ?? process.env.USER ?? "unknown";

if (!evidencePath) {
  console.error("Usage: node verify-tool.mjs <evidence.jsonl> [out-dir] [labeled-by]");
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const sessionLabel = basename(evidencePath, ".evidence.jsonl");
const verifiedPath = join(outDir, `${sessionLabel}.verified.jsonl`);

const evidenceRows = readFileSync(evidencePath, "utf-8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));

const alreadyDone = new Set();
if (existsSync(verifiedPath)) {
  for (const line of readFileSync(verifiedPath, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    alreadyDone.add(`${r.source_wav}::${r.segment_id}`);
  }
}

const candidates = evidenceRows.filter(
  (r) => r.status === "TRANSCRIBED" && !alreadyDone.has(`${r.source_wav}::${r.segment_id}`)
);
const notApplicable = evidenceRows.length - evidenceRows.filter((r) => r.status === "TRANSCRIBED").length;

console.log(`Evidence file: ${evidencePath}`);
console.log(`Total rows: ${evidenceRows.length} | already verified: ${alreadyDone.size} | not applicable (not TRANSCRIBED): ${notApplicable} | to review now: ${candidates.length}`);
console.log("Each segment's real audio plays automatically. After it finishes: type what you heard, or 'r' replay / 's' skip / 'q' save-and-quit.\n");

/** Plays `row`'s real original audio slice via a real `sox` child in THIS terminal (stdio: "inherit" — never a second window), resolving once playback finishes. */
function playAudio(row) {
  return new Promise((resolve, reject) => {
    const startS = (row.start_ms / 1000).toFixed(3);
    const durS = ((row.end_ms - row.start_ms) / 1000).toFixed(3);
    const child = spawn("sox", [row.source_wav, "-d", "trim", startS, durS], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", () => resolve());
  });
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
// Deliberately NOT chained rl.question() calls — real, reproduced issue
// this round: rl.question() only reliably resolves once when stdin is a
// non-TTY pipe (a second chained question() call never resolves), while
// consuming the readline instance's own async iterator does not have
// this problem, for both piped and real interactive TTY input.
const lineIterator = rl[Symbol.asyncIterator]();
async function ask(question) {
  process.stdout.write(question);
  const { value, done } = await lineIterator.next();
  return done ? null : value;
}

async function main() {
  for (const row of candidates) {
    console.log("----------------------------------------------------------------");
    console.log(`segment_id=${row.segment_id}  context_id=${row.context_id}  [${row.start_ms}-${row.end_ms}ms]`);

    let textAnswer = null;
    // Loop only for 'r' (replay) — every other outcome (real text, 's', 'q', stdin close) exits it.
    for (;;) {
      console.log("(playing audio...)");
      await playAudio(row);

      const textRaw = await ask("what did you hear? (type it, or r=replay / s=skip / q=save&quit): ");
      if (textRaw === null) { console.log("\nstdin closed — ending session early."); rl.close(); console.log(`Output: ${verifiedPath}`); return; }
      const trimmed = textRaw.trim();
      const lower = trimmed.toLowerCase();

      if (lower === "r") continue; // replay, ask again
      if (lower === "q") { console.log("\nsaving and ending session now."); rl.close(); console.log(`Output: ${verifiedPath}`); return; }
      if (lower === "s") { textAnswer = null; break; } // skip
      textAnswer = trimmed;
      break;
    }

    if (textAnswer === null) {
      console.log("skipped.\n");
      continue;
    }
    const verifiedText = textAnswer.length > 0 ? textAnswer : row.raw_transcript;

    let label = "";
    while (!VALID_LABELS.has(label)) {
      const labelRaw = await ask(`language label [${[...VALID_LABELS].join("/")}] (or r=replay / s=skip / q=save&quit): `);
      if (labelRaw === null) { console.log("\nstdin closed — ending session early."); rl.close(); console.log(`Output: ${verifiedPath}`); return; }
      const trimmed = labelRaw.trim();
      const lower = trimmed.toLowerCase();
      if (lower === "r") { console.log("(playing audio...)"); await playAudio(row); continue; }
      if (lower === "q") { console.log("\nsaving and ending session now."); rl.close(); console.log(`Output: ${verifiedPath}`); return; }
      if (lower === "s") { label = null; break; }
      label = trimmed.toUpperCase();
      if (!VALID_LABELS.has(label)) { console.log(`Invalid — must be one of ${[...VALID_LABELS].join(", ")}, or r/s/q.`); label = ""; }
    }
    if (label === null) { console.log("skipped.\n"); continue; }

    const record = {
      ...row,
      verified_text: verifiedText,
      language_label: label,
      labeled_by: labeledBy,
      labeled_at: new Date().toISOString(),
    };
    appendFileSync(verifiedPath, `${JSON.stringify(record)}\n`, "utf-8");
    console.log("saved.\n");
  }

  console.log("Session complete.");
  console.log(`Output: ${verifiedPath}`);
  rl.close();
}

main();
