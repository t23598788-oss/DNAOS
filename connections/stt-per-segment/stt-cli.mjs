#!/usr/bin/env node
/**
 * หน้าที่: thin CLI wrapper around ./stt-segment.mjs's `transcribeSegments`
 * — `node stt-cli.mjs <classified.jsonl> <wav-path> [out-dir]`.
 * Dependency ที่อนุญาต: ./stt-segment.mjs.
 */
import { transcribeSegments } from "./stt-segment.mjs";
import { dirname } from "node:path";

const classifiedPath = process.argv[2];
const wavPath = process.argv[3];
const outDir = process.argv[4] ?? dirname(classifiedPath ?? ".");

if (!classifiedPath || !wavPath) {
  console.error("Usage: node stt-cli.mjs <classified.jsonl> <wav-path> [out-dir]");
  process.exitCode = 1;
} else {
  const { evidencePath, records } = await transcribeSegments(classifiedPath, wavPath, outDir);
  const counts = records.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  console.log(JSON.stringify({ evidence_path: evidencePath, total_segments: records.length, counts }, null, 2));
}
