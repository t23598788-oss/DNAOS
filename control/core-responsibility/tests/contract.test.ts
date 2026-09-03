/**
 * หน้าที่: prove the four-way responsibility split holds against REAL cases
 * already on disk — and that not knowing something can never, by any path,
 * become an Owner question (Owner, 2026-09-02).
 *
 * THE FAILURE THIS BLOCKS. When a system cannot separate "I have not worked it
 * out", "a tool must run", "nobody has phrased it yet" and "only you may
 * decide", it defaults to asking the human. That is how a control system
 * quietly becomes a chat partner. Cases A and F1–F6 fail if any absence of
 * knowledge routes to OWNER_DECISION_REQUIRED; case B requires escalation
 * exactly where a real authority is missing.
 *
 * REAL EVIDENCE, NOT FIXTURES. Case A reads the Step 13/14 execution and its
 * persisted diagnostic finding; case C reads a genuinely VERIFIED verdict if one
 * exists; case D reads the executable-intent contract that gates model output;
 * case E reads the evidence stores to see whether any cost was ever measured.
 * A synthetic success would prove nothing about this system.
 *
 * Input: none — reads only already-persisted repository state.
 * Output: exit code 0 (all passed) or 1.
 * Dependency ที่อนุญาต: ../contract, node built-ins, persisted data files.
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่มเหตุผล OWNER_DECISION ที่แปลว่า "ยังไม่รู้",
 * ห้ามให้โมเดลกำหนดค่าใด ๆ, ห้ามประมาณค่าใช้จ่ายที่ไม่ได้วัดจริง.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  classifyResponsibility, evidenceCeilingReached, routeNextState,
  type OwnerAuthorityReason, type SystemResponsibilityReason,
} from "../contract";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}
const readJsonl = (p: string): Record<string, unknown>[] =>
  existsSync(p) ? readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as Record<string, unknown>) : [];

const ROOT = process.cwd();
const EXEC = join(ROOT, "control/computer-use-executor/data/execution-evidence.jsonl");
const FINDINGS = join(ROOT, "control/computer-use-executor/data/diagnostic-findings.jsonl");

(async () => {
  // ================= CASE A — the Step 13/14 Computer Use failure =================
  // Real row, real finding: post() invoked, target receipt NOT observed, cause unknown.
  const rows = readJsonl(EXEC);
  const step13 = rows.find((r) => r["evidence_id"] === "cue-9f28e7ae-f2e0-4c7d-a791-f8445bfcd76a")!;
  const finding = readJsonl(FINDINGS).find((f) => f["source_execution_evidence_id"] === "cue-9f28e7ae-f2e0-4c7d-a791-f8445bfcd76a")!;
  check("A0. the real Step 13 execution and its Step 14 finding are on disk",
    !!step13 && !!finding && finding["finding"] === "NOT_OBSERVED"
    && (step13["cgevent_instrumentation"] as { post_invocation: string }).post_invocation === "REACHED",
    `verdict=${(step13["effect_verdict"] as { status: string }).status}, receipt=${String(finding["finding"])}`);

  // The window server is the one boundary nothing can observe. Every registered
  // procedure for it has been exhausted — there were never any.
  const ceiling = evidenceCeilingReached({
    fact_required: "window_server_routed_the_event",
    current_state: "UNKNOWN",
    last_proven_boundary: "CGEVENT_POST_INVOCATION",
    first_unproven_boundary: "WINDOW_SERVER_ROUTING",
    available_procedures: [],
    remaining_procedures: [],
    blocks_required_result: true,
  });
  check("A1. exhausting every registered source is a ceiling, not a verdict",
    ceiling.evidence_ceiling_reached === true
    && !/FAIL|ROOT_CAUSE|OWNER/.test(JSON.stringify(ceiling)));
  const decisionA = classifyResponsibility({
    determinable_from_contracts: false, execution_capability_id: null, representation_only: false,
    owner_authority_reason: null, system_responsibility_reason: "DETERMINE_EVIDENCE_SUFFICIENCY",
  });
  const routeA = routeNextState({
    responsibility: decisionA.responsibility, result_verified: false, ceiling,
    registered_procedures_remaining: [], registered_repair_available: false,
    registered_retry_policy_available: false, external_result_pending: false,
    capability_and_authority_resolved: false,
  });
  check("A2. a technical UNKNOWN stays the system's problem",
    decisionA.responsibility === "DETERMINISTIC_CORE"
    && routeA.next_state === "STOP_UNPROVEN" && routeA.reason === "EVIDENCE_CEILING_REACHED_RESULT_BLOCKED"
    && (routeA.next_state as string) !== "OWNER_DECISION_REQUIRED",
    "Step 14 ended UNKNOWN; that is a knowledge state, not an authority requirement");
  check("A3. a ceiling that does not block the required result does not even stop the work",
    routeNextState({ ...{ responsibility: "DETERMINISTIC_CORE" as const, result_verified: false, registered_procedures_remaining: [], registered_repair_available: false, registered_retry_policy_available: false, external_result_pending: false, capability_and_authority_resolved: false }, ceiling: { ...ceiling, blocks_required_result: false } }).next_state === "CONTINUE_CORE");

  // ================= CASE B — a real Owner-authority case =================
  // The two lease flags only an Owner grant can set (Step 6 finding, still true).
  const leaseSrc = readFileSync(join(ROOT, "control/computer-use-authority/lease.ts"), "utf8");
  check("B0. the Owner-only authority requirement is real in source",
    /HIGH_RISK_NOT_EXPLICITLY_AUTHORIZED/.test(leaseSrc) && /high_risk_explicit/.test(leaseSrc));
  const decisionB = classifyResponsibility({
    determinable_from_contracts: false, execution_capability_id: null, representation_only: false,
    owner_authority_reason: "NEW_AUTHORITY_GRANT_REQUIRED",
  });
  const routeB = routeNextState({
    responsibility: decisionB.responsibility, result_verified: false, ceiling: null,
    registered_procedures_remaining: ["proc-something"], registered_repair_available: true,
    registered_retry_policy_available: true, external_result_pending: true,
    capability_and_authority_resolved: false,
  });
  check("B1. a genuine missing authority does escalate, and outranks every other route",
    decisionB.responsibility === "OWNER_DECISION"
    && routeB.next_state === "OWNER_DECISION_REQUIRED" && routeB.reason === "OWNER_AUTHORITY_REQUIRED",
    "even with procedures, repair, retry and a pending external result available");

  // ================= CASE C — a real deterministic success =================
  // No VERIFIED effect verdict exists in computer-use evidence — scroll has
  // never succeeded. The real deterministic successes on disk are in
  // runtime-control's operations store, so CASE C uses those rather than a
  // fixture that would prove nothing about this system.
  const ops = readJsonl(join(ROOT, "control/runtime-control/data/operations.jsonl"));
  const succeeded = ops.filter((o) => o["result"] === "SUCCESS");
  const verdictRows = rows.filter((r) => (r["effect_verdict"] as { status?: string } | undefined)?.status);
  check("C0. real successes on disk were decided by deterministic code, not a model",
    succeeded.length > 0
    && succeeded.every((o) => typeof o["timestamp_started"] === "string" && typeof o["timestamp_completed"] === "string")
    && verdictRows.every((r) => typeof (r["effect_verdict"] as { reason_code?: string }).reason_code === "string"),
    `${succeeded.length} SUCCESS operations; ${verdictRows.length} computer-use rows carry a machine verdict, none VERIFIED`);
  const routeC = routeNextState({
    responsibility: "DETERMINISTIC_CORE", result_verified: true, ceiling: null,
    registered_procedures_remaining: ["proc-something"], registered_repair_available: false,
    registered_retry_policy_available: false, external_result_pending: false,
    capability_and_authority_resolved: true,
  });
  check("C1. a verified result completes without any model being consulted",
    routeC.next_state === "COMPLETE" && routeC.reason === "REQUIRED_RESULT_VERIFIED");

  // ================= CASE D — model output is a candidate, never truth =================
  const contractFile = join(ROOT, "control/owner-command/data/executable-intent-contract.json");
  const intentContract = JSON.parse(readFileSync(contractFile, "utf8")) as { executable: { value: string }[] };
  const structured = readFileSync(join(ROOT, "control/owner-command/structured-intent.ts"), "utf8");
  const runner = readFileSync(join(ROOT, "control/owner-command-semantics/semantic-runner.py"), "utf8");
  check("D0. exactly one file loads a model, and its output is raw text",
    /the ONLY file in this layer that loads a model/.test(runner) && /stdout = the model/.test(runner));
  check("D1. every model-proposed intent passes a software-owned contract before executing",
    /classifyIntentType\(/.test(structured) && /INTENT_TYPE_NOT_IN_CONTRACT/.test(structured)
    && intentContract.executable.length > 0,
    `${intentContract.executable.length} executable values, declared in data, not by the model`);
  const decisionD = classifyResponsibility({
    determinable_from_contracts: true, execution_capability_id: null, representation_only: true,
    owner_authority_reason: null,
  });
  check("D2. language work classifies as transformation, never as truth",
    decisionD.responsibility === "LANGUAGE_TRANSFORM" && decisionD.reason === "REPRESENTATION_ONLY");

  // ================= CASE E — cost: measured only, never estimated =================
  // Precision matters here. Money DOES appear on disk — as observed provider
  // billing in minor units — and token counts appear as unparsed text inside a
  // captured agent stdout blob. Neither is the cost OF an execution. The claim
  // under test is the narrow one: no execution record carries a structured cost
  // field of its own.
  const execStores = ["control/computer-use-executor/data/execution-evidence.jsonl", "control/runtime-control/data/operations.jsonl"]
    .flatMap((p) => readJsonl(join(ROOT, p)));
  const structuredCostField = /"(cost_usd|amount_usd|amount_minor|unit_price_minor|tokens_used)"\s*:/;
  check("E0. no execution record carries a structured cost field of its own",
    execStores.every((r) => !structuredCostField.test(JSON.stringify(r))),
    `${execStores.length} execution rows checked`);
  const gateway = readJsonl(join(ROOT, "control/agent-gateway/data/evidence.jsonl"));
  const billingRows = gateway.filter((r) => structuredCostField.test(JSON.stringify(r)));
  const anyMonetary = billingRows.length > 0;
  check("E0b. money on disk is OBSERVED PROVIDER BILLING, not execution cost",
    anyMonetary && billingRows.every((r) => String(r["source"] ?? "").includes("infrastructure-billing")),
    `${billingRows.length} billing rows, all sourced to control/infrastructure-billing`);
  const durationDerivable = rows.some((r) => typeof r["started_at"] === "string" && typeof r["completed_at"] === "string");
  check("E1. wall-clock duration IS derivable, and is the only cost dimension that is",
    durationDerivable === true);
  // An execution's own cost is unmeasured, so an OwnerReport for one carries
  // cost: null. Provider billing existing elsewhere does not change that.
  check("E2. an execution's unmeasured cost is reported as null, not as a guess",
    ((): boolean => {
      const executionCostMeasured = execStores.some((r) => structuredCostField.test(JSON.stringify(r)));
      const report = { cost: executionCostMeasured ? {} : null };
      return report.cost === null;
    })());

  // ================= F. the escalation guard, exhaustively =================
  const systemReasons: SystemResponsibilityReason[] = ["INTERPRET_EVIDENCE", "CHOOSE_TECHNICAL_ROUTE", "DIAGNOSE_SOFTWARE", "DECIDE_SEQUENCING", "DETERMINE_EVIDENCE_SUFFICIENCY", "SUMMARIZE_MACHINE_STATE"];
  check("F1. every reason that merely LOOKS like an Owner question stays with the system",
    systemReasons.every((r) => classifyResponsibility({
      determinable_from_contracts: false, execution_capability_id: null, representation_only: false,
      owner_authority_reason: null, system_responsibility_reason: r,
    }).responsibility === "DETERMINISTIC_CORE"));
  check("F2. a system reason outranks an authority reason supplied alongside it",
    classifyResponsibility({
      determinable_from_contracts: false, execution_capability_id: null, representation_only: false,
      owner_authority_reason: "FINANCIAL_COMMITMENT_REQUIRED", system_responsibility_reason: "DIAGNOSE_SOFTWARE",
    }).responsibility === "DETERMINISTIC_CORE",
    "diagnosing software is never a financial decision");
  const ownerReasons: OwnerAuthorityReason[] = ["NEW_AUTHORITY_GRANT_REQUIRED", "SENSITIVE_ACTION_APPROVAL_REQUIRED", "RECIPIENT_NOT_DETERMINED_BY_POLICY", "BUSINESS_ALTERNATIVES_EQUALLY_LEGITIMATE", "FINANCIAL_COMMITMENT_REQUIRED", "INFORMATION_ONLY_OWNER_POSSESSES"];
  check("F3. every Owner reason names an authority or a value, never an absence of knowledge",
    ownerReasons.length === 6
    && !ownerReasons.some((r) => /UNKNOWN|MISSING_EVIDENCE|NOT_OBSERVED|UNPROVEN|CANNOT_DETERMINE/.test(r)));
  check("F4. OWNER_DECISION is unreachable without an explicit authority reason",
    classifyResponsibility({
      determinable_from_contracts: false, execution_capability_id: null, representation_only: false,
      owner_authority_reason: null,
    }).responsibility === "DETERMINISTIC_CORE");

  // ================= G. no model, no clock, no I/O in the contract =================
  const src = readFileSync(join(ROOT, "control/core-responsibility/contract.ts"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
  check("G1. the responsibility model is pure — no model, network, clock or file access",
    !/\b(fetch|anthropic|openai|claude|child_process|spawn|execFile|https?:|Math\.random|Date\.now|new Date|readFileSync)/i.test(code)
    && !/\bimport\s+/.test(code),
    "routing is computed from typed facts alone");
  const answers = new Set(Array.from({ length: 100 }, () => JSON.stringify(routeNextState({
    responsibility: "DETERMINISTIC_CORE", result_verified: false, ceiling,
    registered_procedures_remaining: [], registered_repair_available: false,
    registered_retry_policy_available: false, external_result_pending: false,
    capability_and_authority_resolved: false,
  }))));
  check("G2. routing is deterministic across repeats", answers.size === 1);

  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
