// Phase 21, TEST CASE 1 — "Owner repeatedly has to copy explanations
// between ChatGPT, Claude and VS Code." This script does NOT treat the
// sentence as proof. It checks what is ACTUALLY observable given the
// real connected-source status from observation_sources.json.
import fs from "node:fs";
import path from "node:path";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const sources = JSON.parse(fs.readFileSync(path.join(DIR, "observation_sources.json"), "utf-8")).sources;

const byId = Object.fromEntries(sources.map((s) => [s.source_id, s]));

const assessment = {
  claim: "Owner repeatedly has to copy explanations between ChatGPT, Claude and VS Code in order to continue development.",
  claim_treated_as_proof: false,
  required_observations: [
    { what: "a real event marking Owner leaving Claude Code and entering ChatGPT (or vice versa)", available: false, reason: "no connector observes cross-application focus/switching — not built, not connected" },
    { what: "a real event marking content copied from one tool and pasted into another", available: false, reason: "no clipboard-observation capability exists in this repo or session" },
    { what: "ChatGPT-side session content, to correlate against Claude Code session content", available: byId["chatgpt-web"].status === "CONNECTED", reason: byId["chatgpt-web"].note },
    { what: "VS Code-side activity correlated by timestamp with Claude Code sessions", available: byId["vscode-logs"].status === "CONNECTED", reason: `vscode-logs status=${byId["vscode-logs"].status} — path is readable but no ingestion connector reads/correlates it` },
    { what: "a recurrence count — how many times this actually happened", available: false, reason: "cannot be measured without at least one of the above" },
  ],
  recurrence_measurable: false,
  manual_transitions_observable: false,
  evidence_available: [],
  evidence_missing: ["cross-tool switch events", "clipboard copy/paste events", "ChatGPT-side session data", "correlated VS Code activity timeline", "recurrence count"],
  decision: "INSUFFICIENT_EVIDENCE",
  status: "PROBLEM_SIGNAL", // stays a signal, not a Problem record — per Phase 21's own rule
  missing_observation_capability: "A real, connected, permissioned ingestion path for at least ChatGPT session content OR a cross-application activity/clipboard observer, correlated by timestamp against Claude Code's own session logs. None exists today (see observation_sources.json: chatgpt-web=DISCONNECTED, vscode-logs=DISCOVERABLE_NOT_CONNECTED).",
};

fs.writeFileSync(path.join(DIR, "test_case_1_result.json"), JSON.stringify(assessment, null, 2), "utf-8");
console.log(JSON.stringify(assessment, null, 2));
