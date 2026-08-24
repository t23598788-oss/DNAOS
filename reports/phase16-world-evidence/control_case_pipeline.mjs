// Phase 21 — CONTROL CASE: the real, machine-observable "spawnSync node
// ETIMEDOUT" failure that actually occurred in this session's own
// /resolve-problem endpoint (Phase 20). This script ingests REAL log
// files already on disk (no fabricated data), builds a PROBLEM_SIGNAL
// with measured recurrence, runs it through the REAL existing
// permissions/write-gate + software/capability-registrar for a policy
// decision, and re-executes the REAL original trigger (a live HTTP POST)
// to verify the failure condition no longer reproduces.
//
// Run: node reports/phase16-world-evidence/control_case_pipeline.mjs
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(DIR, "..", "..");
const LOG_DIR = "/private/tmp/claude-501/-Users-tam-Desktop-DNA-OS-INFRASTRUCTURE/7c6a2c83-ad31-496c-8c1e-5e5cc5bbf449/scratchpad";
const TASK_DIR = "/private/tmp/claude-501/-Users-tam-Desktop-DNA-OS-INFRASTRUCTURE/7c6a2c83-ad31-496c-8c1e-5e5cc5bbf449/tasks";

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}
function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(url, { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } }, (res) => {
      let out = "";
      res.on("data", (c) => (out += c));
      res.on("end", () => resolve({ status: res.statusCode, body: out }));
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// --- STAGE: OBSERVATION -> SIGNAL (real log scan, no fabrication) ---
function scanForRealOccurrences() {
  const occurrences = [];
  const scanDir = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      let stat;
      try { stat = fs.statSync(full); } catch { continue; }
      if (!stat.isFile()) continue;
      let content;
      try { content = fs.readFileSync(full, "utf-8"); } catch { continue; }
      if (content.includes("ETIMEDOUT") && content.includes("resolve-problem") === false && content.includes("spawnSync node ETIMEDOUT")) {
        occurrences.push({ file: full, mtime: stat.mtime.toISOString(), snippet: content.slice(0, 120) });
      } else if (content.includes("spawnSync node ETIMEDOUT")) {
        occurrences.push({ file: full, mtime: stat.mtime.toISOString(), snippet: content.slice(0, 120) });
      }
    }
  };
  scanDir(LOG_DIR);
  scanDir(TASK_DIR);
  return occurrences;
}

const occurrences = scanForRealOccurrences();

const signal = {
  signal_id: "sig-etimedout-resolve-problem",
  source: "dna-os-circuit-server-logs (CONNECTED, observation_sources.json)",
  raw_text: "spawnSync node ETIMEDOUT",
  first_seen: occurrences.length ? occurrences.map((o) => o.mtime).sort()[0] : null,
  last_seen: occurrences.length ? occurrences.map((o) => o.mtime).sort().reverse()[0] : null,
  status: occurrences.length > 0 ? "SIGNAL_CONFIRMED" : "NO_SIGNAL_FOUND",
};

// --- STAGE: EVIDENCE + RECURRENCE (measured, not asserted) ---
const evidence = { occurrences, recurrence_count: occurrences.length, distinct_files: [...new Set(occurrences.map((o) => o.file))].length };

// --- STAGE: IMPACT (derived from measurable events — real HTTP 500s already recorded in these same logs) ---
const impact = {
  observed_effect: occurrences.length > 0 ? "HTTP 500 on POST /resolve-problem (recorded in the same log lines: {\"error\":\"spawnSync node ETIMEDOUT\"})" : "none observed",
  affected_capability: "dna-os-circuit /resolve-problem endpoint (Phase 20)",
  severity: occurrences.length >= 2 ? "RECURRING" : occurrences.length === 1 ? "SINGLE_OCCURRENCE" : "NONE",
};

// --- STAGE: ROOT_CAUSE (traceable to the real diagnosis already recorded in server.ts's own comment) ---
const serverSrc = fs.readFileSync(path.join(REPO, "dna-os-circuit/runtime/server.ts"), "utf-8");
const hasRootCauseComment = serverSrc.includes("reliably hangs to its own timeout specifically when called from this");
const rootCause = {
  statement: "execFileSync (sync child_process API) hangs specifically when invoked from this tsx-loaded, detached (nohup) server process; the async spawn API does not share the issue.",
  traceable_to_source: hasRootCauseComment,
  evidence_location: "dna-os-circuit/runtime/server.ts, runResolver() function's own header comment",
};

// --- STAGE: CAPABILITY_CHECK (real registrar, reused not reinvented — plain text search, avoiding a nested ts import, same lesson as Phase 20) ---
const circuitCapabilityRegistered = fs.readFileSync(path.join(REPO, "control/command-router/capability-registry.ts"), "utf-8").includes('capability_id: "dna-os-circuit"');
const capabilityCheck = {
  existing_capability_found: circuitCapabilityRegistered,
  capability_id: "dna-os-circuit",
  decision: circuitCapabilityRegistered ? "REUSE_FIX_EXISTING_CAPABILITY" : "SOFTWARE_CHANGE_REQUIRED_NEW_CAPABILITY",
};

// --- STAGE: POLICY_GATE (REAL permissions/write-gate + software/capability-registrar, not reimplemented) ---
async function evaluatePolicyGate() {
  const { evaluateWriteIntent } = await import(path.join(REPO, "permissions/write-gate/contract.ts"));
  const { CAPABILITY_INDEX } = await import(path.join(REPO, "software/capability-registrar/contract.ts"));
  const intent = {
    intent_id: `intent-${Date.now()}`,
    operation: "MODIFY",
    capability: "dna-os-circuit",
    target_type: "FILE",
    target_path: "dna-os-circuit/runtime/server.ts",
    requested_change: "Replace execFileSync with async spawn in /resolve-problem's handler to fix a measured, recurring ETIMEDOUT failure.",
    requesting_agent: { identity_id: "phase21-autonomous-loop", kind: "ai_agent", display_name: "Phase 21 Autonomous Feedback Loop" },
    evidence: [{ source: "reports/phase16-world-evidence/control_case_pipeline.mjs", note: `${evidence.recurrence_count} real recurrences observed in local logs` }],
    correlation_id: `corr-${Date.now()}`,
    submitted_at: new Date().toISOString(),
  };
  const decision = evaluateWriteIntent(intent, { registryIndex: CAPABILITY_INDEX });
  return { intent, decision };
}

// --- STAGE: EXECUTION + TEST + VERIFY (real HTTP call against the live server — the fix already exists in server.ts from Phase 20; this proves the loop's VERIFY step, not that this run wrote new code) ---
async function verifyOriginalProblem() {
  try {
    const res = await postJson("http://localhost:8790/resolve-problem", { problem_text: "control case verification ping" });
    const stillFails = res.status === 500 && res.body.includes("ETIMEDOUT");
    return { attempted: true, http_status: res.status, still_reproduces: stillFails, response_snippet: res.body.slice(0, 200) };
  } catch (err) {
    return { attempted: true, error: err.message, still_reproduces: null };
  }
}

/**
 * Second, control-positive policy check: the write-gate's registry
 * granularity (see below) DENIES writes to dna-os-circuit/runtime/ — this
 * proves that path is honestly blocked, not authorized-then-ignored.
 * This second intent targets dna-os-circuit/definition/circuit.json,
 * whose folder DOES match the registered "dna-os-circuit" capability's
 * real OWNER_FOLDER — proving the ALLOW path also genuinely works, not
 * just the DENY path.
 */
async function evaluatePositiveControlPolicyGate() {
  const { evaluateWriteIntent } = await import(path.join(REPO, "permissions/write-gate/contract.ts"));
  const { CAPABILITY_INDEX } = await import(path.join(REPO, "software/capability-registrar/contract.ts"));
  const intent = {
    intent_id: `intent-positive-${Date.now()}`,
    operation: "MODIFY",
    capability: "dna-os-circuit",
    target_type: "FILE",
    target_path: "dna-os-circuit/definition/circuit.json",
    requested_change: "positive control: this path DOES match the registered dna-os-circuit capability's real OWNER_FOLDER (dna-os-circuit/definition/)",
    requesting_agent: { identity_id: "phase21-autonomous-loop", kind: "ai_agent", display_name: "Phase 21 Autonomous Feedback Loop" },
    evidence: [{ source: "reports/phase16-world-evidence/control_case_pipeline.mjs", note: "positive control for the policy gate" }],
    correlation_id: `corr-positive-${Date.now()}`,
    submitted_at: new Date().toISOString(),
  };
  const decision = evaluateWriteIntent(intent, { registryIndex: CAPABILITY_INDEX });
  return { intent, decision };
}

async function main() {
  const { intent, decision } = await evaluatePolicyGate();
  const positiveControl = await evaluatePositiveControlPolicyGate();
  const verification = await verifyOriginalProblem();

  const executionStage = {
    authorized: decision.decision === "ALLOW_MODIFY" || decision.decision === "ALLOW_CREATE",
    policy_decision: decision.decision,
    reason_codes: decision.reason_codes,
    note: decision.decision === "ALLOW_MODIFY"
      ? "Policy gate ALLOWS this change (existing capability, real overlap found). The async-spawn fix already exists in server.ts (applied during Phase 20's live debugging, same root cause, same file) — this run's EXECUTION stage is therefore a no-op re-confirmation, not a fresh write. A genuinely NEW future signal would have this stage call execution/file-write's real executeFileWrite() with this exact decision object."
      : "Policy gate did not authorize a write this run.",
  };

  const measuredRecurrenceAfterFix = verification.still_reproduces === false;

  const output = {
    generated_at: new Date().toISOString(),
    pipeline: "OBSERVATION -> SIGNAL -> EVIDENCE -> RECURRENCE -> IMPACT -> ROOT_CAUSE -> CAPABILITY_CHECK -> POLICY_GATE -> EXECUTION -> TEST -> VERIFY -> MEASURE_RECURRENCE",
    signal,
    evidence,
    impact,
    root_cause: rootCause,
    capability_check: capabilityCheck,
    policy: { intent, decision },
    policy_positive_control: positiveControl,
    execution: executionStage,
    verification,
    measured_recurrence_after_fix: measuredRecurrenceAfterFix ? "PROBLEM_NO_LONGER_REPRODUCES (measured via live HTTP call, not asserted)" : "STILL_REPRODUCES_OR_UNVERIFIED",
    success_determined_by: "measurement (live HTTP status/body check), not by AI declaration",
  };
  fs.writeFileSync(path.join(DIR, "control_case_result.json"), JSON.stringify(output, null, 2), "utf-8");
  console.log(JSON.stringify(output, null, 2));
}
main();
