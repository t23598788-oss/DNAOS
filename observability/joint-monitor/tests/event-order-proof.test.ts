/**
 * หน้าที่: live proof for the two real defects found on production task
 * task-28c06350-2645-4f57-917b-3c4540fd3ad0 (Owner, 2026-08-26):
 *
 * 1. ORDERING — that task's five real transitions were displayed
 *    FAILED before VERIFYING, because `../joint-store.ts` stamped every
 *    row with its own arrival time and nothing else, while
 *    `control/agent-gateway/gateway.ts#persistStatus` fires five
 *    unawaited POSTs that land in whatever order the network delivers.
 *    This test makes arrival order deliberately WRONG — the reports are
 *    POSTed in reverse, one at a time so the arrival order is not merely
 *    likely-wrong but certainly-wrong — and asserts the store and the
 *    viewer both reconstruct the real emission order anyway.
 *
 * 2. VIEWER DUPLICATION — the same five rows were redrawn on every
 *    EventSource reconnect, because the snapshot branch appended to the
 *    DOM instead of replacing state. This test runs the REAL inline
 *    viewer script (fetched from the real `GET /`, not a copy of it)
 *    against a minimal DOM stub and delivers the snapshot twice, which
 *    is exactly what a reconnect does.
 *
 * How to run (Node >=18; ../../../.nvmrc pins 24 — under Node 16 there is
 * no global fetch and every POST here fails silently):
 * npx tsx observability/joint-monitor/tests/event-order-proof.test.ts
 */

declare const process: { env: Record<string, string | undefined>; exit(code?: number): never };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };
declare const setTimeout: (fn: () => void, ms: number) => unknown;

const TEST_PORT = 51773;
process.env.JOINT_MONITOR_URL = `http://127.0.0.1:${TEST_PORT}`;
delete process.env.JOINT_MONITOR_SHARED_SECRET;

import { JointStore } from "../joint-store";
import { startJointMonitorServer } from "../server";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The real transition order gateway.ts#persistStatus produces for a failing task (gateway.ts:283..162). */
const REAL_ORDER = ["ROUTING", "POLICY_CHECK", "EXECUTING", "VERIFYING", "FAILED"];
const RUN_ID = "reporter-run-order-proof";
const TASK_ID = "task-order-proof";

/** Occurrence stamps as ../client.ts would produce them: emitted in the real order, one millisecond apart. */
function reportFor(status: string, index: number): Record<string, unknown> {
  return {
    from_capability: "dna-os-circuit",
    to_capability: "agent-gateway",
    task_id: TASK_ID,
    status,
    summary: `task ${TASK_ID} -> ${status}`,
    source: "control/agent-gateway/gateway.ts#persistStatus",
    occurred_at: `2026-08-26T00:00:00.00${index}Z`,
    occurred_seq: index + 1,
    reporter_run_id: RUN_ID,
  };
}

async function run(): Promise<void> {
  console.log("=== observability/joint-monitor/tests/event-order-proof.test.ts ===");

  const store = new JointStore();
  const server = startJointMonitorServer(store, TEST_PORT);
  await sleep(150);

  // 1. Deliver in REVERSE, sequentially — arrival order is now certainly
  // the opposite of the real emission order, the worst case of what the
  // production network did by chance.
  for (let index = REAL_ORDER.length - 1; index >= 0; index--) {
    const response = await fetch(`http://127.0.0.1:${TEST_PORT}/joints`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(reportFor(REAL_ORDER[index], index)) });
    assert(response.status === 200, `report ${REAL_ORDER[index]} accepted, got ${response.status}`);
  }
  console.log("PASS: five reports delivered in deliberately reversed arrival order");

  const stored = (await (await fetch(`http://127.0.0.1:${TEST_PORT}/joints`)).json()) as { joints: { status: string; event_id: string; occurred_at: string; received_at: string; at: string; reporter_run_id: string; occurred_seq: number }[] };
  const mine = stored.joints.filter((row) => row.reporter_run_id === RUN_ID);

  // 2. No duplicates in storage.
  assert(mine.length === 5, `storage holds exactly the five reports, got ${mine.length}`);
  assert(new Set(mine.map((row) => row.event_id)).size === 5, "every stored row has its own event_id — no duplicate rows");
  console.log("PASS: storage holds 5 rows, 5 distinct event_ids, no duplicates");

  // 3. The real emission order is reconstructed despite reversed arrival.
  assert(JSON.stringify(mine.map((row) => row.status)) === JSON.stringify(REAL_ORDER), `GET /joints returns EVENT_OCCURRED_ORDER ${REAL_ORDER.join(" -> ")}, got ${mine.map((row) => row.status).join(" -> ")}`);
  console.log(`PASS: order reconstructed as ${REAL_ORDER.join(" -> ")} from reversed arrival`);
  assert(mine[3].status === "VERIFYING" && mine[4].status === "FAILED", "the exact production symptom is gone: VERIFYING precedes FAILED");
  console.log("PASS: VERIFYING precedes FAILED — the production symptom does not reproduce");

  // 4. Both clocks survive independently and disagree, as they must here.
  const arrivalOrder = [...mine].sort((a, b) => a.received_at.localeCompare(b.received_at)).map((row) => row.status);
  assert(JSON.stringify(arrivalOrder) === JSON.stringify([...REAL_ORDER].reverse()), `received_at still records the real (reversed) arrival order, got ${arrivalOrder.join(" -> ")}`);
  assert(mine.every((row) => row.occurred_at !== row.received_at), "occurred_at and received_at are genuinely different values, not one copied into two fields");
  assert(mine.every((row) => row.at === row.received_at), "legacy `at` still mirrors received_at, so pre-existing readers are unbroken");
  console.log("PASS: occurred_at and received_at are separately retrievable — latency/transport is still measurable");

  // 5. The REAL viewer script, run against a DOM stub, given the snapshot
  // twice — which is exactly what an EventSource reconnect delivers.
  const html = await (await fetch(`http://127.0.0.1:${TEST_PORT}/`)).text();
  const script = html.slice(html.indexOf("<script>") + "<script>".length, html.indexOf("</script>"));

  const rendered: { className: string; textContent: string }[] = [];
  const rowsElement = {
    replaceChildren: (...children: { className: string; textContent: string }[]) => { rendered.length = 0; rendered.push(...children); },
  };
  const statusElement = { textContent: "" };
  const documentStub = {
    getElementById: (id: string) => (id === "rows" ? rowsElement : statusElement),
    createElement: () => ({ className: "", textContent: "" }),
  };
  let viewer: { onmessage?: (msg: { data: string }) => void } = {};
  class EventSourceStub {
    onopen?: () => void;
    onerror?: () => void;
    onmessage?: (msg: { data: string }) => void;
    constructor(_url: string) { viewer = this as { onmessage?: (msg: { data: string }) => void }; }
  }
  new Function("document", "EventSource", script)(documentStub, EventSourceStub);
  assert(typeof viewer.onmessage === "function", "the real viewer script installed its onmessage handler");

  const snapshotFrame = { data: JSON.stringify({ type: "snapshot", snapshot: { recent_joints: mine, recent_violations: [], updated_at: "2026-08-26T00:00:01.000Z" } }) };
  viewer.onmessage!(snapshotFrame);
  const afterFirst = rendered.map((node) => node.textContent);
  assert(afterFirst.length === 5, `viewer shows 5 rows after first connect, got ${afterFirst.length}`);

  viewer.onmessage!(snapshotFrame); // the reconnect
  viewer.onmessage!(snapshotFrame); // and another one
  const afterReconnects = rendered.map((node) => node.textContent);
  assert(afterReconnects.length === 5, `viewer still shows 5 rows after two reconnects, got ${afterReconnects.length}`);
  assert(JSON.stringify(afterFirst) === JSON.stringify(afterReconnects), "the reconnected view is identical to the first — no duplicated rows");
  console.log("PASS: two reconnects re-deliver the same snapshot and the viewer still shows exactly 5 rows");

  // 6. The viewer's own order, top row first, is newest-occurrence-first.
  const viewerStatuses = afterReconnects.map((line) => (line.match(/\((\w+)\)/) ?? [])[1]);
  assert(JSON.stringify(viewerStatuses) === JSON.stringify([...REAL_ORDER].reverse()), `viewer renders newest occurrence first (${[...REAL_ORDER].reverse().join(" -> ")}), got ${viewerStatuses.join(" -> ")}`);
  console.log("PASS: viewer renders EVENT_OCCURRED_ORDER, newest first, not arrival order");

  // 7. A live "change" for a row already on screen must not duplicate it.
  viewer.onmessage!({ data: JSON.stringify({ type: "change", event: { kind: "joint", row: mine[0] } }) });
  assert(rendered.length === 5, `re-delivering an already-shown row as a live change leaves 5 rows, got ${rendered.length}`);
  console.log("PASS: a redelivered live event is deduplicated by event_id");

  server.close();
  console.log("=== ALL event-order-proof.test.ts CASES PASSED ===");
  process.exit(0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
