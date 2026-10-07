#!/usr/bin/env node
/**
 * หน้าที่: thin CLI wrapper around ./evidence-store.mjs's `buildEvidence`
 * — `node evidence-cli.mjs <context.jsonl> [out-dir]`.
 * Dependency ที่อนุญาต: ./evidence-store.mjs.
 */
import { buildEvidence } from "./evidence-store.mjs";
import { dirname } from "node:path";

const contextPath = process.argv[2];
const outDir = process.argv[3] ?? dirname(contextPath ?? ".");

if (!contextPath) {
  console.error("Usage: node evidence-cli.mjs <context.jsonl> [out-dir]");
  process.exitCode = 1;
} else {
  const { evidencePath, evidence } = buildEvidence(contextPath, outDir);
  const withTranscript = evidence.filter((e) => e.raw_transcript).length;
  console.log(JSON.stringify({
    evidence_path: evidencePath,
    total_records: evidence.length,
    records_with_transcript: withTranscript,
  }, null, 2));
}
