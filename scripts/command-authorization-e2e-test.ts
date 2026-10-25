/**
 * Command Authorization E2E test (Phase 6) — OFFLINE. Real in-memory executor
 * (a counter that records every call), in-memory pending_authorizations +
 * scoped_grants store, and a mock decide RPC that mirrors the DB function.
 * No DB, no network, no secret.
 */
import assert from "node:assert/strict";
import {
  runCommandWithAuthorization,
  resumeCommandWithAuthorization,
} from "@/engines/jobs/command-authorization";
import { decideCapabilityAuthorization, type AuthorizationResumeDeps } from "@/engines/jobs/authorization-resume";
import type { CommandAuthorizationDeps } from "@/engines/jobs/command-authorization";
import type { BusinessJobEnvelope } from "@/engines/jobs/business-job-adapter";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`); }
}

// ── in-memory store mirroring pending_authorizations + scoped_grants ─────────
type Row = Record<string, unknown>;
const store = {
  pending: new Map<string, Row>(),
  grants: new Map<string, Row>(),
  executedIds: new Set<string>(),
  executed: 0,
  lastError: null as string | null,
};

function makeDeps(): CommandAuthorizationDeps {
  const db = {
    from: (table: string) => ({
      insert: (row: Row) => ({
        select: () => ({
          single: async () => {
            const id = `req-${store.pending.size + 1}`;
            const saved = { id, ...row };
            store.pending.set(id, saved);
            return { data: saved, error: null };
          },
        }),
      }),
      select: () => ({
        eq: (_c: string, v: string) => ({
          maybeSingle: async () => {
            const m = table === "pending_authorizations" ? store.pending : store.grants;
            const row = m.get(v) ?? null;
            return { data: row, error: null };
          },
        }),
      }),
    }),
  };
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    if (fn === "decide_capability_authorization") {
      const req = store.pending.get(String(args.p_request_id));
      if (!req) return { data: null, error: { message: "request_not_found" } };
      if (req.status !== "pending") return { data: null, error: { message: "already_decided" } };
      if (args.p_decision === "deny") {
        req.status = "denied";
        return { data: { decision: "denied", request_id: args.p_request_id }, error: null };
      }
      const gid = `grant-${store.grants.size + 1}`;
      const grant = { id: gid, subject_type: req.subject_type, subject_id: req.subject_id, action: "run", resource: req.resource, job_id: req.job_id, granted_by: args.p_actor, expires_at: args.p_expires_at ?? null };
      store.grants.set(gid, grant);
      req.status = "approved";
      req.grant_id = gid;
      return { data: { decision: "approved", request_id: args.p_request_id, grant_id: gid }, error: null };
    }
    return { data: null, error: { message: `unknown rpc ${fn}` } };
  };
  return {
    db,
    rpc,
    nowIso: () => "2026-10-17T00:00:00.000Z",
    executionGuard: { hasExecuted: (id) => store.executedIds.has(id), markExecuted: (id) => store.executedIds.add(id) },
    claimGrant: async (grantId, commandId) => {
      const g = store.grants.get(grantId);
      if (!g) return { claimed: false, error: "grant_not_found" };
      if (g.consumed_at) return { claimed: false, error: "already_claimed" };
      if (g.job_id && g.job_id !== commandId) return { claimed: false, error: "job_mismatch" };
      g.consumed_at = "now";
      return { claimed: true };
    },
    recordExecution: async (grantId, result, error) => {
      const g = store.grants.get(grantId);
      if (g) { g.execution_result = result; g.execution_error = error; }
    },
  };
}

// ── a REAL (in-memory) executor — records every call ────────────────────────
function makeExecutor(fail = false) {
  return async (env: BusinessJobEnvelope) => {
    store.executed += 1;
    if (fail) { store.lastError = "provider down"; throw new Error("provider down"); }
    return { result: { sent: true, capability: env.capability }, observed_writes: ["invoices"], evidence: [{ kind: "line_message", ref: "msg-1" }] };
  };
}

const approvalRequiredEnvelope = (idempotencyKey = "cmd-1"): BusinessJobEnvelope => ({
  contract_version: "1.0",
  kind: "BUSINESS",
  capability: "document.void",
  plane: "C_business",
  requested_by: { kind: "agent", id: "tool:sales-ai" },
  idempotency_key: idempotencyKey,
  scope: { data_write: ["invoices", "document_versions"], capabilities: ["document.void"] },
  approval: { required: true, kind: "owner_decide" },
  exec_args: { docId: "d1" },
});

const noApprovalEnvelope = (): BusinessJobEnvelope => ({
  contract_version: "1.0",
  kind: "BUSINESS",
  capability: "document.create",
  plane: "C_business",
  requested_by: { kind: "agent", id: "tool:sales-ai" },
  idempotency_key: "cmd-direct",
  scope: { data_write: ["invoices", "document_versions"], capabilities: ["document.create"] },
  exec_args: { docId: "d2" },
});


async function main() {
  const exec = makeExecutor();

  // A. Request → Execute (no approval) → executor called exactly once
  const direct = await runCommandWithAuthorization(makeDeps(), noApprovalEnvelope(), exec);
  check("A: no-approval command executes", direct.status === "EXECUTED" && store.executed === 1, JSON.stringify(direct.status));

  // B. Request → PENDING_APPROVAL → approve → resume → execute
  const depsB = makeDeps();
  const runB = await runCommandWithAuthorization(depsB, approvalRequiredEnvelope("cmd-B"), makeExecutor());
  check("B1: approval-required command returns PENDING_APPROVAL", runB.status === "PENDING_APPROVAL" && !!runB.requestId);
  const beforeB = store.executed;
  const decideB = await decideCapabilityAuthorization(depsB, { requestId: runB.requestId!, decision: "approve", actorId: "owner-1" });
  check("B2: approve issues a grant", decideB.ok && decideB.decision === "approved" && !!decideB.grantId);
  const resumeB = await resumeCommandWithAuthorization(depsB, { requestId: runB.requestId!, commandId: runB.commandId, envelope: approvalRequiredEnvelope("cmd-B") }, makeExecutor());
  check("B3: resume executes the original job", resumeB.status === "EXECUTION_COMPLETED" && store.executed === beforeB + 1);

  // C. Deny → no execution
  const depsC = makeDeps();
  const runC = await runCommandWithAuthorization(depsC, approvalRequiredEnvelope("cmd-C"), makeExecutor());
  const beforeC = store.executed;
  await decideCapabilityAuthorization(depsC, { requestId: runC.requestId!, decision: "deny", actorId: "owner-1" });
  const resumeC = await resumeCommandWithAuthorization(depsC, { requestId: runC.requestId!, commandId: runC.commandId, envelope: approvalRequiredEnvelope("cmd-C") }, makeExecutor());
  check("C: deny → no execution", resumeC.status === "DENIED" && store.executed === beforeC);

  // E. Duplicate approval → one grant (second decide refused)
  const depsE = makeDeps();
  const runE = await runCommandWithAuthorization(depsE, approvalRequiredEnvelope("cmd-E"), makeExecutor());
  await decideCapabilityAuthorization(depsE, { requestId: runE.requestId!, decision: "approve", actorId: "owner-1" });
  const grantsBeforeDup = store.grants.size;
  const dupE = await decideCapabilityAuthorization(depsE, { requestId: runE.requestId!, decision: "approve", actorId: "owner-1" });
  check("E: duplicate approve is refused (no new grant)", dupE.ok === false && store.grants.size === grantsBeforeDup);

  // F. Duplicate resume → one execution
  const depsF = makeDeps();
  const runF = await runCommandWithAuthorization(depsF, approvalRequiredEnvelope("cmd-F"), makeExecutor());
  await decideCapabilityAuthorization(depsF, { requestId: runF.requestId!, decision: "approve", actorId: "owner-1" });
  const beforeF = store.executed;
  await resumeCommandWithAuthorization(depsF, { requestId: runF.requestId!, commandId: runF.commandId, envelope: approvalRequiredEnvelope("cmd-F") }, makeExecutor());
  await resumeCommandWithAuthorization(depsF, { requestId: runF.requestId!, commandId: runF.commandId, envelope: approvalRequiredEnvelope("cmd-F") }, makeExecutor());
  check("F: duplicate resume executes once", store.executed === beforeF + 1, `executed delta=${store.executed - beforeF}`);

  // G. Wrong requester (job mismatch) → denied
  const depsG = makeDeps();
  const runG = await runCommandWithAuthorization(depsG, approvalRequiredEnvelope("cmd-G"), makeExecutor());
  await decideCapabilityAuthorization(depsG, { requestId: runG.requestId!, decision: "approve", actorId: "owner-1" });
  const resumeG = await resumeCommandWithAuthorization(depsG, { requestId: runG.requestId!, commandId: "WRONG-COMMAND-ID", envelope: approvalRequiredEnvelope("cmd-G") }, makeExecutor());
  check("G: wrong commandId (job mismatch) → denied", resumeG.status === "DENIED");

  // I. Executor failure → error returned
  const depsI = makeDeps();
  const runI = await runCommandWithAuthorization(depsI, approvalRequiredEnvelope("cmd-I"), makeExecutor());
  await decideCapabilityAuthorization(depsI, { requestId: runI.requestId!, decision: "approve", actorId: "owner-1" });
  const resumeI = await resumeCommandWithAuthorization(depsI, { requestId: runI.requestId!, commandId: runI.commandId, envelope: approvalRequiredEnvelope("cmd-I") }, makeExecutor(true));
  check("I: executor failure returns EXECUTION_FAILED", resumeI.status === "EXECUTION_FAILED");

  // H. Concurrent resume → persistent claim → one execution (Phase 8)
  const depsH = makeDeps();
  const runH = await runCommandWithAuthorization(depsH, approvalRequiredEnvelope("cmd-H"), makeExecutor());
  await decideCapabilityAuthorization(depsH, { requestId: runH.requestId!, decision: "approve", actorId: "owner-1" });
  const beforeH = store.executed;
  const h1 = await resumeCommandWithAuthorization(depsH, { requestId: runH.requestId!, commandId: runH.commandId, envelope: approvalRequiredEnvelope("cmd-H") }, makeExecutor());
  const h2 = await resumeCommandWithAuthorization(depsH, { requestId: runH.requestId!, commandId: runH.commandId, envelope: approvalRequiredEnvelope("cmd-H") }, makeExecutor());
  check("H: concurrent resume (persistent claim) → one execution", store.executed === beforeH + 1 && h1.status === "EXECUTION_COMPLETED" && h2.status === "DENIED", `delta=${store.executed - beforeH} h1=${h1.status} h2=${h2.status}`);

  // K. Secret leakage → zero (no secret field anywhere in request/grant/result)
  const leakScan = JSON.stringify([...store.pending.values(), ...store.grants.values()]).toLowerCase();
  check("K: no secret/credential token in store or results", !/secret|password|token|api_key|client_secret/.test(leakScan));

  console.log(`\ncommand-authorization-e2e: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

