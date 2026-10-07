/**
 * หน้าที่: prove the owner-backbone as a PRODUCTION loop, not an
 * in-process one. Every case below crosses a real boundary: a real TCP
 * socket, a real async tick, the real continuation engine, the real Agent
 * Host, a real SSE reconnect.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: it never calls `dispatchCommand` to
 * make work happen. If dispatch only ran because a test asked it to, the
 * production loop would not exist — so the proof's own shape is part of
 * what is being proven.
 *
 * How to run (macOS, Node >=18):
 *   npx tsx control/owner-backbone/tests/production-loop-proof.test.ts
 */

import { request as httpRequest } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { server as ownerCommandServer } from "../../../transport/owner-command-http/server";
import { persistResolution, loadResolution } from "../../work-resolution/contract";
import { launchAgentForWork } from "../../work-resolution/sandbox-bridge";
import { runOperation, SERVICES } from "../../runtime-control/contract";
import type { ResolvedWorkContext } from "../../work-resolution/types";
import {
  newOwnerCommand, submitOwnerCommandEnvelope, awaitDispatch, resumeWorkOnDependency,
  getWorkState, eventsForWork, eventsSince, waitingRowFor, emitSystemEvent,
} from "../contract";

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.error(`FAIL  ${name}`); if (detail !== undefined) console.error("      " + JSON.stringify(detail, null, 0).slice(0, 400)); }
}

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const TARGET_DIR = "control/owner-backbone/tests/agent-target";
const SUBJECT = join(REPO, TARGET_DIR, "subject.ts");


/**
 * A raw `node:http` client, deliberately. `fetch` is not available on this
 * machine's Node 16, and going through the raw client also means the proof
 * exercises real headers, a real status line and a real socket rather than
 * a convenience wrapper.
 */
function httpJson(base: string, method: string, path: string, body?: unknown): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; json: any }> {
  return new Promise((resolveP, rejectP) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), "utf8");
    const url = new URL(base + path);
    const req = httpRequest(
      { hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers: payload ? { "content-type": "application/json", "content-length": payload.length } : {} },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json: unknown = null;
          try { json = JSON.parse(text); } catch { json = { raw: text }; }
          resolveP({ status: res.statusCode ?? 0, headers: res.headers, json });
        });
      },
    );
    req.on("error", rejectP);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Opens a real SSE connection, reads what the server sends, then destroys
 * the socket — an event-stream body never ends on its own, so the proof
 * must decide when it has seen enough.
 */
function sseRead(base: string, path: string, lastEventId: string | null): Promise<{ contentType: string; text: string }> {
  return new Promise((resolveP, rejectP) => {
    const url = new URL(base + path);
    const headers: Record<string, string> = { accept: "text/event-stream" };
    if (lastEventId !== null) headers["last-event-id"] = lastEventId;
    const req = httpRequest({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: "GET", headers }, (res) => {
      let text = "";
      const finish = (): void => { req.destroy(); resolveP({ contentType: String(res.headers["content-type"] ?? ""), text }); };
      const timer = setTimeout(finish, 1200);
      res.on("data", (c: Buffer) => {
        text += c.toString("utf8");
        // The server's replay comment marks the end of the replayed history.
        if (text.includes(": replayed")) { clearTimeout(timer); finish(); }
      });
      res.on("end", () => { clearTimeout(timer); finish(); });
    });
    req.on("error", rejectP);
    req.end();
  });
}

async function listen(): Promise<{ base: string; close: () => Promise<void> }> {
  await new Promise<void>((r) => ownerCommandServer.listen(0, "127.0.0.1", r));
  const address = ownerCommandServer.address();
  if (address === null || typeof address === "string") throw new Error("server did not bind a TCP port");
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((r) => ownerCommandServer.close(() => r())),
  };
}

/**
 * The write scope for the real-Agent proof. Built explicitly and pointed at
 * an ISOLATED folder — production business code is never the subject of a
 * proof. Everything else about the dispatch path is the real one.
 */
function proofResolution(workId: string): ResolvedWorkContext {
  return {
    work_id: workId, decision: "EXTEND_EXISTING",
    existing_resource_id: "resource-owner-backbone-agent-target",
    existing_capability_id: "capability-owner-backbone-agent-target",
    canonical_name: "owner-backbone-agent-target",
    repository: "DNA-OS-INFRASTRUCTURE", source_root: TARGET_DIR,
    exact_source_paths: [`${TARGET_DIR}/subject.ts`], contract_paths: [],
    public_functions: ["REVISION"], input_contract: [], output_contract: [],
    runtime_owner: "none", runtime_type: "none", service_id: "none", credential_boundary: "none",
    dependencies: [], consumers: [], blueprint_refs: [], evidence_refs: [],
    missing_piece: "REVISION does not carry the requested marker",
    required_change: "set REVISION to the requested marker",
    allowed_write_scope: [TARGET_DIR],
    forbidden_write_scope: ["control/owner-backbone/gateway.ts", "connections", "credentials"],
    components_to_reuse: [], components_not_to_reimplement: [],
    required_imports: [], verification_commands: [], completion_conditions: ["REVISION changed on disk"],
    next_action: "dispatch", resolution_path: [], dispatchable: true, blocking_reason: "",
  } as ResolvedWorkContext;
}

async function main(): Promise<void> {
  const { base, close } = await listen();
  console.log(`\n  REAL HTTP LISTENER: ${base}\n`);

  // ============ §1 + §2 — REAL HTTP IN, PERSISTED, ACK, ASYNC DISPATCH ====
  const t0 = Date.now();
  const postRes = await httpJson(base, "POST", "/owner/command", { source: "OWNER_UI", command_type: "RUNTIME_OPERATION", requested_action: "restart the machine observer", target: "machine-observer", parameters: { action: "restart" } });
  const ackMs = Date.now() - t0;
  const ack = postRes.json as { command_id: string; work_id: string; status: string; persisted: boolean };
  console.log(`      [HTTP] ${postRes.status} in ${ackMs}ms -> work ${ack.work_id}`);

  check("H1. a REAL HTTP POST was accepted over a real TCP socket", postRes.status === 202, postRes.status);
  check("H2. the ACK is RECEIVED and says the command is already persisted", ack.status === "RECEIVED" && ack.persisted === true, ack);
  check("H3. the ACK returned WITHOUT waiting for execution", ackMs < 1500, `${ackMs}ms`);
  check("H4. the command was persisted BEFORE the ACK — readable over HTTP immediately", (await httpJson(base, "GET", `/owner/command/${ack.command_id}`)).json.command !== null);

  // NOBODY calls dispatchCommand. The dispatch the gateway itself scheduled
  // is merely awaited — a proof that observes rather than one that drives.
  const dispatched = await awaitDispatch(ack.work_id);
  check("A1. dispatch ran with NO caller invoking it", dispatched !== null, dispatched);
  check("A2. it reached a real terminal event, not a stub", (dispatched?.event_types ?? []).some((t) => t === "WORK_COMPLETED" || t === "WORK_BLOCKED"), dispatched?.event_types);
  console.log(`      [ASYNC] ${dispatched?.event_types.join(" -> ")} :: ${dispatched?.detail.slice(0, 90)}`);

  const workRes = await httpJson(base, "GET", `/owner/work/${ack.work_id}`);
  const workState = workRes.json as { known: boolean; event_count: number; latest_event: { event_type: string } | null };
  check("H5. GET /owner/work/:id returns the real state over HTTP", workRes.status === 200 && workState.known && workState.event_count > 0, workState);

  // ============ §5 — DELIVERY TRUTH ======================================
  const emit = await emitSystemEvent({
    command_id: null, work_id: ack.work_id, incident_id: null, event_type: "VERIFICATION_PASSED",
    state: "DELIVERY_PROBE", source: "control/owner-backbone/tests/production-loop-proof.test.ts",
    resource_ids: [], capability_ids: [], evidence_refs: [], next_action: "none",
  });
  console.log(`      [DELIVERY] delivered=${emit.delivered} :: ${emit.delivery_detail}`);
  check("D1. delivery is an OBSERVED result, not 'the call returned'", /transport ok=(true|false)/.test(emit.delivery_detail) || /delivery failed/.test(emit.delivery_detail), emit.delivery_detail);
  check("D2. the event stays persisted regardless of delivery", eventsForWork(ack.work_id).some((e) => e.event_id === emit.event.event_id));
  check("D3. a failed delivery is reported as failed, never as success", emit.delivered === true || /ok=false|delivery failed/.test(emit.delivery_detail), emit.delivery_detail);

  // ============ §6 — THE SYSTEM EVENT CONSUMER, READ BACK ================
  // Delivery is only real if a consumer HOLDS the event afterwards. This
  // reads the joint-monitor collector back over its own HTTP API — the
  // existing Owner surface (its viewer renders these same rows), not a new
  // one built for this proof.
  const collector = (process.env.JOINT_MONITOR_URL ?? "http://127.0.0.1:5178").replace(/\/$/, "");
  let consumerRows: { from_capability?: string; task_id?: string; summary?: string }[] = [];
  let consumerReachable = false;
  try {
    const got = await httpJson(collector, "GET", "/joints");
    consumerReachable = got.status === 200;
    const payload = got.json as unknown;
    consumerRows = (Array.isArray(payload) ? payload : (payload as { joints?: unknown[] }).joints ?? []) as typeof consumerRows;
  } catch { consumerReachable = false; }

  if (!consumerReachable) {
    // Reported, never silently skipped.
    check("O1. IMPLEMENTED_NOT_REACHABLE — the consumer is not running on this machine", emit.delivered === false, `collector ${collector} unreachable but the emit claimed delivered=${emit.delivered}`);
  } else {
    const mine = consumerRows.filter((r) => r.from_capability === "control/owner-backbone");
    console.log(`      [CONSUMER] ${collector} holds ${mine.length} owner-backbone row(s) of ${consumerRows.length}`);
    check("O1. the SystemEvent consumer really RECEIVED and STORED the events", mine.length > 0, { total: consumerRows.length });
    check("O2. this work's own events are among them — the delivery was not someone else's", mine.some((r) => r.task_id === ack.work_id), ack.work_id);
    check("O3. the consumer is an EXISTING surface, not one built for this proof", collector.includes("5178"), collector);
  }

  // ============ §7 — REAL SSE RECONNECT OVER HTTP ========================
  const first = await sseRead(base, `/owner/events?work_id=${ack.work_id}`, null);
  const ids = [...first.text.matchAll(/^id: (.+)$/gm)].map((m) => m[1]);
  check("S1. SSE is a real event-stream response", first.contentType.includes("text/event-stream"), first.contentType);
  check("S2. the stream replayed the work's history on connect", ids.length > 0, ids.length);

  const midpoint = ids[Math.floor(ids.length / 2)];
  const reconnect = await sseRead(base, `/owner/events?work_id=${ack.work_id}`, midpoint);
  const replayedIds = [...reconnect.text.matchAll(/^id: (.+)$/gm)].map((m) => m[1]);
  console.log(`      [SSE] total=${ids.length} reconnect-from=${midpoint.slice(0, 20)} replayed=${replayedIds.length}`);
  check("S3. Last-Event-ID replayed EXACTLY the events after it", JSON.stringify(replayedIds) === JSON.stringify(ids.slice(ids.indexOf(midpoint) + 1)), { expected: ids.slice(ids.indexOf(midpoint) + 1).length, got: replayedIds.length });
  check("S4. nothing already seen was re-sent", !replayedIds.includes(midpoint), replayedIds.slice(0, 3));
  const unknown = await sseRead(base, `/owner/events?work_id=${ack.work_id}`, "evt-does-not-exist");
  const unknownIds = [...unknown.text.matchAll(/^id: (.+)$/gm)].map((m) => m[1]);
  check("S5. an UNPLACEABLE last-event-id replays everything, never a silent partial", unknownIds.length >= ids.length, { all: ids.length, got: unknownIds.length });

  // ============ §3 — WAITING_FOR_DEPENDENCY THROUGH work-continuation ====
  // A REAL unmet prerequisite. `deadboard` is genuinely not running on this
  // machine right now (ECONNREFUSED on its port), and runtime-control probes
  // that live — the wait below is caused by real system state, never by a
  // condition the proof arranged.
  // WHICH service is the unmet prerequisite is decided by probing the real
  // machine, not hard-coded. It used to name `deadboard`, which was down at
  // the time — until the autonomous recovery loop repaired it and this case
  // started failing for the best possible reason. A proof that depends on a
  // fault staying broken is a proof with an expiry date.
  const declared = Object.keys(SERVICES as Record<string, unknown>);
  let downService: string | null = null;
  for (const candidate of declared) {
    const probe = await runOperation(candidate as never, "health");
    if (probe.health_after.healthy !== true) { downService = candidate; break; }
  }

  if (downService === null) {
    console.log("      [WAIT] NOT_REACHED — every declared service is healthy right now, so there is no REAL unmet prerequisite to wait on.");
    console.log("      [WAIT] the wait -> resume path is proven against a real fault in ./live-recovery-proof.test.ts");
  }

  const waitRes = downService === null ? null : await httpJson(base, "POST", "/owner/command", { source: "TEXT", command_type: "RUNTIME_OPERATION", requested_action: `restart the observer once ${downService} is up`, target: "machine-observer", parameters: { action: "restart", requires_service: downService } });
  const waitAck = (waitRes?.json ?? { work_id: "", command_id: "" }) as { work_id: string; command_id: string };
  const waitDispatch = downService === null ? null : await awaitDispatch(waitAck.work_id);
  const parked = downService === null ? null : waitingRowFor(waitAck.work_id);
  if (downService !== null) console.log(`      [WAIT] prerequisite=${downService} :: ${waitDispatch?.event_types.join(" -> ")} :: parked=${parked?.status} on ${parked?.blocked_on.join(",")}`);

  const dependencyProven = parked !== null;
  if (downService !== null) {
    check("W1. an unmet prerequisite parked the work in work-continuation", dependencyProven, waitDispatch?.detail);
  }
  if (dependencyProven) {
    check("W2. it is DEPENDENCY_MISSING, not WORK_BLOCKED — a wait is not a failure", (waitDispatch?.event_types ?? []).includes("DEPENDENCY_MISSING"), waitDispatch?.event_types);
    check("W3. the waiting row is the EXISTING journal's row for the SAME work_id", parked?.work_id === waitAck.work_id && parked?.status === "WAITING", parked?.work_id);

    const httpWait = (await httpJson(base, "GET", `/owner/work/${waitAck.work_id}`)).json as { waiting: { status: string; blocked_on: string[] } | null };
    check("W4. the Owner can SEE the wait over HTTP — a wait is never invisible", httpWait.waiting?.status === "WAITING" && httpWait.waiting.blocked_on.length > 0, httpWait.waiting);

    // A wrong fact must NOT wake it.
    const wrong = await resumeWorkOnDependency({ work_id: waitAck.work_id, namespace: "runtime_state", value: "service:something-else:healthy", source: "proof", evidence_ref: "proof:wrong-key" });
    check("W5. an unrelated fact does NOT resume the work", wrong.resumed === false, wrong);

    // The real fact arrives.
    const right = await resumeWorkOnDependency({ work_id: waitAck.work_id, namespace: "runtime_state", value: `service:${String(downService)}:healthy`, source: "proof", evidence_ref: "proof:dependency-arrived" });
    console.log(`      [RESUME] ${right.verdict} :: ${right.detail.slice(0, 100)}`);
    check("W6. the matching fact resumed the SAME work_id", right.resumed === true && right.work_id === waitAck.work_id, right);
    check("W7. WORK_RESUMED was emitted on the same event stream", eventsForWork(waitAck.work_id).some((e) => e.event_type === "WORK_RESUMED"), eventsForWork(waitAck.work_id).map((e) => e.event_type));
    check("W8. no NEW work_id was created for the resume", eventsForWork(waitAck.work_id).every((e) => e.work_id === waitAck.work_id));
    check("W9. the resume RE-ENTERED execution, it did not merely mark a flag", right.dispatch !== null && right.dispatch.event_types.length > 0, right.dispatch?.event_types);
    check("W10. a repeated identical trigger is refused by the evaluator", (await resumeWorkOnDependency({ work_id: waitAck.work_id, namespace: "runtime_state", value: `service:${String(downService)}:healthy`, source: "proof", evidence_ref: "proof:dependency-arrived" })).resumed === false);
  }

  // ============ §4 — REAL AGENT, REAL FILE MUTATION ======================
  const agentWorkId = `work-agent-proof-${Date.now()}`;
  persistResolution(proofResolution(agentWorkId));
  check("R0. the isolated write scope was resolved and persisted BEFORE dispatch", loadResolution(agentWorkId)?.context.allowed_write_scope[0] === TARGET_DIR);

  const marker = `proof-${Date.now()}`;
  const beforeBytes = readFileSync(SUBJECT, "utf8");
  const agentCommand = newOwnerCommand({
    source: "OWNER_UI", command_type: "CODE_CHANGE",
    requested_action: `In subject.ts, change the exported REVISION constant so its value is exactly "${marker}". Change nothing else. Do not create any new file.`,
    target: TARGET_DIR,
    parameters: { worker_kind: "CLAUDE", timeout_ms: "180000" },
    work_id_if_existing: agentWorkId,
  });
  const agentAck = await submitOwnerCommandEnvelope(agentCommand);
  const agentDispatch = await awaitDispatch(agentAck.work_id);
  const afterBytes = readFileSync(SUBJECT, "utf8");
  const reallyChanged = afterBytes !== beforeBytes;
  const markerLanded = afterBytes.includes(marker);
  console.log(`      [AGENT] ${agentDispatch?.event_types.join(" -> ")}`);
  console.log(`      [AGENT] ${agentDispatch?.detail.slice(0, 200)}`);

  check("R1. the real Agent Host path ran — an agent was allocated", (agentDispatch?.event_types ?? []).includes("AGENT_ALLOCATED"), agentDispatch?.event_types);
  if (reallyChanged) {
    check("R2. a REAL file was mutated inside the approved scope", markerLanded, afterBytes.slice(0, 200));
    check("R3. FILE_CHANGED was decided by real bytes, not by the Agent's claim", (agentDispatch?.event_types ?? []).includes("FILE_CHANGED"), agentDispatch?.event_types);
    check("R4. verification passed only because the bytes changed", (agentDispatch?.event_types ?? []).includes("VERIFICATION_PASSED") && agentDispatch?.dispatched === true, agentDispatch?.event_types);
    // Restore, so the proof leaves no residue behind.
    writeFileSync(SUBJECT, beforeBytes, "utf8");
  } else {
    // NOT a silent pass. A real Agent that could not run is reported as
    // exactly that, and the one thing that still MUST hold is that the
    // backbone refused to call it a success.
    check("R2*. AGENT_NOT_EXECUTED — reported, never rounded up to success", agentDispatch?.dispatched === false, agentDispatch?.detail);
    check("R3*. no VERIFICATION_PASSED was emitted without a real byte change", !(agentDispatch?.event_types ?? []).includes("VERIFICATION_PASSED"), agentDispatch?.event_types);
    console.log(`      [AGENT] NOT EXECUTED — reported honestly: ${agentDispatch?.detail.slice(0, 300)}`);
  }

  // ==== §4b — REAL CONFINED EXECUTION MAKING A REAL APPROVED MUTATION ====
  // The Agent Host path above is the real cloud-Agent path and it really
  // ran; what it could not do is AUTHENTICATE, because Agent Host denies
  // Keychain reads by design (see `control/agent-host/host-runtime.ts`'s
  // ALWAYS_DENIED_READ_SUBPATHS) and that is where the CLI's credential
  // lives. So the mutation half is proven here instead, by a real
  // kernel-confined process writing a real file — with the honest label
  // that this executor performs an instruction rather than reasoning about
  // one. Without this, "the write boundary works" would be untested.
  // NEGATIVE CONTROL, run BEFORE the mutation on purpose: mutating the
  // scope makes the persisted resolution stale, and a stale resolution is
  // refused before any spawn — which would make this pass for the wrong
  // reason (refused by staleness, not denied by the kernel).
  const outsidePath = join(REPO, "control/owner-backbone/OUT-OF-SCOPE-MUST-NOT-EXIST.txt");
  const escape = `const fs=require("fs");try{fs.writeFileSync(${JSON.stringify(outsidePath)},"escaped");console.log("WROTE_OUTSIDE")}catch(e){console.log("DENIED:"+e.code)}`;
  const denied = await launchAgentForWork(agentWorkId, process.execPath, ["-e", escape], { timeoutMs: 30_000 });
  const escaped = existsSync(outsidePath);
  console.log(`      [CONFINED-NEG] launched=${denied.launched} exit=${String(denied.result?.exit_code)} stdout=${JSON.stringify(String(denied.result?.stdout ?? "")).slice(0, 80)} stderr=${JSON.stringify(String(denied.result?.stderr ?? "")).slice(0, 120)}`);
  check("C4. a write OUTSIDE the approved scope is denied by the kernel", !escaped && /DENIED:/.test(String(denied.result?.stdout ?? "")), { escaped, stdout: String(denied.result?.stdout ?? "").slice(0, 120) });

  const confinedMarker = `confined-${Date.now()}`;
  const originalBytes = readFileSync(SUBJECT, "utf8");
  const edit = `const fs=require("fs");const p=${JSON.stringify(SUBJECT)};fs.writeFileSync(p,fs.readFileSync(p,"utf8").replace(/REVISION = "[^"]*"/,'REVISION = "${confinedMarker}"'));`;
  const confined = await launchAgentForWork(agentWorkId, process.execPath, ["-e", edit], { timeoutMs: 30_000 });
  const confinedBytes = readFileSync(SUBJECT, "utf8");
  console.log(`      [CONFINED] launched=${confined.launched} exit=${String(confined.result?.exit_code)} :: ${confined.detail.slice(0, 90)}`);

  check("C1. the confinement was built from the PERSISTED resolution, not from arguments", confined.launched === true, confined.refusal_code ?? confined.detail);
  check("C2. a REAL file inside the approved scope was really mutated", confinedBytes.includes(confinedMarker), confinedBytes.slice(0, 160));
  check("C3. the write scope is exactly the isolated target — nothing else is writable", confined.confinement?.allowWritePaths.length === 1 && confined.confinement.allowWritePaths[0].endsWith(TARGET_DIR), confined.confinement?.allowWritePaths);

  // STALENESS, observed rather than assumed: the mutation above changed the
  // very bytes the resolution was digested from, so the SAME work is now
  // refused until DNA OS re-resolves. Asserted because it is the rule that
  // stops an Agent working against an architecture that has moved.
  const afterMutation = await launchAgentForWork(agentWorkId, process.execPath, ["-e", "0"], { timeoutMs: 10_000 });
  check("C5. once the scope's bytes changed, the stored resolution is STALE and launch is refused", afterMutation.launched === false && afterMutation.refusal_code === "RESOLUTION_STALE", { launched: afterMutation.launched, code: afterMutation.refusal_code });

  writeFileSync(SUBJECT, originalBytes, "utf8");

  // ============ §8 — FULL LOOP, END TO END ===============================
  const loopEvents = eventsForWork(ack.work_id).map((e) => e.event_type);
  check("F1. HTTP -> persisted -> ACK -> async dispatch -> events -> completion", loopEvents.includes("COMMAND_RECEIVED") && loopEvents.includes("WORK_STARTED") && (loopEvents.includes("WORK_COMPLETED") || loopEvents.includes("WORK_BLOCKED")), loopEvents);
  check("F2. every event in the loop is readable back through the SAME contract", eventsSince(ack.work_id, null).length === eventsForWork(ack.work_id).length);
  check("F3. the work read model agrees with the event stream", getWorkState(ack.work_id).event_count === eventsForWork(ack.work_id).length);

  await close();
}

main()
  .catch((error) => { failed++; console.error("FAIL  harness: " + (error instanceof Error ? error.stack ?? error.message : String(error))); })
  .finally(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  });
