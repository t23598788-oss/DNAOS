#!/usr/bin/env node
/**
 * หน้าที่: thin CLI wrapper around ./context-boundary.mjs's `groupContext`
 * — `node context-cli.mjs <transcribed.jsonl> [out-dir]`.
 * Dependency ที่อนุญาต: ./context-boundary.mjs.
 */
import { groupContext } from "./context-boundary.mjs";
import { dirname } from "node:path";

const transcribedPath = process.argv[2];
const outDir = process.argv[3] ?? dirname(transcribedPath ?? ".");

if (!transcribedPath) {
  console.error("Usage: node context-cli.mjs <transcribed.jsonl> [out-dir]");
  process.exitCode = 1;
} else {
  const { evidencePath, records } = groupContext(transcribedPath, outDir);
  const contextIds = new Set(records.map((r) => r.context_id).filter(Boolean));
  console.log(JSON.stringify({
    evidence_path: evidencePath,
    total_records: records.length,
    context_runs: contextIds.size,
    context_ids: [...contextIds],
  }, null, 2));
}
