// Phase 21 — real DISCOVER -> VERIFY_CONNECTION -> VERIFY_PERMISSION ->
// INGEST assessment for every candidate ambient-interaction source. No
// source is assumed connected. Run: node observation_sources.mjs
import fs from "node:fs";
import path from "node:path";

const DIR = path.dirname(new URL(import.meta.url).pathname);

const CANDIDATES = [
  { source_id: "claude-code-sessions", path: `${process.env.HOME}/.claude/projects`, note: "Claude Code's own local session transcripts — real files, but no programmatic real-time hook exists in this pipeline to read them as they're written" },
  { source_id: "vscode-logs", path: `${process.env.HOME}/Library/Application Support/Code/logs`, note: "VS Code extension host logs — real files exist on disk; no connector reads them for this pipeline" },
  { source_id: "codex-cli-sessions", path: `${process.env.HOME}/.codex/sessions`, note: "OpenAI Codex CLI sessions — NOT the ChatGPT web product; a distinct, separate tool. No connector reads them." },
  { source_id: "chatgpt-web", path: null, note: "No local export, API connection, or MCP connector to ChatGPT (the web product) exists anywhere in this session or repo — genuinely absent, not merely unread" },
  { source_id: "dna-os-circuit-server-logs", path: "/private/tmp/claude-501/-Users-tam-Desktop-DNA-OS-INFRASTRUCTURE/7c6a2c83-ad31-496c-8c1e-5e5cc5bbf449/scratchpad", note: "real stdout/stderr logs from this session's own dna-os-circuit server runs — DNA-OS-owned, already read this session" },
];

function assessSource(c) {
  const record = { source_id: c.source_id, note: c.note };
  record.discover = c.path ? "FOUND" : "NOT_FOUND";
  if (!c.path) {
    record.verify_connection = "N/A";
    record.verify_permission = "N/A";
    record.ingest = "BLOCKED — no source to connect to";
    record.status = "DISCONNECTED";
    return record;
  }
  const exists = fs.existsSync(c.path);
  record.verify_connection = exists ? "REACHABLE" : "UNREACHABLE";
  if (!exists) {
    record.verify_permission = "N/A";
    record.ingest = "BLOCKED";
    record.status = "DISCONNECTED";
    return record;
  }
  let readable = false;
  try { fs.accessSync(c.path, fs.constants.R_OK); readable = true; } catch { readable = false; }
  record.verify_permission = readable ? "READABLE" : "PERMISSION_DENIED";
  if (!readable) {
    record.ingest = "BLOCKED";
    record.status = "BLOCKED";
    return record;
  }
  // INGEST capability: does a real, built connector in THIS pipeline actually read this source
  // automatically (not "could a human open the file"), and correlate events across sources?
  const hasRealIngestConnector = c.source_id === "dna-os-circuit-server-logs"; // the only one built this phase — see log_observer.mjs
  record.ingest = hasRealIngestConnector ? "CONNECTED" : "NOT_BUILT — path is readable, but no automated ingestion connector exists yet";
  record.status = hasRealIngestConnector ? "CONNECTED" : "DISCOVERABLE_NOT_CONNECTED";
  return record;
}

const results = CANDIDATES.map(assessSource);
fs.writeFileSync(path.join(DIR, "observation_sources.json"), JSON.stringify({ generated_at: new Date().toISOString(), sources: results }, null, 2), "utf-8");
console.log(JSON.stringify(results, null, 2));
