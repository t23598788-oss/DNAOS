/**
 * INBOUND_EVENT_ADAPTER_FABRIC_V1 / OWNER_CONTINUOUS_WORK_VISIBILITY_V1
 *
 * How to run:
 *   npx tsx control/inbound-event-fabric/tests/inbound-event-fabric.test.ts
 */

import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { DNA_OS_MCP_TOOLS } from "../../../connections/dna-os-mcp/contract";
import {
  describeNativeNotificationEnablement,
  listNotifications,
  projectHumanNotification,
  readMacosNotificationPermission,
  setNativeNotificationPort,
} from "../../owner-notification/contract";
import { ownerWorkSurfaceSnapshot } from "../../owner-work-surface/contract";
import {
  codingActivityFor,
  disconnectCodingClient,
  discoverInboundAdapters,
  fileArrival,
  inboundEventGrantsAuthority,
  ingestInboundEvent,
  ownerWorkNotificationSummary,
  reconnectCodingClient,
  recordWorkOutput,
  resetInboundMemory,
  submitOwnerWork,
  workOutputSummary,
  listSubmittedWork,
} from "../contract";

declare const process: { cwd(): string; env: Record<string, string | undefined>; exit: (code: number) => void };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const STAMP = Date.now();
const INB = join(process.cwd(), "control/inbound-event-fabric/data");
const NOTE = join(process.cwd(), "control/owner-notification/data");
for (const [key, value] of Object.entries({
  INBOUND_ADAPTER_LOG: join(INB, `ad-${STAMP}.jsonl`),
  INBOUND_SUBMITTED_WORK_LOG: join(INB, `sw-${STAMP}.jsonl`),
  INBOUND_CODING_ACTIVITY_LOG: join(INB, `ca-${STAMP}.jsonl`),
  INBOUND_OUTPUT_LOG: join(INB, `out-${STAMP}.jsonl`),
  INBOUND_IDENTITY_LOG: join(INB, `id-${STAMP}.jsonl`),
  OWNER_NOTIFICATION_LOG: join(NOTE, `inb-note-${STAMP}.jsonl`),
  OWNER_ACTIVITY_LOG: join(NOTE, `inb-act-${STAMP}.jsonl`),
  OWNER_NOTIFICATION_DELIVERY_LOG: join(NOTE, `inb-del-${STAMP}.jsonl`),
  OWNER_NOTIFICATION_ENABLEMENT_LOG: join(NOTE, `inb-en-${STAMP}.jsonl`),
})) process.env[key] = value;

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
async function check(name: string, body: () => Promise<void> | void): Promise<void> {
  try {
    await body();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

setNativeNotificationPort({
  readPermission: () => ({ state: "NOT_REQUESTED", helper_present: true, error_code: null }),
  requestAuthorization: () => ({ state: "NOT_REQUESTED", error_code: "NOT_INTERACTIVE" }),
  schedule: () => ({ result: "DELIVERY_FAILED", error_code: "NOT_REQUESTED" }),
});

async function main(): Promise<void> {
  resetInboundMemory();
  const adapters = discoverInboundAdapters();
  const email = adapters.find((row) => row.provider_type === "EMAIL_PROVIDER");
  const work = submitOwnerWork({
    subject: "สร้าง notification adapters",
    assigned_client: "Cursor",
    work_id: `work-inb-${STAMP}`,
  });

  await check("A+LIVE1. Owner submits work and may leave Cursor", () => {
    assert(work.work_id === `work-inb-${STAMP}`, work.work_id);
    assert(work.assigned_client === "Cursor", work.assigned_client);
    const activity = codingActivityFor(work.work_id);
    assert(activity?.client_id === "Cursor", JSON.stringify(activity));
    assert(activity?.subject === "สร้าง notification adapters", String(activity?.subject));
    assert(activity?.current_stage === "WORK_ACCEPTED", String(activity?.current_stage));
    console.log(`LIVE_OWNER_LEAVES_CURSOR=${activity?.client_id} ${activity?.current_stage}`);
  });

  await check("B. DNA OS retains work identity after leaving client UI", () => {
    const again = submitOwnerWork({ subject: "สร้าง notification adapters", assigned_client: "Cursor", work_id: work.work_id });
    assert(again.submission_id === work.submission_id, "same submission");
    assert(codingActivityFor(work.work_id)?.work_id === work.work_id, "retained");
  });

  await check("C+LIVE2. Progress updates one activity without notification storm", () => {
    const before = listNotifications().length;
    for (const stage of ["IMPLEMENTING", "BUILDING", "TESTING"] as const) {
      ingestInboundEvent({
        adapter_id: "adapter://inbound/coding-client/cursor",
        provider_id: "Cursor",
        external_event_id: `stage:${work.work_id}:${stage}`,
        event_type: stage,
        work_id: work.work_id,
        entity_id: `entity:work:${work.work_id}`,
        source_system: "Cursor",
        current_state: stage,
        previous_state: null,
        facts: { subject: work.subject, client: "Cursor" },
        evidence_refs: [`act:${stage}`],
      });
    }
    const activity = codingActivityFor(work.work_id);
    assert(activity?.current_stage === "TESTING", String(activity?.current_stage));
    assert(listNotifications().length - before <= 1, `storm ${listNotifications().length - before}`);
    console.log(`LIVE_CONTINUOUS_PROGRESS=${activity?.current_stage}`);
  });

  await check("D. Test failure generates one warning", () => {
    const payload = {
      adapter_id: "adapter://inbound/system-internal",
      provider_id: "dna-os",
      external_event_id: `fail:${work.work_id}`,
      event_type: "TEST_FAILED",
      work_id: work.work_id,
      entity_id: `entity:work:${work.work_id}`,
      source_system: "DNA_OS",
      current_state: "TEST_FAILED",
      previous_state: "TESTING",
      facts: { subject: work.subject },
      evidence_refs: ["ev:fail"],
      severity: "WARN" as const,
    };
    ingestInboundEvent(payload);
    ingestInboundEvent(payload);
    const fails = listNotifications().filter((row) => row.notification_type === "TEST_FAILED" && row.work_id === work.work_id);
    assert(fails.length === 1, String(fails.length));
    assert(projectHumanNotification(fails[0]!).message.includes("ไม่ผ่าน"), "human");
  });

  await check("E+LIVE3. Report creation increments report count", () => {
    recordWorkOutput({ work_id: work.work_id, kind: "report" });
    recordWorkOutput({ work_id: work.work_id, kind: "report" });
    const summary = workOutputSummary(work.work_id);
    assert(summary.REPORTS_CREATED === 2, JSON.stringify(summary));
    assert(ownerWorkNotificationSummary().reports_created_count === 2, "owner summary");
    console.log("LIVE_REPORT_OUTPUT=2");
  });

  await check("F. Review-ready generates Owner attention", () => {
    ingestInboundEvent({
      adapter_id: "adapter://inbound/system-internal",
      provider_id: "dna-os",
      external_event_id: `review:${work.work_id}`,
      event_type: "REVIEW_READY",
      work_id: work.work_id,
      entity_id: `entity:work:${work.work_id}`,
      source_system: "DNA_OS",
      current_state: "REVIEW_READY",
      previous_state: "TESTING",
      facts: { subject: work.subject },
      evidence_refs: ["ev:review"],
      action_required: true,
      owner_attention: true,
    });
    const notes = listNotifications().filter((row) => row.notification_type === "REVIEW_READY" && row.work_id === work.work_id);
    assert(notes[0]?.action_required === true, JSON.stringify(notes[0]));
  });

  await check("G. Coding-client done is not runtime success", () => {
    ingestInboundEvent({
      adapter_id: "adapter://inbound/coding-client/cursor",
      provider_id: "Cursor",
      external_event_id: `done:${work.work_id}`,
      event_type: "RUNTIME_VERIFIED",
      work_id: work.work_id,
      entity_id: `entity:work:${work.work_id}`,
      source_system: "Cursor",
      current_state: "RUNTIME_VERIFIED",
      previous_state: null,
      facts: { revision: "nope" },
      evidence_refs: ["ev:lie"],
    });
    const runtime = listNotifications().filter((row) => row.notification_type === "RUNTIME_VERIFIED" && row.work_id === work.work_id);
    assert(runtime.length === 0, "no fake runtime");
  });

  await check("H+LIVE7. Disconnect preserves incomplete work", () => {
    const disconnected = disconnectCodingClient(work.work_id);
    assert(disconnected?.client_connected === false, "disconnected");
    assert(disconnected?.WORK_COMPLETED === false, "not complete");
    assert(disconnected?.current_stage !== "WORK_COMPLETED", String(disconnected?.current_stage));
    console.log(`LIVE_CLIENT_DISCONNECT=${disconnected?.current_stage} completed=${disconnected?.WORK_COMPLETED}`);
  });

  await check("I. Reconnection does not duplicate work", () => {
    const before = listSubmittedWork().filter((row) => row.work_id === work.work_id).length;
    reconnectCodingClient(work.work_id);
    submitOwnerWork({ subject: work.subject, assigned_client: "Cursor", work_id: work.work_id });
    const after = listSubmittedWork().filter((row) => row.work_id === work.work_id).length;
    assert(before === 1 && after === 1, `dup ${after}`);
  });

  await check("J+LIVE8. Duplicate inbound provider event is one event", () => {
    const before = listNotifications().length;
    const payload = {
      adapter_id: "adapter://inbound/system-internal",
      provider_id: "dna-os",
      external_event_id: `dup:${work.work_id}`,
      event_type: "SYSTEM_WARNING",
      work_id: work.work_id,
      entity_id: `entity:work:${work.work_id}`,
      source_system: "DNA_OS",
      current_state: "WARN",
      previous_state: null,
      facts: { revision: "same" },
      evidence_refs: ["ev:dup"],
    };
    for (let i = 0; i < 10; i += 1) ingestInboundEvent(payload);
    assert(listNotifications().length <= before + 1, "one notify");
    console.log("LIVE_EVENT_DEDUPLICATION=true");
  });

  await check("K. File reads/internal writes do not create file-arrival notifications", () => {
    const before = listNotifications().filter((row) => row.notification_type === "FILE_RECEIVED").length;
    fileArrival({ meaningful: false, work_id: work.work_id, resource_ref: "src/internal.ts" });
    assert(listNotifications().filter((row) => row.notification_type === "FILE_RECEIVED").length === before, "no arrival");
  });

  await check("L+M+LIVE6. Native permission not requested automatically", () => {
    const perm = readMacosNotificationPermission();
    assert(perm.state === "NOT_REQUESTED", perm.state);
    assert(perm.NEW_NOTIFICATION_PERMISSION_AUTO_REQUESTED === false, "auto");
    const describe = describeNativeNotificationEnablement();
    assert(describe.action === "ENABLE_NATIVE_NOTIFICATIONS" && describe.requested === false, JSON.stringify(describe));
    console.log(`LIVE_NATIVE_PERMISSION=${perm.state}`);
  });

  await check("N. Inbound events grant no authority", () => {
    assert(inboundEventGrantsAuthority() === false, "lock");
    assert(adapters.every((row) => row.discovery_grants_authority === false), "discovery");
    assert(email?.health === "NOT_AVAILABLE", String(email?.health));
  });

  await check("LIVE4. Machine WORK_COMPLETED notification includes report count", () => {
    ingestInboundEvent({
      adapter_id: "adapter://inbound/system-internal",
      provider_id: "dna-os",
      external_event_id: `complete:${work.work_id}`,
      event_type: "WORK_COMPLETED",
      work_id: work.work_id,
      entity_id: `entity:work:${work.work_id}`,
      source_system: "DNA_OS",
      current_state: "WORK_COMPLETED",
      previous_state: "REVIEW_READY",
      facts: { reports_created: 2, subject: work.subject },
      evidence_refs: ["ev:complete"],
    });
    const done = listNotifications().filter((row) => row.notification_type === "WORK_COMPLETED" && row.work_id === work.work_id);
    assert(done.length === 1, String(done.length));
    assert(projectHumanNotification(done[0]!).message.includes("2"), projectHumanNotification(done[0]!).message);
    console.log("LIVE_WORK_COMPLETION=true");
  });

  await check("LIVE5. Runtime success only after RUNTIME_VERIFIED", () => {
    for (const type of ["PUBLISHED", "DEPLOYED", "RUNTIME_VERIFIED"] as const) {
      ingestInboundEvent({
        adapter_id: "adapter://inbound/system-internal",
        provider_id: "dna-os",
        external_event_id: `${type}:${work.work_id}`,
        event_type: type,
        work_id: work.work_id,
        entity_id: `entity:work:${work.work_id}`,
        source_system: "DNA_OS",
        current_state: type,
        previous_state: null,
        facts: { revision: "abc123", subject: work.subject },
        evidence_refs: [`ev:${type}`],
      });
    }
    const published = listNotifications().find((row) => row.notification_type === "PUBLISHED" && row.work_id === work.work_id)!;
    const deployed = listNotifications().find((row) => row.notification_type === "DEPLOYED" && row.work_id === work.work_id)!;
    const verified = listNotifications().find((row) => row.notification_type === "RUNTIME_VERIFIED" && row.work_id === work.work_id)!;
    assert(!projectHumanNotification(published).message.includes("runtime ตรวจสอบสำเร็จ"), "pub");
    assert(projectHumanNotification(deployed).message.includes("กำลังตรวจ") || projectHumanNotification(deployed).message.includes("กำลังตรวจสอบ"), "dep");
    assert(projectHumanNotification(verified).title.includes("runtime ตรวจสอบสำเร็จ"), "rt");
    console.log("LIVE_RUNTIME_SUCCESS=true");
  });

  await check("O. Existing MCP reused", () => {
    const names = DNA_OS_MCP_TOOLS.map((tool) => tool.metadata.name);
    assert(names.includes("submit_command"), "existing");
    assert(names.includes("dna_os.list_inbound_adapters"), "adapters");
    assert(names.includes("dna_os.list_active_work"), "active");
    assert(names.includes("dna_os.get_owner_work_notification_summary"), "summary");
    const snap = ownerWorkSurfaceSnapshot("ai://inb", "session-inb");
    assert((snap.inbound_work as { grants_authority?: boolean }).grants_authority === false, "slice");
  });

  for (const file of [
    process.env.INBOUND_ADAPTER_LOG,
    process.env.INBOUND_SUBMITTED_WORK_LOG,
    process.env.INBOUND_CODING_ACTIVITY_LOG,
    process.env.INBOUND_OUTPUT_LOG,
    process.env.INBOUND_IDENTITY_LOG,
    process.env.OWNER_NOTIFICATION_LOG,
    process.env.OWNER_ACTIVITY_LOG,
    process.env.OWNER_NOTIFICATION_DELIVERY_LOG,
    process.env.OWNER_NOTIFICATION_ENABLEMENT_LOG,
  ]) {
    if (file && existsSync(file)) unlinkSync(file);
  }
  setNativeNotificationPort(null);
  console.log(`NEW_DETERMINISTIC_PROOFS_PASSED = ${failed === 0}`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
