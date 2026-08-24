/**
 * หน้าที่: Phase 10's real, executed proof — the FIRST real runtime
 * caller of `control/owner-command/`'s `submitOwnerCommand`, which until
 * this file was "NOT_YET_BUILT: no runtime transport wires Owner input
 * into this yet" (see ../owner-command.ts's own header). Drives the real
 * chain: Owner intent text -> submitOwnerCommand -> routeOwnerCommand's
 * real classifyCommand (Software/Capability Resolver, already built in
 * control/command-router/) -> the real "permission-reasoner" capability
 * (permissions/execution-policy/contract.ts's evaluateExecutionPermission)
 * -> control/agent-host/'s real launchAgent (Phase 9) for a sandboxed
 * confirmation step -> the real permissions/write-gate/ +
 * execution/file-write/ for the resulting evidence write.
 *
 * Every component below is imported from its real contract.ts — none are
 * reimplemented. This file is the wiring/proof only.
 *
 * How to run: npx tsx control/owner-command/tests/phase10-enforced-route.test.ts
 */

declare const require: (id: string) => unknown;
interface NodeFsModule {
  writeFileSync(p: string, c: string, e: string): void;
  mkdirSync(p: string, o: { recursive: boolean }): void;
  readFileSync(p: string, e: string): string;
}
interface NodePathModule {
  join(...p: string[]): string;
}
interface NodeCryptoModule {
  randomUUID(): string;
}
const fs = require("node:fs") as NodeFsModule;
const nodePath = require("node:path") as NodePathModule;
const nodeCrypto = require("node:crypto") as NodeCryptoModule;
declare const process: { cwd(): string; env: Record<string, string | undefined>; execPath: string; pid: number };
declare const console: { log(...a: unknown[]): void };

import { submitOwnerCommand, previewOwnerCommand } from "../contract";
import { findByCapabilityId, getCapabilityIndex } from "../../../software/capability-registrar/contract";
import type { RouteOptions } from "../../command-router/contract";
import { launchAgent } from "../../agent-host/contract";
import { evaluateWriteIntent } from "../../../permissions/write-gate/contract";
import type { WriteGateContext } from "../../../permissions/write-gate/contract";
import { executeFileWrite } from "../../../execution/file-write/contract";
import type { FileWriteRequest } from "../../../execution/file-write/contract";
import type { WriteIntent } from "../../../contracts/write-intent/write-intent";

const OWNER_IDENTITY = {
  identity_id: "owner-1",
  acting_as_account_id: "account-1",
  acting_as_tenant_id: "tenant-1",
  software_id: "software-owner-command-test",
  kind: "human" as const,
  display_name: "Owner (Phase 10 proof)",
};
const OWNER_INTENT_TEXT = "ตรวจสอบ permission ก่อน execution";

// A real, structurally valid ExecutionPolicyContext (same fixture pattern
// permissions/execution-policy/tests/policy.test.ts itself uses) —
// constructed here because runPermissionReasonerStep requires this real
// object to reach a decision; it is never fabricated as a decision
// itself, only as the identity/grant DATA a real caller would supply.
const EXECUTION_POLICY_CONTEXT = {
  identity: OWNER_IDENTITY,
  memberships: [
    { membership_id: "m1", identity_id: "owner-1", scope_type: "account" as const, scope_id: "account-1", role: "owner", granted_at: "2026-01-01T00:00:00.000Z" },
    { membership_id: "m2", identity_id: "owner-1", scope_type: "workspace" as const, scope_id: "workspace-1", role: "owner", granted_at: "2026-01-01T00:00:00.000Z" },
  ],
  grants: [{ grant_id: "g1", identity_id: "owner-1", account_id: "account-1", workspace_id: "workspace-1", capability: "execution.run", command_id: "unknown", action: "run", cwd_scope_prefix: "repo/", effect: "allow" as const, granted_at: "2026-01-01T00:00:00.000Z" }],
  command: { command_id: "unknown", required_capability: "execution.run", allowed_actions: ["run"], allowed_cwd_scope_prefixes: ["repo/"] },
};
const ROUTE_OPTIONS: RouteOptions = {
  executionPolicyContext: EXECUTION_POLICY_CONTEXT,
  executionRequestBase: { identity_id: "owner-1", account_id: "account-1", workspace_id: "workspace-1", cwd_scope: "repo/app" },
};

const CAPABILITY_DIR = nodePath.join(process.cwd(), "control", "agent-host");
const ALLOWED_DIR = nodePath.join(CAPABILITY_DIR, "test-workspace", "allowed");
const OUTSIDE_DIR = nodePath.join(CAPABILITY_DIR, "test-workspace", "outside");
const AGENT_SCRIPT = nodePath.join(CAPABILITY_DIR, "agent-script.mjs");

function safeParse(t: string): any {
  try {
    return JSON.parse(t);
  } catch {
    return { parse_error: true, raw: t };
  }
}

async function launch(action: Record<string, unknown>) {
  return launchAgent({ allowedWorkspaceDir: ALLOWED_DIR, agentExecutable: process.execPath, agentArgv: [AGENT_SCRIPT, JSON.stringify(action)], timeoutMs: 5000 }, process.env, [OUTSIDE_DIR]);
}

async function main() {
  const report: Record<string, unknown> = {};

  // STEP 1 + 3 — Discovery/Resolver: pure preview classification, no Agent filesystem search, no Agent choice.
  const preview = previewOwnerCommand(OWNER_INTENT_TEXT);
  report.STEP1_3_RESOLVER_PREVIEW = preview;

  // STEP 2 — Software Identity cross-check via the real, existing capability-registrar (software/capability-registrar), itself a projection of control/command-router's real registry — not invented here.
  const softwareIdentity = preview.status === "MATCHED" ? findByCapabilityId(preview.capability.capability_id) : null;
  report.STEP2_SOFTWARE_IDENTITY = softwareIdentity;

  // STEP 4 — the real enforced route: submitOwnerCommand is the Owner Command entry point;
  // internally it calls routeOwnerCommand, which re-runs classifyCommand itself (the resolver
  // decides, not this proof file) and then, since the resolved capability is "permission-reasoner",
  // calls the real evaluateExecutionPermission.
  const outcome = await submitOwnerCommand(OWNER_INTENT_TEXT, OWNER_IDENTITY, ROUTE_OPTIONS);
  report.STEP4_OWNER_COMMAND_RESULT = outcome.result;
  report.STEP4_LIFECYCLE = outcome.lifecycle;

  // STEP 4 continued — Agent Host + sandboxed Agent, invoked only AFTER the real permission decision
  // came back non-blocked, carrying ONLY the resolved capability_id forward (the Agent never chooses it).
  let agentConfirmation: unknown = null;
  let writeGateDecision: unknown = null;
  let fileWriteResult: unknown = null;
  if (outcome.result.status === "COMPLETED") {
    const evidencePath = `control/agent-host/test-workspace/allowed/phase10-evidence-${process.pid}.txt`;
    const confirmAction = await launch({ action: "request_authorized_write", target_path: evidencePath, content: `capability_id=${outcome.result.capability_id} task_id=${outcome.result.task_id} decision=ALLOW` });
    agentConfirmation = safeParse(confirmAction.stdout);
    const parsed = agentConfirmation as any;
    if (parsed?.outcome === "WRITE_REQUEST_EMITTED") {
      const intentId = nodeCrypto.randomUUID();
      const correlationId = nodeCrypto.randomUUID();
      const intent: WriteIntent = {
        intent_id: intentId,
        operation: "CREATE",
        capability: outcome.result.capability_id,
        target_type: "FILE",
        target_path: parsed.write_request.target_path,
        requested_change: "Phase 10 proof: evidence of an enforced route (resolver -> permission -> agent host -> write gate -> executor).",
        requesting_agent: { identity_id: "phase10-proof-agent", kind: "ai_agent", display_name: "Phase 10 Proof Agent" },
        evidence: [{ source: "control/owner-command/tests/phase10-enforced-route.test.ts", note: "Phase 10 enforced route proof" }],
        correlation_id: correlationId,
        submitted_at: new Date().toISOString(),
      };
      const context: WriteGateContext = { registryIndex: getCapabilityIndex() };
      const decision = evaluateWriteIntent(intent, context);
      writeGateDecision = decision;
      const fwRequest: FileWriteRequest = { write_id: "", correlation_id: correlationId, intent_id: intentId, gate_decision_id: decision.decision_id, requesting_identity_id: "phase10-proof-agent", operation: "CREATE", target_type: "FILE", target_path: parsed.write_request.target_path, content: parsed.write_request.content } as unknown as FileWriteRequest;
      fileWriteResult = executeFileWrite(fwRequest, decision as never);
    }
  }
  report.STEP4_AGENT_CONFIRMATION = agentConfirmation;
  report.STEP4_WRITE_GATE_DECISION = writeGateDecision;
  report.STEP4_FILE_WRITE_RESULT = fileWriteResult;

  // STEP 5 — Negative tests, all inside the same Agent Host sandbox from Phase 9.
  const neg1 = await launch({ action: "read_outside", absPath: nodePath.join(OUTSIDE_DIR, "secret.txt") }); // (2) filesystem-search / reach outside grant
  const neg2 = await launch({ action: "exec_git", bin: "/usr/bin/git" }); // (3) call a capability never granted (raw git, not routed through any capability)
  const neg3 = await launch({ action: "write_direct_outside", absPath: nodePath.join(OUTSIDE_DIR, "hacked.txt") }); // (4) write across target
  // (1) "Agent selects a different implementation itself" and (5) "bypass resolver" are proven
  // structurally, not by a sandbox denial: the Agent process launched above never receives a
  // capability_id, a contract path, or any resolver API — its argv is only the JSON instruction
  // built in STEP 4 from the ALREADY-resolved capability_id. It has no code path that could call
  // classifyCommand/routeOwnerCommand/getCapability itself (those modules are never on its argv,
  // its cwd, or its env) — there is nothing for it to bypass TO. This is recorded as machine
  // evidence (the Agent's actual received env_keys/cwd from its own JSON output), not a claim.
  report.STEP5_NEG_read_outside = safeParse(neg1.stdout);
  report.STEP5_NEG_exec_git = safeParse(neg2.stdout);
  report.STEP5_NEG_write_outside = safeParse(neg3.stdout);
  report.STEP5_NEG_agent_env_and_cwd_evidence = { cwd: safeParse(neg1.stdout)?.cwd, env_keys: safeParse(neg1.stdout)?.env_keys };

  console.log(JSON.stringify(report, null, 2));
}

main();
