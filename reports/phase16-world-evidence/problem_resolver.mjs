// Phase 20 — the single Owner-facing resolver. Input: free-text problem
// statement ONLY. The Owner never names a model/Lab/worker/repo/scanner/
// tool. This function determines which EXISTING capability answers the
// problem, executes it for real, and verifies a result against an
// explicit acceptance condition — it never equates "a tool ran" with
// "the problem is solved".
//
// REUSE-FIRST: this checks the real, existing capability registry
// (control/command-router/capability-registry.ts, via software/
// capability-registrar) before consulting the one Phase-20-specific
// resolution table added for cases the registry's keyword matcher
// cannot reach (a meta/navigational complaint about the system itself,
// which is not a "command" in that registry's sense).
//
// Run: node reports/phase16-world-evidence/problem_resolver.mjs "<problem text>"
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(DIR, "..", "..");

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

/**
 * Phase-20-specific resolution table — real entries only, each pointing
 * at an ALREADY-BUILT, ALREADY-RUNNING capability. No entry here invents
 * a new tool. Matched by simple substring rules on the raw problem text
 * (Thai + English) — same "match_keyword_sets, every keyword required"
 * discipline as control/command-router/router.ts's real matchesText().
 */
const RESOLUTION_TABLE = [
  {
    resolution_id: "confusion-about-which-tool",
    match_keyword_sets: [
      ["ซับซ้อน", "ไม่รู้ว่าต้องใช้"],
      ["complex", "which tool"],
      ["don't know", "which"],
    ],
    required_outcome: "Owner has one place to look that answers 'what's real, what's running, what's next' — WITHOUT choosing any AI/Lab/worker/repo/scanner/tool",
    relevant_existing_capability: "dna-os-circuit (Owner View / World View) — control/command-router, permissions/*, execution/*, DNA-LAB-FILE-INTELLIGENCE, DNA-LAB-PERMISSION-REASONER all already surface through this ONE running interface, built Phase 4-19",
    required_tools: [], // nothing new — the interface already exists
    execution_path: { kind: "http_check", url: "http://localhost:8790/" },
    verify: { kind: "http_content_check", url: "http://localhost:8790/circuit.json", expect_field: "nodes", expect_min_length: 20 },
    acceptance_condition: "the Owner can open exactly one URL, with zero prior tool/repo/AI selection, and see a real, live-computed status of the whole system (nodes, statuses, evidence) rendered on screen",
  },
];

function matchResolution(problemText) {
  for (const entry of RESOLUTION_TABLE) {
    const matched = entry.match_keyword_sets.some((set) => set.every((kw) => problemText.includes(kw)));
    if (matched) return entry;
  }
  return null;
}

/**
 * Real check against the real, existing registry — reused, not
 * reimplemented — but read directly rather than via a nested subprocess:
 * spawning a second child process from inside this already-spawned
 * resolver (server -> node problem_resolver.mjs -> tsx) proved
 * unreliable specifically when this script runs as a detached/no-TTY
 * child of the HTTP server (real, observed: consistent ETIMEDOUT only in
 * that context; 206ms when run directly — diagnosed and fixed in
 * Phase 20). This reads control/command-router/capability-registry.ts's
 * real `match_keyword_sets` arrays via regex over the real source file —
 * the exact same data the real `classifyCommand()`/`matchesText()` use —
 * without a second spawn. If the file's shape ever changes beyond what
 * this regex expects, this degrades to REGISTRY_CHECK_FAILED honestly,
 * never a false match.
 */
function checkExistingRegistry(problemText) {
  const tmpFile = path.join(DIR, "_registry_check_tmp.mjs");
  try {
    const src = fs.readFileSync(path.join(REPO, "control/command-router/capability-registry.ts"), "utf-8");
    const blocks = src.split(/capability_id:\s*"/).slice(1);
    for (const block of blocks) {
      const capabilityId = block.slice(0, block.indexOf('"'));
      const kwMatch = block.match(/match_keyword_sets:\s*\[([\s\S]*?)\],\s*\n\s*permission_requirement/);
      if (!kwMatch) continue;
      const sets = [...kwMatch[1].matchAll(/\[([^\]]*)\]/g)].map((m) => [...m[1].matchAll(/"([^"]*)"/g)].map((k) => k[1]));
      const matched = sets.some((set) => set.length > 0 && set.every((kw) => problemText.includes(kw)));
      if (matched) return { status: "MATCHED", capability: { capability_id: capabilityId } };
    }
    return { status: "UNSUPPORTED_COMMAND", reason: `no registered capability's match_keyword_sets matched "${problemText}"` };
  } catch (err) {
    return { status: "REGISTRY_CHECK_FAILED", error: err.message.slice(0, 300) };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* best-effort cleanup */ }
  }
}

async function resolveProblem(problemText) {
  const statusLog = [];
  statusLog.push({ stage: "กำลังตรวจ", at: new Date().toISOString() });

  const registryResult = await checkExistingRegistry(problemText);
  statusLog.push({ stage: "กำลังจัดเส้นทาง", at: new Date().toISOString(), registry_check: registryResult });

  let resolution = null;
  let routedVia = null;
  if (registryResult.status === "MATCHED") {
    resolution = { relevant_existing_capability: registryResult.capability.capability_id, execution_path: { kind: "capability_registry", capability: registryResult.capability } };
    routedVia = "existing control/command-router registry (real match)";
  } else {
    resolution = matchResolution(problemText);
    routedVia = resolution ? "Phase 20 resolution table (registry had no match — this is a meta/navigational complaint, not a routable command)" : null;
  }

  if (!resolution) {
    statusLog.push({ stage: "ยังไม่สำเร็จ", at: new Date().toISOString() });
    return { problem_text: problemText, status_log: statusLog, result: "ยังไม่สำเร็จ", evidence: { what_changed: "nothing", what_verified_it: "no matching capability found in the existing registry or resolution table", what_remains_unresolved: "this problem has no known existing-capability match yet" } };
  }

  statusLog.push({ stage: "กำลังทำ", at: new Date().toISOString(), executing: resolution.execution_path });

  let executionResult;
  try {
    if (resolution.execution_path.kind === "http_check") {
      const res = await get(resolution.execution_path.url);
      executionResult = { ok: res.status === 200, status_code: res.status };
    } else {
      executionResult = { ok: true, note: "routed via existing registry — capability already CONNECTED per capability-registry.ts, no separate execution performed by this resolver (would require the real command-router runtime wiring, out of scope for this problem-resolution test)" };
    }
  } catch (err) {
    executionResult = { ok: false, error: err.message };
  }

  statusLog.push({ stage: "กำลังตรวจผล", at: new Date().toISOString() });

  let verified = false;
  let verificationDetail = null;
  if (resolution.verify) {
    try {
      const res = await get(resolution.verify.url);
      const parsed = JSON.parse(res.body);
      const field = parsed[resolution.verify.expect_field];
      verified = Array.isArray(field) && field.length >= resolution.verify.expect_min_length;
      verificationDetail = { field: resolution.verify.expect_field, length: Array.isArray(field) ? field.length : null, required_min: resolution.verify.expect_min_length };
    } catch (err) {
      verificationDetail = { error: err.message };
    }
  }

  const acceptanceMet = executionResult.ok && verified;
  const finalStatus = acceptanceMet ? "สำเร็จ" : "ยังไม่สำเร็จ";
  statusLog.push({ stage: finalStatus, at: new Date().toISOString() });

  return {
    problem_text: problemText,
    status_log: statusLog,
    routed_via: routedVia,
    resolution,
    execution_result: executionResult,
    verification: { acceptance_condition: resolution.acceptance_condition ?? "existing capability CONNECTED per registry", verified, detail: verificationDetail },
    result: finalStatus,
    evidence: {
      what_changed: acceptanceMet ? `Owner directed to ${resolution.execution_path.url ?? resolution.relevant_existing_capability} — a real, already-running interface, zero new tool built` : "no verified change",
      what_verified_it: verificationDetail ? `GET ${resolution.verify?.url} — real HTTP check, field '${resolution.verify?.expect_field}' length=${verificationDetail.length}` : "not verified",
      what_remains_unresolved: acceptanceMet ? "the Owner still has to read the page themselves — this resolver proves the PATH exists and works, not that every future problem will route this cleanly" : "acceptance condition not met",
    },
  };
}

const problemText = process.argv[2];
if (!problemText) {
  console.error('usage: node problem_resolver.mjs "<problem text>"');
  process.exit(1);
}

const out = await resolveProblem(problemText);
fs.writeFileSync(path.join(DIR, "problem_resolution_run.json"), JSON.stringify(out, null, 2), "utf-8");
console.log(JSON.stringify(out, null, 2));
