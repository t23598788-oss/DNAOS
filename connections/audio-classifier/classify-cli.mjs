#!/usr/bin/env node
/**
 * หน้าที่: thin CLI wrapper around ./audio-classifier.mjs's
 * `classifySegments` — `node classify-cli.mjs <segments.jsonl> <wav-path>
 * [out-dir]`.
 * Dependency ที่อนุญาต: ./audio-classifier.mjs.
 */
import { classifySegments } from "./audio-classifier.mjs";
import { dirname } from "node:path";

const segmentsPath = process.argv[2];
const wavPath = process.argv[3];
const outDir = process.argv[4] ?? dirname(segmentsPath ?? ".");

if (!segmentsPath || !wavPath) {
  console.error("Usage: node classify-cli.mjs <segments.jsonl> <wav-path> [out-dir]");
  process.exitCode = 1;
} else {
  const { evidencePath, classifications } = await classifySegments(segmentsPath, wavPath, outDir);
  const counts = classifications.reduce((acc, c) => {
    acc[c.classification] = (acc[c.classification] ?? 0) + 1;
    return acc;
  }, {});
  console.log(JSON.stringify({ evidence_path: evidencePath, total_classified: classifications.length, counts }, null, 2));
}
