/**
 * หน้าที่: proves Owner activity producers go through emitSystemEvent,
 * Display Queue (not execution queue), projection grouping, GitHub remote
 * verification, and closed doors for raw UI / agent bypass / DNA OS
 * self-verification of external services.
 *
 * How to run: npx tsx control/event-pipeline/tests/owner-activity.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createCoordinationStore } from "../../work-coordination/coordination";
import { emitSystemEvent, eventsForCommand, eventsForCorrelation, listDisplayQueue as backboneDisplayQueue } from "../../owner-backbone/contract";
import {
  AGENT_DIRECT_UI_WRITE,
  DIRECT_RAW_EVENT_TO_UI,
  EXTERNAL_SELF_VERIFICATION,
  denyDirectOwnerSurfaceWrite,
  ingestOwnerActivity,
  listDisplayQueue,
  projectOwnerActivity,
  recordAgentMessageActivity,
  recordGithubPublicationActivity,
} from "../contract";

declare const process: { cwd(): string; exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const commandId = `cmd_owner_activity_${Date.now()}`;
const workOrderId = `wo-${commandId}`;
let passed = 0;
let failed = 0;

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

async function main(): Promise<void> {
await check("required fields fail closed", async () => {
  const result = await ingestOwnerActivity({
    correlation_id: "",
    work_order_id: workOrderId,
    actor_identity: "dna-os",
    actor_type: "dna_os",
    actor_icon_ref: "icon:dna-os",
    action: "noop",
    status: "REQUESTED",
    source: "test",
    processing_group_id: "pg-test",
    step_id: "step-1",
    human_readable: "noop",
    verification_authority: "DNA_OS",
  });
  assert(result.ok === false && result.reason_code === "ACTIVITY_EVENT_INVALID", JSON.stringify(result));
});

await check("raw JSON cannot be the Owner projection text", async () => {
  const result = await ingestOwnerActivity({
    correlation_id: commandId,
    work_order_id: workOrderId,
    actor_identity: "dna-os",
    actor_type: "dna_os",
    actor_icon_ref: "icon:dna-os",
    action: "dump",
    status: "REQUESTED",
    source: "test",
    processing_group_id: "pg-test",
    step_id: "step-raw",
    human_readable: "{\n  \"event_type\": \"INTERNAL_EVENT\"\n}",
    verification_authority: "DNA_OS",
  });
  assert(result.ok === false && result.reason_code === "DIRECT_RAW_EVENT_TO_UI", JSON.stringify(result));
  assert(DIRECT_RAW_EVENT_TO_UI === 0, "DIRECT_RAW_EVENT_TO_UI");
});

await check("agent cannot write the Owner Surface directly", () => {
  const denied = denyDirectOwnerSurfaceWrite("agent tried to POST /owner/surface");
  assert(denied.ok === false && denied.reason_code === "AGENT_DIRECT_UI_WRITE", JSON.stringify(denied));
  assert(AGENT_DIRECT_UI_WRITE === 0, "AGENT_DIRECT_UI_WRITE");
});

await check("DNA OS cannot mark GitHub VERIFIED from local state", async () => {
  const result = await ingestOwnerActivity({
    correlation_id: commandId,
    work_order_id: workOrderId,
    actor_identity: "dna-os",
    actor_type: "dna_os",
    actor_icon_ref: "icon:dna-os",
    action: "github_commit_accepted",
    status: "VERIFIED",
    source: "test-local",
    processing_group_id: `pg-github-publish-${commandId}`,
    step_id: "step-bad",
    human_readable: "Commit accepted",
    verification_authority: "DNA_OS",
  });
  assert(result.ok === false && result.reason_code === "EXTERNAL_SELF_VERIFICATION", JSON.stringify(result));
  assert(EXTERNAL_SELF_VERIFICATION === 0, "EXTERNAL_SELF_VERIFICATION");
});

await check("GitHub VERIFIED requires remote SHA match from GitHub", async () => {
  const missingSha = await ingestOwnerActivity({
    correlation_id: commandId,
    work_order_id: workOrderId,
    actor_identity: "t23598788-oss/-DNA-OS-INFRASTRUCTURE-",
    actor_type: "external_service",
    actor_icon_ref: "icon:github",
    action: "github_commit_accepted",
    status: "VERIFIED",
    source: "connections/github/github-read-api.ts#getBranch",
    processing_group_id: `pg-github-publish-${commandId}`,
    step_id: "step-github-sha-match",
    human_readable: "Commit accepted",
    verification_authority: "GITHUB",
    verification_proof: { authority: "GITHUB", source: "connections/github/github-read-api.ts#getBranch", remote_sha: null, compared_to: "abc", sha_match: true },
  });
  assert(missingSha.ok === false && missingSha.reason_code === "GITHUB_REMOTE_VERIFICATION", JSON.stringify(missingSha));
});

await check("Display Queue is independent from the execution queue", async () => {
  const before = createCoordinationStore().items().length;
  const ingested = await ingestOwnerActivity({
    correlation_id: commandId,
    work_order_id: workOrderId,
    actor_identity: "dna-os",
    actor_type: "dna_os",
    actor_icon_ref: "icon:dna-os",
    action: "engineering_commit",
    status: "ACCEPTED",
    source: "control/engineering-runtime/commit-authority.ts",
    processing_group_id: `pg-github-publish-${commandId}`,
    step_id: "step-dna-os-commit",
    human_readable: "DNA OS created a commit",
    verification_authority: "DNA_OS",
  });
  assert(ingested.ok === true, JSON.stringify(ingested));
  const after = createCoordinationStore().items().length;
  assert(after === before, "display ingest must not enqueue execution work");
  const queued = listDisplayQueue(commandId);
  assert(queued.some((item) => item.event_id === (ingested.ok ? ingested.event.event_id : "")), "display queue must hold the event");
  assert(!("raw_result" in queued[0]!.projection), "display queue projection is not raw runtime JSON");
  const systemEvents = eventsForCorrelation(commandId);
  assert(systemEvents.some((event) => event.event_id === (ingested.ok ? ingested.event.event_id : "")), "canonical SystemEvent persisted");
});

await check("agent messages emit SystemEvents", async () => {
  const recorded = await recordAgentMessageActivity({
    correlation_id: commandId,
    work_order_id: workOrderId,
    actor_identity: "CLAUDE",
    actor_icon_ref: "icon:claude",
    evidence_ref: "ev-agent-message-test",
    sequence: 1,
  });
  assert(recorded.ok === true, JSON.stringify(recorded));
  const events = eventsForCommand(commandId);
  assert(events.some((event) => event.event_type === "AGENT_MESSAGE"), "AGENT_MESSAGE SystemEvent");
});

await check("GitHub publication lineage groups Command → Work Order → processing group → verified SHA", async () => {
  const sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const recorded = await recordGithubPublicationActivity({
    command_id: commandId,
    work_order_id: workOrderId,
    dna_os_commit_sha: sha,
    github_owner: "t23598788-oss",
    github_repository: "-DNA-OS-INFRASTRUCTURE-",
    publish_branch: "main",
    pre_publish_remote_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    post_publish_remote_sha: sha,
    published: true,
    publish_source: "connections/github/github-read-api.ts#getBranch",
  });
  assert(recorded.requested.ok === true, JSON.stringify(recorded.requested));
  assert(recorded.accepted?.ok === true, JSON.stringify(recorded.accepted));
  assert(recorded.verified?.ok === true, JSON.stringify(recorded.verified));
  if (!recorded.verified?.ok) return;
  assert(recorded.verified.event.status === "VERIFIED", recorded.verified.event.status);
  assert(recorded.verified.event.verification_authority === "GITHUB", recorded.verified.event.verification_authority);
  assert(recorded.verified.event.human_readable === "Commit accepted", recorded.verified.event.human_readable);
  assert(recorded.verified.event.verification_proof?.sha_match === true, "sha_match");
  assert(recorded.verified.event.parent_event_id !== null, "parent/child");
  const projection = projectOwnerActivity(commandId);
  assert(projection.schema === "OWNER_ACTIVITY_PROJECTION_V1", projection.schema);
  assert(projection.command_id === commandId, projection.command_id);
  assert(projection.work_order_id === workOrderId, String(projection.work_order_id));
  const githubGroup = projection.processing_groups.find((group) => group.processing_group_id === `pg-github-publish-${commandId}`);
  assert(Boolean(githubGroup), "github processing group");
  assert(githubGroup?.actor_icon_ref === "icon:github" || githubGroup?.status === "VERIFIED", githubGroup?.actor_icon_ref ?? "missing");
  assert(githubGroup?.status === "VERIFIED", String(githubGroup?.status));
  assert(githubGroup?.details_available === true, "details stay behind details_reference");
  assert(projection.lineage.event_ids.length > 0, "lineage events");
  assert(projection.lineage.evidence_refs.length > 0, "lineage evidence");
  const compact = JSON.stringify(projection.processing_groups);
  assert(!compact.includes("github_publish_requested"), "internal action names stay off compact groups");
  const systemEvents = eventsForCommand(commandId);
  assert(systemEvents.some((event) => event.event_type === "SOURCE_PUBLISH_REQUESTED"), "ENGINEERING_PUBLISH_SYSTEM_EVENT");
  assert(systemEvents.some((event) => event.event_type === "GITHUB_COMMIT_ACCEPTED" && event.sha_match === true), "GITHUB_REMOTE_VERIFIED_ACTIVITY");
  assert(backboneDisplayQueue(commandId).length > 0, "DISPLAY_QUEUE");
});

await check("GITHUB_COMMIT_ACCEPTED cannot be emitted without remote SHA confirmation", async () => {
  let denied = false;
  try {
    await emitSystemEvent({
      command_id: commandId,
      work_id: workOrderId,
      incident_id: null,
      event_type: "GITHUB_COMMIT_ACCEPTED",
      state: "VERIFIED",
      source: "control/engineering-runtime/publish.ts",
      resource_ids: [],
      capability_ids: [],
      evidence_refs: [],
      next_action: "github_commit_accepted",
      correlation_id: commandId,
      work_order_id: workOrderId,
      verification_authority: "DNA_OS",
      sha_match: true,
      remote_sha: "cccccccccccccccccccccccccccccccccccccccc",
    });
  } catch {
    denied = true;
  }
  assert(denied, "DNA OS source must not emit GITHUB_COMMIT_ACCEPTED");
});

await check("read-time task-id guessing is gone", () => {
  const ownerHttp = readFileSync(join(process.cwd(), "transport/owner-command-http/server.ts"), "utf8");
  assert(!ownerHttp.includes("task-${commandId}-agent-host"), "READ_TIME_TASK_ID_GUESSING");
  assert(!ownerHttp.includes("`wo-${commandId}`"), "no work-id guess");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
}

void main();
