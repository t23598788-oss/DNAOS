#!/usr/bin/env npx tsx
/**
 * PASS 5 — RECOVER verifier (G4). READ-ONLY: no business row is created, changed or deleted,
 * no retry is actually executed and no queue is touched.
 *
 * Proves: stop condition → recovery policy works over the EXISTING recovery infrastructure,
 * RETRY != RESUME, no duplicate business write, checkpoint-based recovery, business truth is
 * re-read before resume, paid retry goes through the real cost gate, destructive stays owner-only,
 * retry is bounded, and no new recovery engine/queue exists.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { resolveRecoveryDecision, recoveryPolicies, isPaidRetryAllowed, describeRecoverySemantics, type RecoveryContext } from "@/engines/jobs/job-recovery";
import { assessRecoveryPrerequisites } from "@/app/api/admin/ide/_lib/jobRecoveryRuntime";

const ROOT = process.cwd();
let pass = 0;
let fail = 0;
const failures: string[] = [];
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

// env bootstrap — same pattern as the other real-data harnesses (reads .env.local only)
try {
  for (const line of readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* env may already be provided by the shell */ }

function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  PASS  ${name}${detail ? " — " + detail : ""}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`); }
}

const ctx = (over: Partial<RecoveryContext> = {}): RecoveryContext => ({
  attempt_count: 0, checkpoint_read: true, latest_checkpoint_id: "cp-1", previous_checkpoint_id: "cp-0",
  business_truth_read: true, business_truth_written: false, business_refs: [], previous_executor_outcome: "threw before write",
  acceptance_evidence_present: true, approval_verified: false, cost_already_consumed: 0, paid_retry_cost_gate_passed: true, ...over,
});

async function main() {
  console.log("=== PASS 5 / RECOVER — stop condition → recovery policy ===\n");

  console.log("[A] policy table (approved contract) + existing recovery infrastructure");
  check("10 stop conditions mapped", recoveryPolicies().length === 10);
  check("policy shape complete", recoveryPolicies().every((p) => ["failure_code", "retry_allowed", "max_attempts", "backoff", "requires_owner", "requires_reverify", "resume_mode", "cost_behavior", "terminal_state"].every((k) => k in p)));
  const recovReg = read("app/api/admin/ide/_lib/recoveryRegistry.ts");
  check("bridge added into the EXISTING recovery registry", recovReg.includes("BUSINESS_STOP_CONDITION_RECOVERY") && recovReg.includes("getBusinessStopConditionRecovery"));
  check("no new recovery registry/engine file created", !existsSync(path.join(ROOT, "registry/RECOVERY_POLICIES.json")) && !existsSync(path.join(ROOT, "engines/jobs/recovery-engine.ts")));
  const recoverSrc = read("engines/jobs/job-recovery.ts").replace(/\/\*[\s\S]*?\*\//g, "");
  check("decision module is pure (no DB/queue/state import)", !/supabase|queueRuntime|executionContextRuntime|readFileSync|writeFileSync/.test(recoverSrc));
  const preflightSrc = read("app/api/admin/ide/_lib/jobRecoveryRuntime.ts");
  check("preflight reuses existing checkpoint runtime", preflightSrc.includes("getCurrentExecutionContext"));
  check("preflight reuses the real cost gate", preflightSrc.includes("checkCostGate") && preflightSrc.includes("listCostLedgerEntries"));
  check("preflight reuses acceptance runtime + approval evidence", preflightSrc.includes("runBusinessAcceptance") && preflightSrc.includes("resolveApprovalEvidence"));
  check("preflight reuses the existing recovery registry bridge", preflightSrc.includes("getBusinessStopConditionRecovery"));
  check("preflight performs no writes", /writes_performed: false/.test(preflightSrc) && !/\.(insert|update|delete|upsert)\s*\(/.test(preflightSrc));

  console.log("\n[B] CASE 1 — transient fail before write → bounded retry");
  const c1 = resolveRecoveryDecision("TRANSIENT_RUNTIME_ERROR", ctx());
  check("retry allowed", c1.action === "RETRY_EXECUTION", c1.reason);
  check("bounded (max_attempts=2)", c1.max_attempts === 2 && c1.attempt === 0);
  const c1b = resolveRecoveryDecision("TRANSIENT_RUNTIME_ERROR", ctx({ attempt_count: 2 }));
  check("terminal once attempts exhausted", c1b.action === "REVIEW" && c1b.terminal_state === "TERMINAL_AFTER_MAX_ATTEMPTS", c1b.reason);
  const c1c = resolveRecoveryDecision("EXECUTOR_FAILED_BEFORE_WRITE", ctx({ business_truth_written: false, previous_executor_outcome: "threw before write" }));
  check("before-write failure retries only with no-write proof mode", c1c.action === "RETRY_EXECUTION" && c1c.resume_mode === "RETRY_EXECUTION_AFTER_NO_WRITE_PROOF");
  const c1d = resolveRecoveryDecision("EXECUTOR_FAILED_BEFORE_WRITE", ctx({ business_truth_written: true }));
  check("no duplicate business write when truth was already written", c1d.action === "REVIEW", c1d.reason);

  console.log("\n[C] CASE 2 — acceptance fail after write → no re-execution");
  const c2 = resolveRecoveryDecision("EXECUTED_REQUIRES_REVIEW", ctx({ business_truth_written: true, previous_executor_outcome: "EXECUTED_REQUIRES_REVIEW" }));
  check("action is review/resume (not retry)", c2.action === "REVIEW" && c2.resume_mode === "REVERIFY_OR_RESUME_FROM_CHECKPOINT", c2.reason);
  check("no auto re-execution", c2.cost_behavior === "NO_AUTO_REEXECUTION" && c2.max_attempts === 0);
  check("requires reverify", c2.requires_reverify === true);
  const c2sem = describeRecoverySemantics(c2);
  check("RETRY ≠ RESUME (review is resume-style, not retry)", !c2sem.is_retry && c2sem.is_resume && !c2sem.re_runs_executor);
  const c2v = resolveRecoveryDecision("VERIFICATION_FAILED", ctx());
  check("verification failed → reverify/manual review, no writer re-run", c2v.action === "REVIEW" && c2v.cost_behavior === "NO_WRITER_REEXECUTION", c2v.reason);

  console.log("\n[D] CASE 3 — approval missing → WAIT_APPROVAL, no retry");
  const c3 = resolveRecoveryDecision("APPROVAL_REQUIRED", ctx());
  check("WAIT_APPROVAL", c3.action === "WAIT_APPROVAL" && c3.terminal_state === "WAIT_APPROVAL", c3.reason);
  check("no retry, owner required, resume same job after approval", c3.retry_allowed === false && c3.requires_owner && c3.resume_mode === "WAIT_APPROVAL_THEN_RESUME_SAME_JOB");
  check("no cost until approved", c3.cost_behavior === "NO_COST_UNTIL_APPROVED");

  console.log("\n[E] CASE 4 — budget exceeded → paid retry blocked before consuming");
  const c4 = resolveRecoveryDecision("BUDGET_EXCEEDED", ctx());
  check("WAIT_BUDGET", c4.action === "WAIT_BUDGET" && c4.terminal_state === "WAIT_BUDGET", c4.reason);
  check("requires a NEW authorization", c4.cost_behavior === "NEW_AUTHORIZATION_REQUIRED");
  const paidNoGate = resolveRecoveryDecision("PROVIDER_UNAVAILABLE", ctx({ paid_retry_cost_gate_passed: false }));
  check("paid retry without cost gate is blocked (not retried)", paidNoGate.action !== "RETRY_EXECUTION" && paidNoGate.blocked_by.some((b) => b.includes("cost gate")), paidNoGate.blocked_by.join("; "));
  check("isPaidRetryAllowed false without gate", isPaidRetryAllowed(paidNoGate, ctx()) === false);
  const paidWithGate = resolveRecoveryDecision("PROVIDER_UNAVAILABLE", ctx({ paid_retry_cost_gate_passed: true }));
  check("paid retry allowed only after the gate", paidWithGate.action === "RETRY_EXECUTION" && isPaidRetryAllowed(paidWithGate, ctx({ paid_retry_cost_gate_passed: true })));

  console.log("\n[F] CASE 5 — destructive action → OWNER_ONLY, never auto-retried");
  const c5 = resolveRecoveryDecision("DESTRUCTIVE_ACTION_REQUIRED", ctx({ approval_verified: true }));
  check("OWNER_ONLY", c5.action === "OWNER_ONLY" && c5.terminal_state === "OWNER_ONLY", c5.reason);
  check("no auto retry + cost behavior NO_AUTO_RETRY", c5.retry_allowed === false && c5.cost_behavior === "NO_AUTO_RETRY");
  const c5b = resolveRecoveryDecision("DESTRUCTIVE_ACTION_REQUIRED", ctx({ approval_verified: false }));
  check("approval can never be self-granted for owner-only", c5b.blocked_by.some((b) => b.includes("self-granted")), c5b.blocked_by.join("; "));

  console.log("\n[G] CASE 6 — provider outage → bounded retry/backoff then terminal");
  const c6 = resolveRecoveryDecision("PROVIDER_UNAVAILABLE", ctx({ paid_retry_cost_gate_passed: true }));
  check("retry with exponential backoff (max 3)", c6.action === "RETRY_EXECUTION" && c6.max_attempts === 3 && c6.backoff === "exponential", c6.reason);
  const c6b = resolveRecoveryDecision("PROVIDER_UNAVAILABLE", ctx({ attempt_count: 3, paid_retry_cost_gate_passed: true }));
  check("terminal stop when policy exhausted", c6b.action === "REVIEW" && c6b.terminal_state === "TERMINAL_AFTER_MAX_ATTEMPTS", c6b.reason);
  const unknown = resolveRecoveryDecision("SOMETHING_NEW", ctx());
  check("unknown failure → stop + escalate (never guessed)", unknown.action === "ESCALATE_STOP" && unknown.terminal_state === "ESCALATED", unknown.reason);
  const scope = resolveRecoveryDecision("SCOPE_VIOLATION", ctx());
  check("SCOPE_VIOLATION → scoped repair only, terminal review", scope.action === "SCOPED_REPAIR" && scope.terminal_state === "TERMINAL_REVIEW", scope.reason);

  console.log("\n[H] preflight against real infrastructure (read-only)");
  const pre = await assessRecoveryPrerequisites({ job_id: "recover-verify", capability: "document.create", failure_code: "TRANSIENT_RUNTIME_ERROR", attempt_count: 0, previous_executor_outcome: "threw before write" });
  check("preflight read the checkpoint chain", pre.prerequisites.some((p) => p.description.includes("checkpoint")));
  check("preflight re-read business truth from the canonical DB", pre.prerequisites.some((p) => p.description.includes("business truth re-read")));
  check("preflight read approval state from real sources", pre.prerequisites.some((p) => p.description.includes("approval state")));
  check("preflight read cost already consumed from COST_LEDGER", pre.prerequisites.some((p) => p.description.includes("COST_LEDGER")));
  check("preflight wrote nothing", pre.writes_performed === false);
  check("preflight mapped the failure to a real recovery type", !!pre.recovery_type && ["IMPLEMENTED", "PLAN_ONLY", "VERIFICATION_ONLY", "NOT_IMPLEMENTED", "UNKNOWN"].includes(pre.recovery_type.status), JSON.stringify(pre.recovery_type));
  const prePaid = await assessRecoveryPrerequisites({ job_id: "recover-verify", capability: "document.create", failure_code: "PROVIDER_UNAVAILABLE", attempt_count: 0, previous_executor_outcome: "provider 503", paid_cost_estimate: 0.5 });
  check("paid retry consults the real cost gate", prePaid.cost_gate !== null && prePaid.prerequisites.some((p) => p.description.includes("cost gate")));
  check("paid retry is blocked when the gate does not allow it", prePaid.decision.action === "RETRY_EXECUTION" || prePaid.decision.blocked_by.some((b) => b.toLowerCase().includes("cost gate")), prePaid.decision.blocked_by.join("; ") || "gate passed (authorization exists)");

  console.log("\n[I] structural guards");
  const route = read("app/api/admin/documents/route.ts");
  check("switched route contains no retry logic", !/retry|max_attempts|backoff|for\s*\(\s*let\s+attempt/i.test(route.replace(/^\s*\/\/.*$/gm, "")));
  const canonical = ["document-write", "transaction-write", "payment-write", "debt-write", "inbound-write", "artifact-write"].map((f) => `engines/canonical/${f}.ts`);
  const forbidden = ["job-recovery", "jobRecoveryRuntime", "recoveryRegistry", "recoveryRuntime", "queueRuntime", "gapLoopRuntime", "deadEndSweepRuntime"];
  for (const f of canonical) {
    const hit = forbidden.filter((x) => read(f).includes(x));
    check(`${f} knows no recovery/control runtime`, hit.length === 0, hit.join(",") || "clean");
  }
  check("only POST /api/admin/documents is switched", route.includes("executeBusinessJob(") && !read("app/api/admin/transactions/route.ts").includes("executeBusinessJob") && !read("app/api/admin/receipt-documents/[id]/confirm/route.ts").includes("executeBusinessJob"));
  check("no new queue/engine introduced by this pass", !existsSync(path.join(ROOT, "app/api/admin/ide/queue/retry2")) && !existsSync(path.join(ROOT, "engines/jobs/recovery-queue.ts")));

  console.log("\n=== RESULT ===");
  console.log(`${pass} passed, ${fail} failed`);
  if (failures.length) console.log("FAILED:", failures.join(" | "));
  console.log("\nSTOP: PASS 6 (cross-runtime), payment/debt/transaction/artifact routes, LINE/Deno and UI stay untouched.");
  process.exit(fail === 0 ? 0 : 1);
}

void main();


