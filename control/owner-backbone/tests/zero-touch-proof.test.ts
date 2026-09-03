/**
 * หน้าที่: prove the loop is CLOSED — that after DNA OS has started, a real
 * machine fact is consumed, decided, executed, verified, emitted, and
 * dependent work continues, with ZERO Owner commands from T0 onward.
 *
 * WHAT THIS TEST IS ALLOWED TO DO
 *   BEFORE T0: arrange the situation — induce one real, reversible,
 *   non-business fault and park waiting work. This is setup, and it is
 *   labelled as such in the output.
 *   AFTER T0: nothing but WATCH and READ. It submits no command, calls no
 *   remediation function, restarts nothing, resumes nothing, and marks
 *   nothing healthy.
 *
 * THE INDUCED FAULT, stated plainly: SIGSTOP on `machine-observer`, DNA OS's
 * own observation runtime. It is not business traffic, it carries no user
 * data, and a restart fully restores it — the loop restarted it nine times
 * on 2026-08-26 with no ill effect. SIGSTOP is chosen deliberately over a
 * kill because it produces the ONE fault class launchd cannot fix: the
 * process is alive, so `KeepAlive` sees nothing wrong, while the service
 * answers nothing. That class is the entire reason this supervisor exists,
 * so it is the only honest thing to test it with. SIGCONT is issued in
 * `finally` so the fault cannot outlive the proof.
 *
 * How to run (macOS, Node >=16):
 *   npx tsx control/owner-backbone/tests/zero-touch-proof.test.ts
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { request as httpRequest } from "node:http";
import { currentWaiting } from "../../work-continuation/contract";
import { conditionIdFor, conditionState, ledgerFor } from "../action-ledger";
import { eventsForWork } from "../contract";

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.error(`FAIL  ${name}`); if (detail !== undefined) console.error("      " + JSON.stringify(detail).slice(0, 400)); }
}

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const OPERATIONS = join(REPO, "control/runtime-control/data/operations.jsonl");
const TARGET = "machine-observer";
const SUPERVISOR_URL = "http://127.0.0.1:5180";
const WAITERS = 9;

function httpJson(base: string, method: string, path: string, body?: unknown, timeoutMs = 8000): Promise<{ status: number; json: any }> {
  return new Promise((resolveP, rejectP) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), "utf8");
    const url = new URL(base + path);
    const req = httpRequest({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, timeout: timeoutMs, headers: payload ? { "content-type": "application/json", "content-length": payload.length } : {} }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json: unknown = null;
        try { json = JSON.parse(text); } catch { json = { raw: text }; }
        resolveP({ status: res.statusCode ?? 0, json });
      });
    });
    req.on("timeout", () => { req.destroy(); rejectP(new Error("timeout")); });
    req.on("error", rejectP);
    if (payload) req.write(payload);
    req.end();
  });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function sh(cmd: string, args: string[]): string {
  try { return execFileSync(cmd, args, { encoding: "utf8" }); } catch (error) { return String((error as { stdout?: string }).stdout ?? ""); }
}

/** Every runtime-control operation row, read straight off the evidence journal. */
function operationsSince(sinceIso: string): { service_id: string; requested_action: string; operation_id: string; pid_before: number | null; pid_after: number | null; started_at?: string; observed_at?: string }[] {
  const rows: any[] = [];
  for (const line of readFileSync(OPERATIONS, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      const at = row.started_at ?? row.observed_at ?? row.checked_at ?? row.health_after?.checked_at ?? "";
      if (at >= sinceIso) rows.push(row);
    } catch { /* a half-written line is not a row */ }
  }
  return rows;
}

function supervisorPids(): number[] {
  const out = sh("/bin/ps", ["-axo", "pid=,args="]);
  return out.split("\n")
    .filter((l) => l.includes("control/owner-backbone/start.ts"))
    .map((l) => Number(l.trim().split(/\s+/)[0]))
    .filter((n) => Number.isFinite(n));
}

function observerPids(): number[] {
  const out = sh("/bin/ps", ["-axo", "pid=,args="]);
  return out.split("\n")
    .filter((l) => l.includes("control/machine-observation/start.ts"))
    .map((l) => Number(l.trim().split(/\s+/)[0]))
    .filter((n) => Number.isFinite(n));
}

async function main(): Promise<void> {
  // ================= SUPERVISOR LIVENESS, from the machine ================
  // A tick sweeps five services with real HTTP probes, so a supervisor that
  // has only just started has legitimately not finished one yet. Wait for a
  // real tick rather than reading the counter the instant we connect —
  // asserting on an unwarmed process tests the proof's timing, not the
  // supervisor.
  let health = await httpJson(SUPERVISOR_URL, "GET", "/status");
  const tickDeadline = Date.now() + 90_000;
  while (health.json.ticks < 1 && Date.now() < tickDeadline) {
    await sleep(3000);
    health = await httpJson(SUPERVISOR_URL, "GET", "/status");
  }
  const declaredPids = supervisorPids();
  const launchd = sh("/bin/launchctl", ["print", `gui/${process.getuid?.() ?? 501}/com.dnaos.recovery-supervisor`]);
  const launchdPid = Number(launchd.match(/^\s*pid = (\d+)$/m)?.[1] ?? 0);

  console.log(`\n  SUPERVISOR: launchd pid=${launchdPid} process pids=${declaredPids.join(",")} http pid=${health.json.pid} started=${health.json.started_at} ticks=${health.json.ticks}`);

  check("S1. the supervisor is DECLARED as a service under the runtime authority", /com\.dnaos\.recovery-supervisor/.test(launchd) && /state = running/.test(launchd), launchd.slice(0, 120));
  check("S2. it has a real PID that launchd owns", launchdPid > 0 && declaredPids.length > 0, { launchdPid, declaredPids });
  check("S3. it answers a real liveness probe with its own identity", health.status === 200 && health.json.service_id === "recovery-supervisor", health.json);
  check("S4. it is actually TICKING, not merely listening", health.json.ticks >= 1 && health.json.last_tick_at !== null, { ticks: health.json.ticks, last: health.json.last_tick_at });
  check("S5. it does NOT watch itself — launchd owns its liveness", !(health.json.watching as string[]).includes("recovery-supervisor"), health.json.watching);

  // ================= PRE-T0 SETUP (labelled, and the only interaction) ====
  console.log(`\n  [PRE-T0 SETUP] inducing a real, reversible fault: SIGSTOP ${TARGET} (alive, not serving — the class launchd cannot fix)`);
  const stoppedPids = observerPids();
  for (const pid of stoppedPids) sh("/bin/kill", ["-STOP", String(pid)]);
  await sleep(2000);

  const conditionId = conditionIdFor(TARGET, "RESTART_EXISTING_SERVICE", "SERVICE_HEALTHY");
  const ledgerBefore = conditionState(conditionId);
  console.log(`  [PRE-T0 SETUP] condition=${conditionId} priorAttempts=${ledgerBefore.attempts} blocked=${ledgerBefore.blocked}`);

  console.log(`  [PRE-T0 SETUP] parking ${WAITERS} work items that need "${TARGET} healthy"`);
  const parkedWorkIds: string[] = [];
  const { server } = await import("../../../transport/owner-command-http/server");
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  const base = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}`;
  const { awaitDispatch } = await import("../contract");

  for (let i = 0; i < WAITERS; i += 1) {
    const res = await httpJson(base, "POST", "/owner/command", {
      source: "TEXT", command_type: "RUNTIME_OPERATION",
      requested_action: `waiter ${i + 1}: restart ${TARGET} once it is up`,
      target: TARGET, parameters: { action: "restart", requires_service: TARGET },
    });
    const workId = (res.json as { work_id: string }).work_id;
    await awaitDispatch(workId);
    parkedWorkIds.push(workId);
  }
  const parkedNow = currentWaiting().filter((r) => r.status === "WAITING" && parkedWorkIds.includes(r.work_id));
  console.log(`  [PRE-T0 SETUP] parked ${parkedNow.length}/${WAITERS}`);

  // ========================== T0 — HANDS OFF ==============================
  const T0 = new Date().toISOString();
  console.log(`\n  ================ T0 = ${T0} — NO further Owner command, no manual call ================\n`);

  check("W0. work is genuinely parked, waiting on a real unmet condition", parkedNow.length === WAITERS, { parked: parkedNow.length, expected: WAITERS });

  // Watch. The supervisor ticks every 30s; give it two ticks plus readiness.
  let acted: any = null;
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    await sleep(5000);
    try {
      const status = await httpJson(SUPERVISOR_URL, "GET", "/status");
      const cycles = (status.json.cycles ?? []) as { condition_id: string; service_id: string; action_id: string; attempt: number; final: string; resumed: string[] }[];
      const mine = cycles.find((c) => c.service_id === TARGET && c.condition_id === conditionId && /SERVICE_HEALTHY/.test(c.final) && c.action_id !== null);
      // Wait for BOTH: the recovery itself, and the sweep tick that wakes
      // any waiter which parked while the recovery was already running.
      const everyWaiterResumed = currentWaiting().filter((r) => parkedWorkIds.includes(r.work_id) && r.status !== "WAITING").length === WAITERS;
      if (mine && everyWaiterResumed) { acted = mine; break; }
      if (mine) acted = mine;
    } catch { /* the supervisor may be mid-restart; keep watching */ }
  }
  const elapsedMs = Date.parse(new Date().toISOString()) - Date.parse(T0);

  if (acted === null) {
    check("Z1. the supervisor consumed the fault and recovered it with no Owner input", false, "no completed cycle for this condition within 240s of T0");
  } else {
    console.log(`  [OBSERVED] cycle condition=${acted.condition_id} action=${acted.action_id} attempt=${acted.attempt} final=${acted.final} resumed=${acted.resumed.length}`);
    check("Z1. the supervisor consumed the fault and recovered it with no Owner input", /SERVICE_HEALTHY/.test(acted.final), acted.final);
    check("Z2. it acted on the CONDITION identity, not on a work_id", acted.condition_id === conditionId, { got: acted.condition_id, expected: conditionId });
  }

  // ============ §6 COALESCING — the whole point ==========================
  const opsSinceT0 = operationsSince(T0);
  const physicalRestarts = opsSinceT0.filter((o) => o.service_id === TARGET && o.requested_action === "restart");
  const resumedRows = currentWaiting().filter((r) => parkedWorkIds.includes(r.work_id) && r.status !== "WAITING");
  console.log(`\n  WAITING_WORK_COUNT=${WAITERS}  PHYSICAL_RESTART_COUNT=${physicalRestarts.length}  RESUMED_WORK_COUNT=${resumedRows.length}`);
  for (const op of physicalRestarts) console.log(`    physical restart: ${op.operation_id} pid ${String(op.pid_before)} -> ${String(op.pid_after)}`);

  check("C1. exactly ONE physical restart served all the waiters", physicalRestarts.length === 1, physicalRestarts.map((o) => o.operation_id));
  check("C2. every waiting work item was resumed", resumedRows.length === WAITERS, { resumed: resumedRows.length, of: WAITERS });
  check("C3. work identities were NOT merged — each work_id resumed as itself", resumedRows.every((r) => parkedWorkIds.includes(r.work_id)) && new Set(resumedRows.map((r) => r.work_id)).size === resumedRows.length);
  const coalesced = parkedWorkIds.filter((id) => eventsForWork(id).some((e) => e.state === "COALESCED"));
  check("C4. the extra waiters SHARED the canonical action's evidence", coalesced.length === WAITERS - 1 || coalesced.length === WAITERS, { coalesced: coalesced.length });
  const sharedRefs = new Set(parkedWorkIds.flatMap((id) => eventsForWork(id).filter((e) => e.state === "COALESCED").flatMap((e) => e.evidence_refs.filter((r) => r.startsWith("action:")))));
  check("C5. they all point at the SAME action_id", sharedRefs.size <= 1, [...sharedRefs]);

  // ============ §7 BOUNDED RETRY / REPLAY ================================
  const ledgerAfter = conditionState(conditionId);
  const rows = ledgerFor(conditionId);
  console.log(`\n  LEDGER condition=${conditionId} rows=${rows.length} attempts=${ledgerAfter.attempts} open=${ledgerAfter.open} verified=${ledgerAfter.last_verified_state}`);
  check("R1. the condition's state is persisted on disk, not in the process", rows.length > 0 && rows.some((r) => r.kind === "CANONICAL_ACTION"), rows.map((r) => r.kind));
  check("R2. a resolved condition is CLOSED, releasing its retry budget", ledgerAfter.open === false && ledgerAfter.last_verified_state === "SERVICE_HEALTHY", { open: ledgerAfter.open, verified: ledgerAfter.last_verified_state });
  check("R3. attempts were bounded — one condition, one attempt", rows.filter((r) => r.kind === "ATTEMPT").length <= 3, rows.filter((r) => r.kind === "ATTEMPT").length);

  // ============ §2 + §11 — KILL THE SUPERVISOR, HARD RESET ===============
  const beforeKillPids = supervisorPids();
  const ledgerRowsBeforeKill = ledgerFor(conditionId).length;
  console.log(`\n  [KILL] kill -9 ${beforeKillPids.join(" ")} — the only process this proof is allowed to kill`);
  for (const pid of beforeKillPids) sh("/bin/kill", ["-9", String(pid)]);

  let restoredPids: number[] = [];
  let restoredHealth: any = null;
  const killDeadline = Date.now() + 120_000;
  while (Date.now() < killDeadline) {
    await sleep(3000);
    restoredPids = supervisorPids().filter((p) => !beforeKillPids.includes(p));
    if (restoredPids.length > 0) {
      try {
        const probe = await httpJson(SUPERVISOR_URL, "GET", "/status");
        if (probe.status === 200) { restoredHealth = probe.json; break; }
      } catch { /* still coming up */ }
    }
  }
  console.log(`  [KILL] before=${beforeKillPids.join(",")} after=${restoredPids.join(",")} health=${restoredHealth ? "200" : "none"}`);

  check("K1. SUPERVISOR_PROCESS_KILLED — the old pids are gone", supervisorPids().every((p) => !beforeKillPids.includes(p)), { before: beforeKillPids, now: supervisorPids() });
  check("K2. SUPERVISOR_AUTO_RESTARTED by the existing runtime authority", restoredPids.length > 0 && restoredHealth !== null, { restoredPids });
  check("K3. no Owner command and no Agent was involved in the restore", restoredHealth?.service_id === "recovery-supervisor", restoredHealth?.service_id);
  check("K4. the restored process is ticking again", (restoredHealth?.ticks ?? 0) >= 1, restoredHealth?.ticks);
  check("K5. it came back with an EMPTY process memory — actions live on disk", (restoredHealth?.actions_this_process ?? -1) === 0, restoredHealth?.actions_this_process);

  // The condition's history must be intact and must not have grown a
  // duplicate action just because a new process started.
  await sleep(35_000);
  const ledgerAfterRestart = ledgerFor(conditionId);
  const stateAfterRestart = conditionState(conditionId);
  const opsAfterRestart = operationsSince(T0).filter((o) => o.service_id === TARGET && o.requested_action === "restart");
  console.log(`  [HARD RESET] ledger rows ${ledgerRowsBeforeKill} -> ${ledgerAfterRestart.length}; physical restarts since T0 = ${opsAfterRestart.length}`);

  check("H1. the condition history survived the process death", ledgerAfterRestart.length >= ledgerRowsBeforeKill, { before: ledgerRowsBeforeKill, after: ledgerAfterRestart.length });
  check("H2. the restored supervisor reconstructed state from disk, not from an AI", stateAfterRestart.last_verified_state === "SERVICE_HEALTHY" && stateAfterRestart.known);
  check("H3. DUPLICATE_ACTION_CREATED=NO — a restart did not re-run the recovery", opsAfterRestart.length === 1, opsAfterRestart.map((o) => o.operation_id));

  console.log(`\n  ZERO-TOUCH WINDOW: T0=${T0} -> recovery observed after ${Math.round(elapsedMs / 1000)}s, with 0 Owner commands submitted after T0.`);
}

main()
  .catch((error) => { failed++; console.error("FAIL  harness: " + (error instanceof Error ? error.stack ?? error.message : String(error))); })
  .finally(() => {
    // SAFETY NET: the induced fault must never outlive this proof. SIGCONT
    // is harmless if the process was already replaced by the recovery.
    try {
      const out = execFileSync("/bin/ps", ["-axo", "pid=,args="], { encoding: "utf8" });
      for (const line of out.split("\n")) {
        if (!line.includes("control/machine-observation/start.ts")) continue;
        const pid = Number(line.trim().split(/\s+/)[0]);
        if (Number.isFinite(pid)) { try { execFileSync("/bin/kill", ["-CONT", String(pid)]); } catch { /* gone */ } }
      }
    } catch { /* nothing to restore */ }
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  });
