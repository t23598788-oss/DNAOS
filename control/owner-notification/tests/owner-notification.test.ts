/**
 * OWNER_NOTIFICATION_BACKEND_V1 / MACOS_NATIVE_NOTIFICATION_DELIVERY_V1
 *
 * How to run:
 *   npx tsx control/owner-notification/tests/owner-notification.test.ts
 */

import { existsSync, mkdirSync, unlinkSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { DNA_OS_MCP_TOOLS } from "../../../connections/dna-os-mcp/contract";
import { ownerWorkSurfaceSnapshot } from "../../owner-work-surface/contract";
import {
  attentionIndex,
  evaluateCanonicalEvent,
  helperPath,
  listActiveWork,
  listNotifications,
  makeCanonicalEvent,
  notificationInteraction,
  notificationMetrics,
  persistNotification,
  projectHumanNotification,
  queryNotifications,
  readMacosNotificationPermission,
  resetNotificationMemory,
  scheduleNativeFixture,
  setNativeNotificationPort,
  successTruthLocks,
} from "../contract";

declare const process: { cwd(): string; env: Record<string, string | undefined>; exit: (code: number) => void };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const STAMP = Date.now();
const DIR = join(process.cwd(), "control/owner-notification/data");
for (const [key, value] of Object.entries({
  OWNER_NOTIFICATION_LOG: join(DIR, `note-${STAMP}.jsonl`),
  OWNER_ACTIVITY_LOG: join(DIR, `act-${STAMP}.jsonl`),
  OWNER_NOTIFICATION_DELIVERY_LOG: join(DIR, `del-${STAMP}.jsonl`),
  OWNER_NOTIFICATION_ENABLEMENT_LOG: join(DIR, `en-${STAMP}.jsonl`),
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

const deniedPort = {
  readPermission: () => ({ state: "DENIED" as const, helper_present: true, error_code: null }),
  requestAuthorization: () => ({ state: "DENIED" as const, error_code: "NOT_IN_THIS_PROOF" }),
  schedule: () => ({ result: "DELIVERY_FAILED" as const, error_code: "NOT_AUTHORIZED" }),
};

function event(type: string, extra?: Partial<ReturnType<typeof makeCanonicalEvent>>): ReturnType<typeof makeCanonicalEvent> {
  return makeCanonicalEvent({
    event_id: `event-${type}-${STAMP}-${Math.random().toString(16).slice(2)}`,
    event_type: type,
    entity_id: extra?.entity_id ?? `entity:work:notify-${STAMP}`,
    work_id: extra?.work_id ?? `work-notify-${STAMP}`,
    command_id: extra?.command_id ?? null,
    source_system: extra?.source_system ?? "DNA_OS",
    previous_state: extra?.previous_state ?? null,
    current_state: extra?.current_state ?? type,
    severity: extra?.severity ?? "INFO",
    owner_attention: extra?.owner_attention ?? false,
    action_required: extra?.action_required ?? false,
    evidence_refs: extra?.evidence_refs ?? [`ev:${type}`],
  });
}

async function main(): Promise<void> {
  setNativeNotificationPort(deniedPort);
  resetNotificationMemory();

  await check("A. Notification derives from canonical event/state only", () => {
    const row = evaluateCanonicalEvent(event("TEST_FAILED"), { revision: "fix-1" });
    assert(row.notification?.event_id.startsWith("event-TEST_FAILED") === true, "from event");
    assert(row.notification?.schema === "OWNER_NOTIFICATION_V1", "schema");
  });

  await check("B. Repository search is not required", () => {
    assert(successTruthLocks().NOTIFICATION_SOURCE_SEARCH_REQUIRED === false, "search");
  });

  await check("C. File reads do not notify", () => {
    const before = listNotifications().length;
    const row = evaluateCanonicalEvent(event("FILE_READ"));
    assert(row.decision === "IGNORE" && row.notification === null, String(row.decision));
    assert(listNotifications().length === before, "no new");
  });

  await check("D+LIVE2. Repeated unchanged TEST_FAILED does not duplicate", () => {
    const failedEvent = makeCanonicalEvent({
      event_id: `event-test-fail-stable-${STAMP}`,
      event_type: "TEST_FAILED",
      entity_id: `entity:work:notify-${STAMP}`,
      work_id: `work-notify-${STAMP}`,
      command_id: null,
      source_system: "DNA_OS",
      previous_state: null,
      current_state: "TEST_FAILED",
      severity: "WARN",
      owner_attention: true,
      action_required: false,
      evidence_refs: ["ev:test"],
    });
    const first = evaluateCanonicalEvent(failedEvent, { revision: "abc" });
    assert(first.notification?.severity === "WARNING", String(first.notification?.severity));
    for (let i = 0; i < 10; i += 1) evaluateCanonicalEvent(failedEvent, { revision: "abc" });
    const same = listNotifications().filter((row) => row.deduplication_key === first.notification?.deduplication_key);
    assert(same.length === 1, `dup=${same.length}`);
    console.log("LIVE_TEST_FAILURE_NOTIFICATION=true");
  });

  await check("E+LIVE1. Activity is separate from notification", () => {
    const before = listNotifications().length;
    for (let i = 0; i < 8; i += 1) {
      evaluateCanonicalEvent(event("CODING_PROGRESS", { work_id: `work-code-${STAMP}`, current_state: "TESTING", source_system: "Cursor" }), {
        subject: "กำลังพัฒนา OWNER_NOTIFICATION_BACKEND_V1",
        goal: "OWNER_NOTIFICATION_BACKEND_V1",
        stage: "TESTING",
      });
    }
    const work = listActiveWork().find((row) => row.work_id === `work-code-${STAMP}`);
    assert(work !== undefined, "activity");
    assert(work?.actor === "Cursor" && work.stage === "TESTING", JSON.stringify(work));
    assert(listNotifications().length === before, "no storm");
    console.log(`LIVE_CODING_ACTIVITY=${work?.stage} actor=${work?.actor}`);
  });

  await check("F. Coding-client self-report cannot create runtime success", () => {
    const before = listNotifications().filter((row) => row.notification_type === "RUNTIME_VERIFIED").length;
    const completed = evaluateCanonicalEvent(event("WORK_COMPLETED", { source_system: "ai://cursor" }));
    assert(completed.decision === "ACTIVITY_ONLY", completed.decision);
    const runtime = evaluateCanonicalEvent(event("RUNTIME_VERIFIED", { source_system: "cursor" }), { revision: "nope" });
    assert(runtime.decision === "IGNORE", runtime.decision);
    assert(listNotifications().filter((row) => row.notification_type === "RUNTIME_VERIFIED").length === before, "no fake runtime");
  });

  await check("G–H+LIVE4. PUBLISHED / DEPLOYED / RUNTIME_VERIFIED are distinct", () => {
    const published = evaluateCanonicalEvent(event("PUBLISHED", { current_state: "PUBLISHED" }), { revision: "abc123" }).notification;
    const deployed = evaluateCanonicalEvent(event("DEPLOYED", { current_state: "DEPLOYED" }), { revision: "abc123" }).notification;
    const verified = evaluateCanonicalEvent(event("RUNTIME_VERIFIED", { current_state: "RUNTIME_VERIFIED" }), { revision: "abc123" }).notification;
    const p = projectHumanNotification(published!);
    const d = projectHumanNotification(deployed!);
    const v = projectHumanNotification(verified!);
    assert(!/runtime|ตรวจ runtime|พร้อมใช้/.test(p.message.toLowerCase()) && p.message.includes("เผยแพร่"), p.message);
    assert(d.message.includes("กำลังตรวจสอบ") && !d.message.includes("ผ่านการตรวจ runtime"), d.message);
    assert(v.message.includes("ผ่านการตรวจ runtime") && v.title.includes("สำเร็จ"), v.message);
    assert(successTruthLocks().PUBLISHED_EQUALS_DEPLOYED === false, "pub");
    assert(successTruthLocks().DEPLOYED_EQUALS_RUNTIME_VERIFIED === false, "dep");
    console.log("LIVE_DEPLOYMENT_TRUTH=true");
  });

  await check("I+LIVE5. Owner-disabled capability does not claim available", () => {
    const registered = evaluateCanonicalEvent(event("CAPABILITY_REGISTERED", {
      entity_id: "entity:capability:notify-fixture",
      work_id: `work-cap-${STAMP}`,
    }), { owner_enabled: false }).notification;
    const human = projectHumanNotification(registered!);
    assert(human.message.includes("ยังไม่ได้เปิดใช้งาน"), human.message);
    assert(!human.message.includes("พร้อมใช้งานแล้ว"), "not available");
    const available = evaluateCanonicalEvent(event("CAPABILITY_AVAILABLE", {
      entity_id: "entity:capability:notify-fixture",
      work_id: `work-cap-${STAMP}`,
    }), { owner_enabled: true }).notification;
    assert(projectHumanNotification(available!).message.includes("พร้อมใช้งานแล้ว"), "available");
    assert(successTruthLocks().CAPABILITY_REGISTERED_EQUALS_AVAILABLE === false, "lock");
    console.log("LIVE_CAPABILITY_AVAILABLE=true");
  });

  await check("J+LIVE3. OWNER_APPROVAL_REQUIRED is action-required", () => {
    const review = evaluateCanonicalEvent(event("REVIEW_READY", { action_required: true })).notification;
    const approval = evaluateCanonicalEvent(event("OWNER_APPROVAL_REQUIRED", { action_required: true })).notification;
    assert(approval?.action_required === true, "action");
    assert(approval?.owner_action_refs.includes("OPEN_REVIEW") === true, "refs");
    assert(queryNotifications("action_required").length >= 1, "index");
    assert(review?.notification_type === "REVIEW_READY", "review");
    console.log("LIVE_REVIEW_NOTIFICATION=true");
  });

  await check("K. Notification interaction cannot grant source authority", () => {
    const click = notificationInteraction("any");
    assert(click.grants_authority === false && click.SOURCE_WRITE_AUTHORITY === false, JSON.stringify(click));
  });

  await check("L–N+LIVE6. Permission truth without auto-request; denied does not break surface", () => {
    const denied = readMacosNotificationPermission();
    assert(denied.state === "DENIED" && denied.NEW_NOTIFICATION_PERMISSION_AUTO_REQUESTED === false, JSON.stringify(denied));
    const before = listNotifications().length;
    evaluateCanonicalEvent(event("SYSTEM_WARNING", { work_id: `work-warn-${STAMP}` }));
    assert(listNotifications().length === before + 1, "surface still works");
    const src = readFileSync(join(process.cwd(), "control/owner-notification/native/Notify.swift"), "utf8");
    assert(src.includes("UNUserNotificationCenter"), "UNUserNotificationCenter");
    assert(!src.includes("osascript") && !src.includes("AppleScript"), "no applescript");
    assert(successTruthLocks().ARBITRARY_APPLESCRIPT === false, "script");
    setNativeNotificationPort(null);
    const helper = helperPath();
    if (!existsSync(helper)) {
      mkdirSync(join(process.cwd(), "control/owner-notification/native/owner-notify.app/Contents/MacOS"), { recursive: true });
      const swift = join(process.cwd(), "control/owner-notification/native/Notify.swift");
      spawnSync("swiftc", ["-o", helper, swift, "-framework", "UserNotifications"], { encoding: "utf8" });
    }
    const live = readMacosNotificationPermission();
    const allowed = ["NOT_REQUESTED", "AUTHORIZED", "DENIED", "PROVISIONAL", "NOT_AVAILABLE", "ERROR"];
    assert(allowed.includes(live.state), live.state);
    assert(live.NEW_NOTIFICATION_PERMISSION_AUTO_REQUESTED === false, "no auto");
    console.log(`LIVE_MACOS_PERMISSION=${live.state}`);
    const last = listNotifications()[listNotifications().length - 1];
    const nativeLive = last ? scheduleNativeFixture(last) : { LIVE_MACOS_NOTIFICATION: "NOT_AVAILABLE_FOR_CURRENT_PERMISSION" };
    console.log(`LIVE_MACOS_NOTIFICATION=${nativeLive.LIVE_MACOS_NOTIFICATION}`);
    setNativeNotificationPort(deniedPort);
  });

  await check("O. No AppleScript / UI automation in delivery module", () => {
    const nativeTs = readFileSync(join(process.cwd(), "control/owner-notification/native.ts"), "utf8");
    assert(!nativeTs.includes("osascript") && !nativeTs.includes("AppleScript"), "ts");
  });

  await check("LIVE8. Persistence survives reload", () => {
    const snapshot = listNotifications();
    assert(snapshot.length > 0, "has rows");
    const unread = snapshot.filter((row) => row.read_at === null).length;
    persistNotification(snapshot[0]!);
    resetNotificationMemory();
    const reloaded = listNotifications();
    assert(reloaded.length === snapshot.length, `${reloaded.length}!=${snapshot.length}`);
    assert(reloaded.filter((row) => row.read_at === null).length === unread, "unread");
    console.log("LIVE_NOTIFICATION_PERSISTENCE=true");
  });

  await check("P. Existing MCP reused; no second plane", () => {
    const names = DNA_OS_MCP_TOOLS.map((tool) => tool.metadata.name);
    assert(names.includes("submit_command"), "existing");
    assert(names.includes("dna_os.list_notifications"), "list");
    assert(names.includes("dna_os.get_macos_notification_permission"), "perm");
    assert(names.includes("dna_os.get_active_work"), "active");
    assert(!names.includes("get_secret"), "secret");
    const snap = ownerWorkSurfaceSnapshot("ai://notify", "session-notify");
    assert((snap.owner_notifications as { HUMAN_NOTIFICATION_REQUIRES_AI?: boolean }).HUMAN_NOTIFICATION_REQUIRES_AI === false, "slice");
    assert(snap.layout !== undefined, "layout unchanged");
  });

  const m = notificationMetrics();
  const att = attentionIndex();
  console.log(`EVENTS_EVALUATED=${m.EVENTS_EVALUATED}`);
  console.log(`EVENTS_IGNORED=${m.EVENTS_IGNORED}`);
  console.log(`ACTIVITY_ONLY_EVENTS=${m.ACTIVITY_ONLY_EVENTS}`);
  console.log(`NOTIFICATIONS_CREATED=${m.NOTIFICATIONS_CREATED}`);
  console.log(`NOTIFICATIONS_DEDUPLICATED=${m.NOTIFICATIONS_DEDUPLICATED}`);
  console.log(`UNREAD_COUNT=${att.unread_count}`);
  console.log(`OWNER_ATTENTION_COUNT=${att.attention_required_count}`);
  console.log(`MACOS_DELIVERY_REQUESTS=${m.MACOS_DELIVERY_REQUESTS}`);
  console.log(`MACOS_DELIVERY_ACCEPTED=${m.MACOS_DELIVERY_ACCEPTED}`);
  console.log(`MACOS_DELIVERY_FAILED=${m.MACOS_DELIVERY_FAILED}`);

  for (const file of [
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
