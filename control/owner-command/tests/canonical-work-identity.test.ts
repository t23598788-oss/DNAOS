/**
 * Deterministic proof that Owner command lifecycle uses one canonical work_id.
 *
 * How to run:
 *   npx tsx control/owner-command/tests/canonical-work-identity.test.ts
 */

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { EnvelopeIdentity } from "../../../contracts/identity/envelope-identity";
import { registerIdentity } from "../../../permissions/access-control/identity-registry";
import { submitOwnerCommand, isCanonicalWorkId, latestWorkForIdentity, lineageForCommand } from "../contract";
import { getLatestWorkContinuity } from "../../conversation-runtime/self-work-ledger";
import { createTaskWorkspace, runAgentWorkOrder, type WorkOrder } from "../../agent-gateway/contract";
import { admitEngineeringCoding, runEngineeringCoding } from "../../engineering-runtime/contract";
import { recordGithubPublicationActivity } from "../../event-pipeline/contract";

declare const process: { cwd(): string; exitCode?: number; env: Record<string, string | undefined> };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const IDENTITY_ID = `identity-canonical-work-${randomUUID()}`;
const OWNER: EnvelopeIdentity = {
  identity_id: IDENTITY_ID,
  acting_as_account_id: "account-canonical-work-test",
  acting_as_tenant_id: "tenant-canonical-work-test",
  software_id: "software-canonical-work-test",
  kind: "human",
};
const SEMANTIC = { enabled: false as const };
const ACTION = `play some music please canonical-work-${randomUUID()}`;

registerIdentity({ identity_id: IDENTITY_ID, kind: "human", display_name: "Canonical Work Identity" });

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function uniqueWorkIds(): string[] {
  const pointer = latestWorkForIdentity(IDENTITY_ID);
  if (!pointer) return [];
  const raw = readFileSync(join(process.cwd(), "control/owner-command/data/latest-work.jsonl"), "utf8");
  const ids = raw.split("\n").filter(Boolean).map((line) => JSON.parse(line) as { identity_id: string; work_id: string })
    .filter((row) => row.identity_id === IDENTITY_ID)
    .map((row) => row.work_id);
  return [...new Set(ids)];
}

async function main(): Promise<void> {
  const first = await submitOwnerCommand(ACTION, OWNER, {}, SEMANTIC);

  await check("one Owner command → one canonical work_id", () => {
    assert(isCanonicalWorkId(first.work_id), `expected canonical work_id, got ${first.work_id}`);
    assert(first.work_id !== first.envelope.command_id, "command_id must not be WORK_ID");
    assert(!first.work_id.startsWith("wo-"), "must not mint wo- namespace");
    const lineage = lineageForCommand(first.envelope.command_id);
    assert(lineage.every((row) => row.work_id === first.work_id), "lineage must carry the same work_id");
  });

  const continued = await submitOwnerCommand("continue", OWNER, {}, SEMANTIC);
  await check("continuation reuses the same work_id", () => {
    assert(continued.work_id === first.work_id, `continue minted ${continued.work_id} instead of ${first.work_id}`);
    assert(continued.envelope.command_id !== first.envelope.command_id, "continuation keeps a new command_id");
  });

  const status = await submitOwnerCommand("is it finished", OWNER, {}, SEMANTIC);
  await check("status phrase reuses the same work_id", () => {
    assert(status.work_id === first.work_id, `status phrase minted ${status.work_id}`);
  });

  const explicit = await submitOwnerCommand("previous task", OWNER, { work_id: first.work_id }, SEMANTIC);
  await check("submitOwnerCommand continues an existing work_id when identified", () => {
    assert(explicit.work_id === first.work_id, `explicit work_id was not preserved: ${explicit.work_id}`);
  });

  await check("agent execution preserves the same work_id", async () => {
    const workspace = createTaskWorkspace({
      work_order_id: first.work_id,
      command_id: first.envelope.command_id,
      assigned_source: [process.cwd()],
      workspace_root: "/tmp/dna-os-agent-workspaces",
    });
    const order: WorkOrder = {
      operation: "MODIFY",
      target_type: "FILE",
      target_path: "(canonical-work-identity)",
      requested_change: "credential_probe",
      content: "",
      workspace_scope: workspace.allowed_write_workspace,
      mode: "sandbox",
      required_tests: [],
      forbidden_files: [],
      evidence: [],
      work_order_id: first.work_id,
      agent_run: {
        worker_kind: "LOCAL",
        instruction: JSON.stringify({ action: "credential_probe" }),
        workspace_id: workspace.workspace_id,
        assigned_source_paths: workspace.allowed_read_paths,
        dependency_read_paths: [],
        workspace_path: workspace.allowed_write_workspace,
        timeout_ms: 15_000,
        expected_result_contract: "DNA_OS_AGENT_RESULT_V1",
      },
    };
    const result = await runAgentWorkOrder(order, { kind: "DIRECT", correlation_id: first.envelope.command_id, work_id: first.work_id }, process.env);
    assert(result.work_order_id === first.work_id, `agent work_order_id=${result.work_order_id}`);
    assert(!result.work_order_id.startsWith("wo-"), "agent must not mint wo-command_id");
  });

  await check("engineering preserves the same work_id", async () => {
    const commandId = `cmd_canonical_eng_${randomUUID()}`;
    const payload = {
      engineering_coding_intent: {
        authority: "ENGINEERING",
        allowed_paths: ["control/engineering-runtime/fixtures/allowed-target.txt"],
        allowed_symbols: [],
        required_tests: ["sandbox.write", "sandbox.readback"],
        forbidden_paths: ["control/engineering-runtime/fixtures/unrelated.txt", "package.json"],
        requested_function: "canonical work identity",
        requested_change: "prove work_id",
        target_domain: "control/engineering-runtime/fixtures",
        owner_intent: "canonical work identity",
      },
    };
    const admission = admitEngineeringCoding({
      command_id: commandId,
      work_id: first.work_id,
      checkout_root: process.cwd(),
      payload,
      selected_capability_id: "engineering-runtime",
    });
    assert(admission.work_id === first.work_id, `admission work_id=${admission.work_id}`);
    const run = await runEngineeringCoding({
      command_id: commandId,
      work_id: first.work_id,
      intent_text: "canonical work identity",
      payload,
      checkout_root: process.cwd(),
      selected_capability_id: "engineering-runtime",
      proposed_content: `canonical-work ${first.work_id}\n`,
    });
    assert(run.lineage.work_id === first.work_id, `engineering lineage work_id=${run.lineage.work_id}`);
  });

  await check("GitHub publication evidence preserves the same work_id", async () => {
    const activity = await recordGithubPublicationActivity({
      command_id: first.envelope.command_id,
      work_order_id: first.work_id,
      dna_os_commit_sha: "deadbeef",
      github_owner: null,
      github_repository: null,
      publish_branch: null,
      pre_publish_remote_sha: null,
      post_publish_remote_sha: null,
      published: false,
      publish_source: "control/owner-command/tests/canonical-work-identity.test.ts",
    });
    assert(activity.requested.ok, `github activity not ok: ${JSON.stringify(activity.requested)}`);
    if (activity.requested.ok) {
      assert(activity.requested.event.work_order_id === first.work_id, `github work_order_id=${activity.requested.event.work_order_id}`);
    }
  });

  await check("latest-work lookup returns that same work_id", () => {
    const pointer = latestWorkForIdentity(IDENTITY_ID);
    assert(pointer !== null && pointer.work_id === first.work_id, `pointer=${pointer?.work_id}`);
    const ledger = getLatestWorkContinuity(IDENTITY_ID);
    assert(ledger !== null && ledger.WORK_ID === first.work_id, `ledger WORK_ID=${ledger?.WORK_ID}`);
    assert(ledger!.WORK_ID !== first.envelope.command_id, "ledger must not use command_id as WORK_ID");
  });

  await check("restart recovery returns the same active/latest work", () => {
    const probe = join(tmpdir(), `dna-os-latest-work-probe-${randomUUID()}.ts`);
    writeFileSync(probe, `import { latestWorkForIdentity } from ${JSON.stringify(join(process.cwd(), "control/owner-command/work-identity.ts"))};\nprocess.stdout.write(latestWorkForIdentity(${JSON.stringify(IDENTITY_ID)})?.work_id ?? "");\n`);
    const recovered = execFileSync("npx", ["tsx", probe], { cwd: process.cwd(), encoding: "utf8" }).trim();
    assert(recovered === first.work_id, `restart recovered ${recovered}`);
  });

  const duplicate = await submitOwnerCommand(ACTION, OWNER, {}, SEMANTIC);
  await check("duplicate submission does not create a second work", () => {
    assert(duplicate.work_id === first.work_id, `duplicate minted ${duplicate.work_id}`);
    assert(uniqueWorkIds().length === 1, `expected 1 work_id, got ${uniqueWorkIds().join(",")}`);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
