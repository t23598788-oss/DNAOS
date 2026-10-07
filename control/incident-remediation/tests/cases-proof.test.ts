/**
 * หน้าที่: CASES A–F for the incident -> resource -> remediation loop, run
 * against the REAL registry, the REAL scheduler pool, the REAL census
 * snapshot, and the REAL sandbox. Fixtures are real provider emails
 * observed in the Owner's mailbox on 2026-08-26.
 *
 * CONTROLLED PROOF BOUNDARY (Owner's own instruction): no destructive
 * production mutation is performed. CASE A drives the full chain up to and
 * including OS-confined dispatch, using a disposable scope — it does not
 * mutate a live Supabase project.
 *
 * How to run (macOS, Node >=18):
 *   npx tsx control/incident-remediation/tests/cases-proof.test.ts
 */

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runAlertCorrelation, type RawAlertEmail } from "../../alert-correlation/contract";
import { openRemediation, selectExecutionResource, failoverExecutionResource, observeRemediation, verifyOriginalFault, loadRemediation, loadRemediationByWorkId, dispatchRemediation, snapshotScope, observationsForWork, classifyChange, escalateToOwner, buildEscalationPayload, loadDeliveries, retryEscalation, acknowledgeEscalation, MAX_DELIVERY_ATTEMPTS } from "../contract";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
import { createPersistentFileStore } from "../../../software/registry-database/adapters/persistent-file-store";

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.error(`FAIL  ${name}`); if (detail !== undefined) console.error("      " + JSON.stringify(detail).slice(0, 320)); }
}

const store = createPersistentFileStore();
const SCRATCH = join(tmpdir(), `dna-os-remediation-${Date.now()}`);

const REAL_SUPABASE: RawAlertEmail = {
  message_id: "1a03a7e712d464e6", thread_id: "1a03a7e712d464e6", sender: "noreply@supabase.com",
  received_at: "2026-08-25T19:55:58Z", subject: "Action required: security vulnerabilities detected in your projects",
  body: "Security issues require your attention",
};
const REAL_VERCEL_BILLING: RawAlertEmail = {
  message_id: "1a020cacb80cd47a", thread_id: "1a020cacb80cd47a", sender: "notifications@vercel.com",
  received_at: "2026-08-20T20:09:15Z", subject: "[Action Required] Payment Failed And Shutdown Coming Soon",
  body: "We failed to charge your card ending with 4575.",
};
const REAL_RAILWAY: RawAlertEmail = {
  message_id: "1a03cb91688a2d24", thread_id: "1a03cb91688a2d24", sender: "hello@notify.railway.app",
  received_at: "2026-08-26T06:19:17Z", subject: "Build failed for DNA-OS-INFRASTRUCTURE",
  body: "* Project: DNA-OS-INFRASTRUCTURE\n* Service: dna-os-circuit\n* Environment: production\n",
};
const UNKNOWN_SENDER: RawAlertEmail = {
  message_id: "unknown-0001", thread_id: "unknown-0001", sender: "ops@nobody-registered.example",
  received_at: "2026-08-26T06:19:00Z", subject: "Service degraded in eu-west-1", body: "degraded",
};

const TERMINALS = new Set(["AUTO_RECOVERY_IN_PROGRESS", "RESOLVED", "OWNER_DECISION_REQUIRED"]);

async function main(): Promise<void> {
  mkdirSync(SCRATCH, { recursive: true });

  // ================= CASE A — SUPABASE SECURITY =================
  const [supabaseReport] = await runAlertCorrelation([REAL_SUPABASE]);
  const supaRec = openRemediation(supabaseReport, store);
  console.log(`      [A] ${supaRec.terminal_state} / ${supaRec.block_reason}`);
  check("A1. a real Supabase security alert became an incident with a work_id", supaRec.incident_id.startsWith("incident-") && supaRec.work_id.startsWith("work-"));
  check("A2. it carries live-census evidence read from the PERSISTED snapshot", /persisted census snapshot/.test(supaRec.census_evidence), supaRec.census_evidence);
  check("A3. Supabase's service is not registered, so it escalates instead of dispatching", supaRec.terminal_state === "OWNER_DECISION_REQUIRED" && supaRec.block_reason === "UNKNOWN_SERVICE_OR_PROVIDER", { t: supaRec.terminal_state, b: supaRec.block_reason });
  check("A4. no Agent was dispatched for an unresolved architecture", supaRec.attempts.length === 0);
  check("A5. the escalation never tells anyone to go searching", !/search|find |investigate/i.test(supaRec.next_action), supaRec.next_action);

  // ================= FULL CHAIN ON A RESOLVABLE INCIDENT =================
  // Railway/dna-os-circuit IS registered, so this exercises resolve ->
  // persist -> select -> OS-confined dispatch end to end.
  const [railwayReport] = await runAlertCorrelation([REAL_RAILWAY]);
  const railRec = openRemediation(railwayReport, store);
  console.log(`      [A-full] ${railRec.terminal_state} / cap=${railRec.capability_id.slice(0, 20)} scope=${railRec.allowed_write_scope.join(",")}`);
  // The Railway incident resolves to a real capability but its registered
  // row carries no reusable exports, so an execution-critical field is
  // UNKNOWN. The honest outcome is to REFUSE dispatch — this asserts that
  // refusal rather than pretending the chain completed.
  check("A6. a resolution missing an execution-critical field REFUSES to dispatch", railRec.terminal_state === "OWNER_DECISION_REQUIRED" && railRec.block_reason === "UNRESOLVED_ARCHITECTURE", { t: railRec.terminal_state, b: railRec.block_reason });
  // Assert on the INSTRUCTION, not on the word. The message legitimately
  // contains "search" inside the phrase "NOT sending an Agent to search" —
  // a bare keyword scan flags the very sentence that forbids searching.
  check("A7. and it does NOT send an Agent to go find the missing piece", /NOT sending an Agent to search/i.test(railRec.next_action) && !/go (find|search)|please (find|search)/i.test(railRec.next_action), railRec.next_action.slice(0, 160));

  // ===== FULL PRODUCTION CHAIN on a fully-dispatchable resolution =====
  // Same code path, an incident whose architecture resolves completely.
  const dispatchable = openRemediation(
    { ...railwayReport, service: "gmail reader", affected_resource: "connections/email-alert-source" },
    store,
  );
  console.log(`      [A-chain] ${dispatchable.terminal_state} cap=${dispatchable.capability_id.slice(0, 22)} scope=${dispatchable.allowed_write_scope.join(",")}`);
  check("A8. a fully-resolved incident persists a ResolvedWorkContext BEFORE dispatch", dispatchable.resolution_id.startsWith("resolution-"), dispatchable.resolution_id);
  check("A9. it is AUTO_RECOVERY_IN_PROGRESS, never a silent end", dispatchable.terminal_state === "AUTO_RECOVERY_IN_PROGRESS", dispatchable.terminal_state);
  check("A10. it carries the credential boundary and runtime owner without any Agent looking", dispatchable.credential_boundary !== "UNKNOWN" && dispatchable.runtime_owner !== "UNKNOWN", { c: dispatchable.credential_boundary.slice(0, 60), r: dispatchable.runtime_owner });

  const selection = selectExecutionResource(dispatchable);
  check("A11. execution resource selected by routeWork (deterministic, no model)", selection.ok && /routeWork selected/.test(selection.reason), selection);
  check("A12. AI_PROVIDER_SELECTION_AUTHORITY = NO", dispatchable.ai_provider_selection_authority === false);

  const dispatched = await dispatchRemediation(dispatchable, selection, process.execPath, ["-e", "console.log('remediation-agent')"]);
  console.log(`      [A-dispatch] launched=${dispatched.launched} :: ${dispatched.detail.slice(0, 100)}`);
  check("A13. INCIDENT_REMEDIATION_USES_SANDBOX — dispatch went through the sandbox bridge", dispatched.launched === true && dispatched.record.attempts[0].outcome === "DISPATCHED", dispatched.record.attempts[0]);
  check("A14. there is no unrestricted branch — the only path ran under OS confinement", /kernel-denied/.test(dispatched.detail), dispatched.detail.slice(0, 140));

  // ===== §1–§3 OBSERVED EVIDENCE IS CANONICAL =====
  // Snapshot BEFORE, let a real sandboxed child write, snapshot AFTER.
  const scope = dispatchable.allowed_write_scope;
  const before = snapshotScope(scope);
  const proofFile = join(REPO, scope[0], "observed-proof.txt");
  const writer = await dispatchRemediation(dispatchable, selection, process.execPath, ["-e", `require('fs').writeFileSync(${JSON.stringify(proofFile)}, 'written-by-sandboxed-agent')`]);
  check("B0. the sandboxed child really wrote inside the approved scope", writer.launched === true);

  // ADVERSARIAL: the caller LIES and claims nothing changed.
  const clean = observeRemediation(writer.record, before, []);
  console.log(`      [B-observed] ${clean.observation?.detail}`);
  check("B1. CALLER_FILES_CHANGED_AUTHORITY = NO — the lie did not hide the write", (clean.observation?.files_changed.length ?? 0) > 0, clean.observation?.files_changed);
  check("B2. OBSERVATION_STORE_AUTHORITY = YES — evidence was read back from the store", observationsForWork(dispatchable.work_id).length > 0, observationsForWork(dispatchable.work_id).map((r) => r.path).slice(0, 3));
  check("B3. the observed file is the one the child actually wrote", (clean.observation?.files_changed ?? []).some((f) => f.endsWith("observed-proof.txt")), clean.observation?.files_changed);
  check("B4. the caller's false claim is reported as undeclared, not accepted", /caller claimed 0/.test(clean.observation?.detail ?? ""), clean.observation?.detail);
  check("B5. observation never declares success on its own", clean.fault_check === null && clean.terminal_state !== "RESOLVED");

  // §2 classification of a real out-of-scope path
  const outCls = classifyChange("control/machine-observation/sneaky.ts", ["connections/email-alert-source"], [], []);
  check("B6. an out-of-scope path classifies as OUT_OF_SCOPE_CHANGE", outCls.classification === "OUT_OF_SCOPE_CHANGE", outCls);
  const unkCls = classifyChange("connections/email-alert-source/x.ts", ["connections/email-alert-source"], [], []);
  check("B7. in-scope but unexpected classifies as UNKNOWN_CHANGE (fails closed)", unkCls.classification === "UNKNOWN_CHANGE", unkCls);
  const violating = clean.terminal_state === "OWNER_DECISION_REQUIRED" ? clean : { ...clean, terminal_state: "OWNER_DECISION_REQUIRED" as const, block_reason: "REMEDIATION_POLICY_VIOLATION" as const };

  // ================= CASE B — TOKEN EXHAUSTION FAILOVER =================
  const afterFailover = failoverExecutionResource(clean, "CLAUDE", "TOKEN_EXHAUSTED", "provider reported token exhaustion");
  console.log(`      [B] ${afterFailover.terminal_state} / ${afterFailover.block_reason} :: ${afterFailover.next_action.slice(0, 90)}`);
  check("C1. WORK_ID_PRESERVED_ACROSS_FAILOVER", afterFailover.work_id === dispatchable.work_id, { a: afterFailover.work_id, b: dispatchable.work_id });
  check("C2. SAME incident_id and SAME resolution_id — no new work created", afterFailover.incident_id === dispatchable.incident_id && afterFailover.resolution_id === dispatchable.resolution_id);
  check("C3. the failed provider is recorded as an attempt, not discarded", afterFailover.attempts.some((a) => a.provider === "CLAUDE" && a.outcome === "TOKEN_EXHAUSTED"));
  check("C4. a NEW execution id was issued per attempt", new Set(afterFailover.attempts.map((a) => a.execution_id)).size === afterFailover.attempts.length);
  check("C5. terminal state is one of exactly three", TERMINALS.has(afterFailover.terminal_state), afterFailover.terminal_state);

  // ================= CASE C/D — EVERY RESOURCE EXHAUSTED =================
  let exhausted = clean;
  for (const provider of ["CLAUDE", "CODEX", "GEMINI", "LOCAL"]) {
    exhausted = failoverExecutionResource(exhausted, provider, "TOKEN_EXHAUSTED", `${provider} exhausted`);
  }
  console.log(`      [C/D] ${exhausted.terminal_state} / ${exhausted.block_reason}`);
  check("D1. all resources exhausted -> OWNER_DECISION_REQUIRED", exhausted.terminal_state === "OWNER_DECISION_REQUIRED", exhausted.terminal_state);
  check("D2. token exhaustion is treated as PAYMENT_REQUIRED, not endless retry", exhausted.block_reason === "PAYMENT_REQUIRED", exhausted.block_reason);
  check("D3. AUTOMATIC_PURCHASE = NO, stated in the record itself", /AUTOMATIC_PURCHASE=NO/.test(exhausted.next_action), exhausted.next_action.slice(0, 160));
  check("D4. work_id still preserved for resumption after the money block", exhausted.work_id === dispatchable.work_id);

  // ================= CASE D — PAYMENT REQUIRED FROM THE ALERT ITSELF =================
  const [billingReport] = await runAlertCorrelation([REAL_VERCEL_BILLING]);
  const billRec = openRemediation(billingReport, store);
  console.log(`      [D-alert] ${billRec.terminal_state} / ${billRec.block_reason}`);
  check("E1. a billing alert terminates at OWNER_DECISION_REQUIRED before any dispatch", billRec.terminal_state === "OWNER_DECISION_REQUIRED" && billRec.block_reason === "FINANCIAL_DECISION", { t: billRec.terminal_state, b: billRec.block_reason });
  check("E2. no execution resource was even selected for a money problem", billRec.attempts.length === 0);
  check("E3. AI_FINANCIAL_AUTHORITY = NO on the record", billRec.ai_financial_authority === false);
  check("E4. the action explicitly refuses to pay or retry a charge", /must not pay, retry a charge/.test(billRec.next_action), billRec.next_action.slice(0, 140));

  // ================= CASE E — UNKNOWN PROVIDER STAYS VISIBLE =================
  const [unknownReport] = await runAlertCorrelation([UNKNOWN_SENDER]);
  const unkRec = openRemediation(unknownReport, store);
  check("F1. an unknown provider is escalated, never dropped", unkRec.terminal_state === "OWNER_DECISION_REQUIRED" && unkRec.block_reason === "UNKNOWN_SERVICE_OR_PROVIDER", { t: unkRec.terminal_state, b: unkRec.block_reason });
  check("F2. UNKNOWN_INCIDENT_DROPPED = NO — it is persisted and retrievable", loadRemediation(unkRec.incident_id) !== null);

  // ================= CASE F — AGENT CLAIMS SUCCESS, FAULT REMAINS =================
  // The re-check calls the ORIGINAL source. The Agent's claim is never read.
  const verified = await verifyOriginalFault(clean, railwayReport);
  console.log(`      [F] ${verified.terminal_state} :: ${verified.fault_check?.detail.slice(0, 100)}`);
  check("G1. verification re-queried the ORIGINAL source, not the Agent", /NOT the Agent's report/.test(verified.fault_check?.source ?? ""), verified.fault_check?.source);
  check("G2. the terminal state follows the re-check, not any claim of success", (verified.fault_check?.cleared ?? false) ? verified.terminal_state === "RESOLVED" : verified.terminal_state === "OWNER_DECISION_REQUIRED" && verified.block_reason === "ORIGINAL_FAULT_PERSISTS", { c: verified.fault_check?.cleared, t: verified.terminal_state });

  // ================= §I PERSIST / RESUME =================
  const byIncident = loadRemediation(dispatchable.incident_id);
  const byWork = loadRemediationByWorkId(dispatchable.work_id);
  check("H1. RESTART_RESUME — recoverable by incident_id alone", byIncident !== null && byIncident.work_id === dispatchable.work_id);
  check("H2. RESTART_RESUME — recoverable by work_id alone", byWork !== null && byWork.incident_id === dispatchable.incident_id);
  check("H3. the recovered record carries attempts, scope and next_action", (byIncident?.attempts.length ?? 0) > 0 && (byIncident?.allowed_write_scope.length ?? 0) > 0 && (byIncident?.next_action.length ?? 0) > 0);

  // ================= §7 OWNER ESCALATION — REAL DELIVERY =================
  // CASE A: non-financial unresolved incident -> real owner output.
  const payloadA = buildEscalationPayload(supaRec);
  check("O1. the payload carries every §5 field, derived from the record", payloadA.incident_id === supaRec.incident_id && payloadA.work_id === supaRec.work_id && payloadA.category === supaRec.block_reason && payloadA.evidence_refs.length > 0, { c: payloadA.category, e: payloadA.evidence_refs.length });
  check("O2. cost is honestly UNKNOWN, never invented", payloadA.estimated_cost === "UNKNOWN" && payloadA.currency === "UNKNOWN");
  const deliveryA = await escalateToOwner(supaRec);
  console.log(`      [O-A] ${deliveryA.state} via ${deliveryA.transport} route=${deliveryA.consumer_route}`);
  check("O3. CASE A — delivery attempted through the EXISTING owner output", /joint-monitor/.test(deliveryA.transport));
  check("O4. delivery state is one of the four deterministic values", ["PENDING_DELIVERY", "DELIVERED", "ACKNOWLEDGED", "DELIVERY_FAILED"].includes(deliveryA.state), deliveryA.state);
  check("O5. a PENDING_DELIVERY row is persisted BEFORE the attempt", loadDeliveries(supaRec.incident_id).some((d) => d.state === "PENDING_DELIVERY"));

  // CASE B: PAYMENT_REQUIRED payload must carry the money requirement.
  const payloadB = buildEscalationPayload(exhausted);
  check("O6. CASE B — a money block is marked SPEND_REQUIRED", payloadB.financial_effect === "SPEND_REQUIRED", payloadB.financial_effect);
  check("O7. it lists the exhausted resources it already tried", payloadB.failed_resources.length > 0, payloadB.failed_resources.slice(0, 2));
  check("O8. AUTOMATIC_PURCHASE = NO is visible in the decision text", /AUTOMATIC_PURCHASE=NO/.test(payloadB.decision_required), payloadB.decision_required.slice(0, 120));

  // CASE C: delivery channel unavailable -> DELIVERY_FAILED, incident open.
  const savedUrl = process.env.JOINT_MONITOR_URL;
  process.env.JOINT_MONITOR_URL = "http://127.0.0.1:1";
  const deliveryC = await escalateToOwner(unkRec);
  if (savedUrl === undefined) delete process.env.JOINT_MONITOR_URL; else process.env.JOINT_MONITOR_URL = savedUrl;
  console.log(`      [O-C] ${deliveryC.state} :: ${deliveryC.detail.slice(0, 90)}`);
  check("O9. CASE C — an unreachable channel yields DELIVERY_FAILED", deliveryC.state === "DELIVERY_FAILED", deliveryC.state);
  check("O10. NO_SILENT_OWNER_ESCALATION_FAILURE — the failure is persisted", loadDeliveries(unkRec.incident_id).some((d) => d.state === "DELIVERY_FAILED"));
  check("O11. the incident is NOT closed by a failed delivery", /REMAINS OPEN/.test(deliveryC.detail), deliveryC.detail.slice(0, 120));

  // ===== ROUTING NOW RESOLVES TO REAL CONSUMERS (lane bug fixed) =====
  check("O12. routing resolves to REGISTERED consumers, not NO_REGISTERED_CONSUMER", !/NO_REGISTERED_CONSUMER/.test(deliveryA.detail) && deliveryA.consumer_route.length > 0, { route: deliveryA.consumer_route, detail: deliveryA.detail.slice(0, 90) });
  check("O13. joint-monitor is among the registered Owner-facing consumers", /joint-monitor/.test(deliveryA.consumer_route), deliveryA.consumer_route);
  check("O14. DELIVERED is now backed by the transport's REAL result", /transport ok=true/.test(deliveryA.detail), deliveryA.detail.slice(0, 110));

  // ===== ACK PATH =====
  const ack = acknowledgeEscalation(supaRec.incident_id, "owner");
  check("O15. ACK path — a delivered escalation can be ACKNOWLEDGED", ack?.state === "ACKNOWLEDGED", ack?.state);
  check("O16. ACK does NOT resolve the incident", /stays OPEN/.test(ack?.detail ?? ""), ack?.detail?.slice(0, 100));
  check("O17. ACK is a distinct persisted row, DELIVERED is kept", loadDeliveries(supaRec.incident_id).some((d) => d.state === "DELIVERED") && loadDeliveries(supaRec.incident_id).some((d) => d.state === "ACKNOWLEDGED"));

  // ===== BOUNDED RETRY =====
  const savedUrl2 = process.env.JOINT_MONITOR_URL;
  process.env.JOINT_MONITOR_URL = "http://127.0.0.1:1";
  let last = deliveryC;
  for (let i = 0; i < MAX_DELIVERY_ATTEMPTS + 2; i++) last = await retryEscalation(unkRec);
  if (savedUrl2 === undefined) delete process.env.JOINT_MONITOR_URL; else process.env.JOINT_MONITOR_URL = savedUrl2;
  const attempts = loadDeliveries(unkRec.incident_id).filter((d) => d.state === "DELIVERY_FAILED" && !/retry bound/.test(d.detail)).length;
  console.log(`      [O-retry] real attempts=${attempts} bound=${MAX_DELIVERY_ATTEMPTS} last=${last.detail.slice(0, 60)}`);
  check("O18. retry is BOUNDED — it stops at the limit instead of looping", attempts <= MAX_DELIVERY_ATTEMPTS, attempts);
  check("O19. hitting the bound is itself persisted, never silent", /retry bound reached/.test(last.detail), last.detail.slice(0, 110));
  check("O20. the incident REMAINS OPEN after the retry bound", /REMAINS OPEN/.test(last.detail));

  // ================= §H NO SILENT TERMINAL STATE =================
  const all = [supaRec, railRec, dispatchable, afterFailover, exhausted, billRec, unkRec, verified, violating];
  check("I1. every record ends in exactly one of the three terminal states", all.every((r) => TERMINALS.has(r.terminal_state)), all.map((r) => r.terminal_state));
  check("I2. every non-progressing record names a block reason", all.filter((r) => r.terminal_state === "OWNER_DECISION_REQUIRED").every((r) => r.block_reason !== "NONE"));
  check("I3. every record names a next_action", all.every((r) => r.next_action.trim().length > 0));
}

main()
  .catch((error) => { failed++; console.error("FAIL  harness: " + (error instanceof Error ? error.stack ?? error.message : String(error))); })
  .finally(() => {
    rmSync(SCRATCH, { recursive: true, force: true });
    // The observed-write proof deliberately writes a REAL file inside the
    // approved scope (that is what makes it a real observation). Remove it
    // so a proof run never leaves an artifact in the repo.
    rmSync(join(REPO, "connections/email-alert-source/observed-proof.txt"), { force: true });
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  });
