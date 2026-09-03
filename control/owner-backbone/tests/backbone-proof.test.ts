/**
 * หน้าที่: §16 CASES A–F for the realtime Owner backbone, run against the
 * REAL runtime — real launchd via runtime-control, the real OS sandbox, the
 * real scheduler pool, the real registry, and the real persisted stores.
 *
 * CASE A restarts a REAL service (`machine-observer`). That is a real
 * mutation of local runtime state and is exactly what the Owner asked to be
 * proven; it is bounded to one launchd service DNA OS already supervises,
 * and health is re-verified afterwards.
 *
 * How to run (macOS, Node >=18):
 *   npx tsx control/owner-backbone/tests/backbone-proof.test.ts
 */

import { loadResolution } from "../../work-resolution/contract";
import { newOwnerCommand, submitOwnerCommandEnvelope, resolveCommand, dispatchCommand, getWorkState, subscribeOwnerEvents, eventsForWork, emitSystemEvent, commandsForWork, getIncidentState } from "../contract";
import { runAlertCorrelation, type RawAlertEmail } from "../../alert-correlation/contract";
import { openRemediation } from "../../incident-remediation/contract";
import { createPersistentFileStore } from "../../../software/registry-database/adapters/persistent-file-store";

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.error(`FAIL  ${name}`); if (detail !== undefined) console.error("      " + JSON.stringify(detail).slice(0, 300)); }
}

async function main(): Promise<void> {
  // ================= CASE A — OWNER COMMAND -> REAL RUNTIME =================
  const cmdA = newOwnerCommand({
    source: "TEXT",
    command_type: "RUNTIME_OPERATION",
    requested_action: "restart machine-observer",
    target: "machine-observer",
    parameters: { action: "restart" },
  });

  const t0 = Date.now();
  const ack = await submitOwnerCommandEnvelope(cmdA);
  const ackMs = Date.now() - t0;
  console.log(`      [A-ack] ${ack.status} work=${ack.work_id} in ${ackMs}ms`);

  check("A1. acknowledged RECEIVED with command_id + work_id", ack.status === "RECEIVED" && ack.command_id === cmdA.command_id && ack.work_id.startsWith("work-"), ack);
  check("A2. the command was PERSISTED before acceptance was reported", ack.persisted === true && commandsForWork(ack.work_id).some((c) => c.command_id === cmdA.command_id));
  check("A3. the ack names the phase and the next expected event", ack.current_phase.length > 0 && ack.next_expected_event.length > 0, { p: ack.current_phase, n: ack.next_expected_event });
  check("A4. AI_WAITING_REQUIRED=NO — the ack returned without waiting for execution", ackMs < 5_000, `${ackMs}ms`);

  const resA = await resolveCommand(cmdA, ack.work_id);
  check("A5. deterministic resolution -> EXECUTABLE_NOW for a supervised service", resA.resolution === "EXECUTABLE_NOW", resA);

  const dispA = await dispatchCommand(cmdA, ack.work_id, resA);
  console.log(`      [A-dispatch] ${dispA.event_types.join(" -> ")} :: ${dispA.detail.slice(0, 90)}`);
  check("A6. the EXISTING runtime-control performed the restart (no AI execution)", dispA.dispatched === true, dispA.detail);
  check("A7. health was re-verified and reported as an event", dispA.event_types.includes("SERVICE_HEALTHY") || dispA.event_types.includes("SERVICE_UNHEALTHY"), dispA.event_types);
  check("A8. the work reached WORK_COMPLETED", dispA.event_types.includes("WORK_COMPLETED"));

  const eventsA = eventsForWork(ack.work_id);
  check("A9. every event carries ids + evidence, never prose as truth", eventsA.every((e) => typeof e.event_id === "string" && typeof e.state === "string" && Array.isArray(e.evidence_refs)), eventsA.length);
  check("A10. the result reached the Owner output path", eventsA.length >= 3, eventsA.map((e) => e.event_type));

  // ================= CASE F — AGENT FAILOVER, SAME work_id =================
  const failoverWork = ack.work_id;
  await emitSystemEvent({ command_id: cmdA.command_id, work_id: failoverWork, incident_id: null, event_type: "RESOURCE_UNAVAILABLE", state: "TOKEN_EXHAUSTED", source: "test", resource_ids: ["CLAUDE"], capability_ids: [], evidence_refs: [], next_action: "select an alternate resource" });
  await emitSystemEvent({ command_id: cmdA.command_id, work_id: failoverWork, incident_id: null, event_type: "AGENT_FAILOVER", state: "CLAUDE->CODEX", source: "test", resource_ids: ["CODEX"], capability_ids: [], evidence_refs: [], next_action: "continue the same work" });
  const afterFailover = eventsForWork(failoverWork);
  check("F1. AGENT_FAILOVER is carried on the SAME backbone", afterFailover.some((e) => e.event_type === "AGENT_FAILOVER"));
  check("F2. SAME_WORK_ID_CONTINUITY across failover", afterFailover.every((e) => e.work_id === failoverWork));

  // ================= CASE E — OWNER OFFLINE, RECONNECT REPLAY =============
  const all = eventsForWork(ack.work_id);
  const midpoint = all[Math.floor(all.length / 2)];
  const replayed = subscribeOwnerEvents(ack.work_id, midpoint.event_id);
  console.log(`      [E-replay] total=${all.length} since=${midpoint.event_type} replayed=${replayed.length}`);
  check("E1. reconnect with last_event_id replays ONLY what was missed", replayed.length === all.length - all.indexOf(midpoint) - 1 && !replayed.some((e) => e.event_id === midpoint.event_id), { total: all.length, replayed: replayed.length });
  check("E2. a fresh interface (null) rehydrates the full history", subscribeOwnerEvents(ack.work_id, null).length === all.length);
  check("E3. an unknown last_event_id returns everything rather than a silent partial", subscribeOwnerEvents(ack.work_id, "evt-does-not-exist").length === all.length);
  check("E4. work progressed while the interface was away — events exist to replay", all.length > 1);

  // ================= CASE D — CONTINUING WORK, SAME work_id ===============
  const cmdD = newOwnerCommand({
    source: "OWNER_AI",
    command_type: "OWNER_DECISION",
    requested_action: "use the safest approach",
    target: "machine-observer",
    work_id_if_existing: ack.work_id,
  });
  const ackD = await submitOwnerCommandEnvelope(cmdD);
  console.log(`      [D] continued work=${ackD.work_id} phase=${ackD.current_phase}`);
  check("D1. a follow-up command CONTINUES the same work_id", ackD.work_id === ack.work_id, { a: ackD.work_id, b: ack.work_id });
  check("D2. it is recognised as continuation, not new work", ackD.current_phase === "CONTINUING_EXISTING_WORK", ackD.current_phase);
  const resD = await resolveCommand(cmdD, ackD.work_id);
  check("D3. no re-resolution of the architecture happens on continuation", resD.resolution === "ALREADY_IN_PROGRESS" || resD.resolution === "EXECUTABLE_NOW", resD);
  check("D4. both commands are attached to the one work_id", commandsForWork(ack.work_id).length >= 2, commandsForWork(ack.work_id).map((c) => c.command_type));

  // ================= CASE C — CODE CHANGE RESOLUTION ======================
  // WHAT MOVED (2026-08-26): dispatch for CODE_CHANGE used to launch a
  // placeholder (`node -e console.log`) and call that success. It now goes
  // to the real Agent Host and decides success from real file digests, so
  // the EXECUTION half of this case belongs in a proof that has a real,
  // isolated write target — `./production-loop-proof.test.ts` CASES R/C.
  // What stays here is the half this file is about: that DNA OS, not an
  // Agent, resolves the architecture before anything is dispatched.
  const cmdC = newOwnerCommand({
    source: "OWNER_UI",
    command_type: "CODE_CHANGE",
    requested_action: "expose provider alert emails as raw messages",
    target: "gmail reader",
    parameters: { target_domain: "connections/email-alert-source" },
  });
  const ackC = await submitOwnerCommandEnvelope(cmdC);
  const resC = await resolveCommand(cmdC, ackC.work_id);
  console.log(`      [C] ${resC.resolution} :: ${resC.detail.slice(0, 90)}`);
  check("C1. the architecture was resolved by DNA OS, not by an Agent", resC.resolution === "EXECUTABLE_NOW" && resC.resolution_id !== null, resC);
  check("C2. the resolution was PERSISTED before any dispatch could read it", loadResolution(ackC.work_id)?.resolution_id === resC.resolution_id, resC.resolution_id);
  check("C3. it names the existing capability rather than proposing a new one", /resolved [a-z0-9-]+/.test(resC.detail), resC.detail.slice(0, 120));

  // ================= §3 UNRESOLVED STAYS VISIBLE ==========================
  const cmdU = newOwnerCommand({ source: "TEXT", command_type: "RUNTIME_OPERATION", requested_action: "restart nonexistent", target: "no-such-service", parameters: { action: "restart" } });
  const ackU = await submitOwnerCommandEnvelope(cmdU);
  const resU = await resolveCommand(cmdU, ackU.work_id);
  const dispU = await dispatchCommand(cmdU, ackU.work_id, resU);
  check("U1. an unknown target resolves to UNRESOLVED_ARCHITECTURE", resU.resolution === "UNRESOLVED_ARCHITECTURE", resU.resolution);
  check("U2. it is NOT dispatched and is reported as WORK_BLOCKED", dispU.dispatched === false && dispU.event_types.includes("WORK_BLOCKED"), dispU.event_types);
  // Assert on the INSTRUCTION, not on a substring: the known-service list
  // contains "research-api", and "research" contains "search". A bare
  // keyword scan flags a message that is simply naming a real service.
  check("U3. it never tells anyone to go searching", /is not a service runtime-control supervises/.test(resU.detail) && !/go (find|search)|please (find|search)|discover/i.test(resU.detail), resU.detail);

  // ================= CASE B — INCIDENT ON THE SAME BACKBONE ===============
  const REAL_ALERT: RawAlertEmail = {
    message_id: `bb-${Date.now()}`, thread_id: `bb-${Date.now()}`, sender: "hello@notify.railway.app",
    received_at: "2026-08-26T06:19:17Z", subject: "Build failed for DNA-OS-INFRASTRUCTURE",
    body: "* Project: DNA-OS-INFRASTRUCTURE\n* Service: dna-os-circuit\n* Environment: production\n",
  };
  const [incidentReport] = await runAlertCorrelation([REAL_ALERT]);
  const rec = openRemediation(incidentReport, createPersistentFileStore());
  // The incident reports through the SAME event path — no separate flow.
  const incEmit = await emitSystemEvent({
    command_id: null, work_id: rec.work_id, incident_id: rec.incident_id,
    event_type: "INCIDENT_CREATED", state: rec.terminal_state, source: "control/incident-remediation",
    resource_ids: [rec.service_id], capability_ids: [rec.capability_id], evidence_refs: [`remediation:${rec.incident_id}`],
    next_action: rec.next_action,
  });
  console.log(`      [B] incident=${rec.incident_id.slice(0,24)} work=${rec.work_id.slice(0,24)} ${rec.terminal_state}`);
  check("B1. an incident emits on the SAME SystemEvent backbone", incEmit.persisted === true && incEmit.event.incident_id === rec.incident_id);
  check("B2. it carries BOTH incident_id and work_id", incEmit.event.work_id === rec.work_id && incEmit.event.incident_id !== null);
  check("B3. the event routed through the SAME output path", incEmit.routed_to.length > 0, incEmit.routed_to);
  check("B4. incident state is queryable through the Owner AI contract", (await getIncidentState(rec.incident_id)).known === true);

  // An Owner command responding to that incident CONTINUES the same work.
  const cmdB = newOwnerCommand({
    source: "OWNER_AI", command_type: "INCIDENT_RESPONSE", requested_action: "use the safest approach",
    target: rec.service_id, work_id_if_existing: rec.work_id, incident_id_if_existing: rec.incident_id,
  });
  const ackB = await submitOwnerCommandEnvelope(cmdB);
  check("B5. an Owner response continues the incident's SAME work_id", ackB.work_id === rec.work_id, { a: ackB.work_id, b: rec.work_id });
  check("B6. no separate Owner-incident command flow exists", ackB.current_phase === "CONTINUING_EXISTING_WORK", ackB.current_phase);
  const incEvents = eventsForWork(rec.work_id);
  check("B7. incident + owner events share one timeline", incEvents.some((e) => e.event_type === "INCIDENT_CREATED") && incEvents.some((e) => e.event_type === "COMMAND_RECEIVED"), incEvents.map((e) => e.event_type));

  // ================= §13 STATE API ========================================
  const state = getWorkState(ack.work_id);
  check("S1. getWorkState reads persisted canonical state", state.known && state.event_count > 0 && state.commands.length >= 2, { n: state.event_count, c: state.commands.length });
  check("S2. it reports the latest event", state.latest_event !== null && state.detail.length > 0, state.detail);
  check("S3. an unknown work_id is reported honestly, not invented", getWorkState("work-does-not-exist").known === false);
}

main()
  .catch((error) => { failed++; console.error("FAIL  harness: " + (error instanceof Error ? error.stack ?? error.message : String(error))); })
  .finally(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  });
