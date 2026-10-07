/**
 * หน้าที่: §12 CASE A–E — พิสูจน์ว่า "เขียนโค้ดไว้ก่อน แล้วค่อยต่อทีหลัง"
 * เป็นไปไม่ได้จริง ไม่ใช่แค่เขียนไว้ในเอกสาร
 *
 *   A capability ที่ input/output ถูกกำหนดก่อนเขียน แล้วต่อครบ → OPERATIONAL
 *   B มีแต่ source ไม่มี trigger                              → IMPLEMENTED_NOT_REACHABLE
 *   C มี input แต่ output ไม่มีผู้บริโภค                        → OUTPUT_UNCONSUMED
 *   D dependency ที่ขาดมาทีหลัง → งาน work_id เดิมถูกปลุก
 *   E work item ของ work-coordination transition → checkpoint ถาวร → ฆ่า process → กลับมาได้
 *
 * Input: none — ใช้ journal และ repo root ของตัวเองใน scratchpad
 * Output: exit 0 เมื่อครบ, exit 1 เมื่อไม่ครบ
 * Dependency ที่อนุญาต: Node built-ins + contract ของ capability-creation /
 * work-session-state / work-coordination / work-continuation
 * สิ่งที่ห้ามแตะ:
 * - ห้ามให้เคส B/C ผ่านด้วยการอ่อนข้อ — ทั้งสองต้องถูก **ปฏิเสธ**
 * - ห้ามเขียน evaluator ของตัวเองในเคส D — ต้องเรียก
 *   `control/work-continuation/#evaluate` ตัวจริง
 * - ห้ามเขียนลง local-runtime หรือ repo จริง
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REAL_REPO = process.cwd();
const root = mkdtempSync(join(tmpdir(), "creation-gate-"));
const fakeRepo = join(root, "repo");
mkdirSync(fakeRepo, { recursive: true });
process.env.WORK_SESSION_STATE_ROOT = root;
process.env.CAPABILITY_CREATION_REPO_ROOT = fakeRepo;
const env = { ...process.env, WORK_SESSION_STATE_ROOT: root, CAPABILITY_CREATION_REPO_ROOT: fakeRepo };

const checks: { part: string; name: string; ok: boolean; detail: string }[] = [];
const check = (part: string, name: string, ok: boolean, detail: string): void => { checks.push({ part, name, ok, detail }); };

const cc = require(resolve(REAL_REPO, "control/capability-creation/contract.ts")) as typeof import("../contract");
const wss = require(resolve(REAL_REPO, "control/work-session-state/contract.ts")) as typeof import("../../work-session-state/contract");

type Contract = import("../types").CapabilityCreationContract;

function contractFor(name: string, over: Partial<Contract> = {}): Contract {
  return {
    capability_name: name, owner_domain: "SOFTWARE_CONTROL_PLANE", repository: "DNA-OS-INFRASTRUCTURE",
    capability_root: `control/${name}`, resource_id: cc.UNKNOWN, capability_id: cc.UNKNOWN,
    purpose: "proof capability", execution_owner: "control/agent-gateway",
    input_type: "OwnerCommandEnvelope", input_contract: ["command_id", "intent_text"],
    input_source: "control/command-router/router.ts#routeOwnerCommand",
    trigger_type: "OWNER_COMMAND", trigger_owner: "control/command-router",
    output_type: "CapabilityResult", output_contract: ["status", "evidence_refs"],
    output_consumer: "control/work-result-ingress", output_destination: "control/work-result-ingress/contract.ts#ingestWorkResult",
    runtime_type: "IN_PROCESS", service_id: cc.UNKNOWN, invocation_method: "direct function call through contract.ts",
    required_dependencies: [], credential_boundary: "NONE",
    work_id: `work-${name}`, persistent_state_owner: "control/work-session-state",
    evidence_owner: "control/agent-gateway",
    verification_commands: [`npx tsx control/${name}/tests/proof.ts`], runtime_proof: "a real OWNER_COMMAND reaching it",
    completion_conditions: ["a real consumer received the result"],
    source_of_truth: "control/registry", temporary_or_persistent: "PERSISTENT",
    cleanup_owner: "control/work-session-state", retention_status: "NOT_DECLARED",
    ...over,
  } as Contract;
}

/** Writes a minimal capability folder into the FAKE repo so the gate has something real to look at. */
function writeCapability(name: string, entrySymbol: string, callerPath: string | null): void {
  const dir = join(fakeRepo, "control", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "contract.ts"), `export function ${entrySymbol}(): string { return "ok"; }\n`);
  if (callerPath) {
    const full = join(fakeRepo, callerPath);
    mkdirSync(resolve(full, ".."), { recursive: true });
    writeFileSync(full, `import { ${entrySymbol} } from "../${name}/contract";\nexport const wired = ${entrySymbol};\n`);
  }
}

let aborted = "";
try {
  // ── CASE A ────────────────────────────────────────────────────────────────
  const A = contractFor("proof-cap-a");
  const gateA1 = cc.evaluateCreationContract(A);
  check("CASE A", "the creation contract is complete BEFORE any file is written",
    gateA1.state === "RESOLVED", `${gateA1.state} — ${gateA1.reason}`);

  const packet = cc.buildPreWritePacket(A, {
    components_to_reuse: ["control/work-session-state"], forbidden_components: ["a second checkpoint store"],
    exact_files_allowed: ["control/proof-cap-a/contract.ts"], forbidden_write_scope: ["control/agent-gateway"],
  });
  check("CASE A", "the Agent receives a bounded packet with the architecture already decided",
    packet.instruction === "Implement only this bounded capability." && packet.allowed_write_scope[0] === "control/proof-cap-a" && packet.trigger.startsWith("OWNER_COMMAND"),
    `scope=${packet.allowed_write_scope.join(",")} trigger=${packet.trigger} consumer=${packet.consumer}`);

  writeCapability("proof-cap-a", "runProofCapA", "control/command-router/router.ts");
  mkdirSync(join(fakeRepo, "control/work-result-ingress"), { recursive: true });
  writeFileSync(join(fakeRepo, "control/work-result-ingress/contract.ts"), "export const ingestWorkResult = () => null;\n");

  const gateA2 = cc.evaluateCompletionGate({
    contract: A, entry_symbol: "runProofCapA",
    runtime_invocation_evidence: "observed: control/command-router/router.ts called runProofCapA at 2026-08-26T09:00:00Z",
    registered: { resource_id: "resource-proof-a", capability_id: "capability-proof-a" },
    verification: { ran: true, passed: true, detail: "npx tsx control/proof-cap-a/tests/proof.ts — 1 passed" },
  });
  check("CASE A", "with input, output, routing, registration, runtime invocation and verification all real → OPERATIONAL",
    gateA2.state === "OPERATIONAL" && gateA2.missing.length === 0,
    `${gateA2.state}; ${gateA2.satisfied.length} checks satisfied`);

  // ── CASE B ────────────────────────────────────────────────────────────────
  const B = contractFor("proof-cap-b", { trigger_type: cc.UNKNOWN as never, input_source: cc.UNKNOWN });
  const gateB1 = cc.evaluateCreationContract(B);
  check("CASE B", "a capability with no trigger is BLOCKED before a file is written",
    gateB1.state === "BLOCKED" && gateB1.missing.some((m) => m.blocked_on === "contract_field:trigger_type"),
    `${gateB1.missing.length} missing: ${gateB1.missing.map((m) => m.blocked_on).join(", ")}`);

  writeCapability("proof-cap-b", "runProofCapB", null);
  const gateB2 = cc.evaluateCompletionGate({
    contract: B, entry_symbol: "runProofCapB", runtime_invocation_evidence: null,
    registered: { resource_id: "resource-proof-b", capability_id: "capability-proof-b" },
    verification: { ran: true, passed: true, detail: "tests pass" },
  });
  check("CASE B", "source exists and tests pass, and it is STILL not a capability",
    gateB2.state === "IMPLEMENTED_NOT_REACHABLE" && gateB2.missing.some((m) => m.kind === "INPUT"),
    `${gateB2.state} — ${gateB2.reason}`);
  check("CASE B", "completion is DENIED with the exact missing connection named",
    gateB2.missing.some((m) => m.detail.includes("INPUT_NOT_CONNECTED") || m.detail.includes("IMPLEMENTED_NOT_REACHABLE")),
    gateB2.missing.filter((m) => m.kind === "INPUT" || m.kind === "ROUTING").map((m) => m.detail.slice(0, 100)).join(" | "));

  // ── CASE C ────────────────────────────────────────────────────────────────
  const C = contractFor("proof-cap-c", { output_consumer: "reports/PROOF_CAP_C_REPORT.md", output_destination: "reports/" });
  writeCapability("proof-cap-c", "runProofCapC", "control/command-router/router-c.ts");
  const gateC = cc.evaluateCompletionGate({
    contract: C, entry_symbol: "runProofCapC",
    runtime_invocation_evidence: "observed: real call at 2026-08-26T09:05:00Z",
    registered: { resource_id: "resource-proof-c", capability_id: "capability-proof-c" },
    verification: { ran: true, passed: true, detail: "tests pass" },
  });
  check("CASE C", "input is connected but the output is a report file nobody reads → OUTPUT_UNCONSUMED",
    gateC.state !== "OPERATIONAL" && gateC.missing.some((m) => m.kind === "OUTPUT" && m.detail.includes("OUTPUT_UNCONSUMED")),
    gateC.missing.filter((m) => m.kind === "OUTPUT").map((m) => m.detail.slice(0, 120)).join(" | "));
  check("CASE C", "completion is denied even though every other connection is real",
    gateC.missing.every((m) => m.kind === "OUTPUT"),
    `only missing: ${Array.from(new Set(gateC.missing.map((m) => m.kind))).join(", ")}`);

  // ── CASE D ────────────────────────────────────────────────────────────────
  const workIdD = "work-proof-cap-d";
  cc.recordCreationContract({ work_id: workIdD, capability_name: "proof-cap-d", contract: contractFor("proof-cap-d"), gate: gateB2 });
  const parked = cc.parkMissingConnections(workIdD, gateB2, { resolution_digest: "digest-at-block-time" });
  check("CASE D", "the missing connections are persisted as dependency keys, not as a sentence",
    parked.parked && parked.blocked_on.length > 0 && parked.blocked_on.every((k) => k.includes(":")),
    `blocked_on=${parked.blocked_on.join(", ")}`);

  const wc = require(resolve(REAL_REPO, "control/work-continuation/contract.ts")) as typeof import("../../work-continuation/contract");
  const waiting = wc.currentWaiting().filter((w) => w.work_id === workIdD);
  check("CASE D", "the waiting row is owned by control/work-continuation — no second queue was created",
    waiting.length === 1 && waiting[0].status === "WAITING" && waiting[0].work_id === workIdD,
    `1 waiting row for ${workIdD}, phase ${waiting[0]?.current_phase}`);

  const index = wc.buildIndex(waiting, new Date().toISOString());
  const arrivingKey = parked.blocked_on[0];
  const event = { key: arrivingKey, value: "now available", observed_at: new Date().toISOString(), source: "creation-gate-proof" } as never;
  const woken = wc.affectedWorkIds(index, event);
  check("CASE D", "when the missing dependency later appears, the SAME work_id is the one woken",
    woken.length === 1 && woken[0] === workIdD,
    `event ${arrivingKey} -> ${woken.join(", ")}`);

  const satisfied = new Set(parked.blocked_on);
  const verdict = wc.evaluate(waiting[0], event, satisfied, "digest-at-block-time", null);
  check("CASE D", "the resume decision is made by control/work-continuation's evaluator, not by anything here",
    typeof verdict?.verdict === "string",
    `verdict=${verdict?.verdict} reason=${String((verdict as { reason?: string }).reason ?? "").slice(0, 90)}`);

  // ── CASE E ────────────────────────────────────────────────────────────────
  const coordRoot = join(root, "coordination");
  const wcoord = require(resolve(REAL_REPO, "control/work-coordination/contract.ts")) as typeof import("../../work-coordination/contract");
  const store = wcoord.createCoordinationStore(coordRoot);
  const taskId = `wi-${Date.now().toString(36)}`;
  store.enqueue({ command_id: "cmd-proof-e", task_id: taskId, idempotency_key: `idem-${taskId}`, priority: 1, depends_on: [], resource_lock: [], target_files: [] });
  store.acquire(taskId);
  store.ready(taskId);
  const checkpointE = wss.currentCheckpoint(taskId);
  check("CASE E", "a work-coordination transition writes a durable checkpoint through the existing authority",
    checkpointE !== null && checkpointE.current_phase === "RUNNING" && checkpointE.work_id === taskId,
    `work_id=${taskId} phase=${checkpointE?.current_phase} (no new store: ${wss.journalPath()})`);
  check("CASE E", "the checkpoint uses this store's OWN status vocabulary — no third lifecycle terminology",
    ["QUEUED", "LOCKED", "RUNNING", "COMPLETED", "FAILED"].includes(String(checkpointE?.current_phase)),
    String(checkpointE?.current_phase));

  const recoveredE = execFileSync("npx", ["tsx", "-e", `
    const wss = require("${resolve(REAL_REPO, "control/work-session-state/contract.ts")}");
    const ctx = wss.buildResumeContext(process.argv[1], { repoRoot: "${REAL_REPO}" });
    console.log(JSON.stringify({ work_id: ctx.work_id, phase: ctx.current_phase, next: ctx.next_action, completed: ctx.completed_steps.length }));
  `, taskId], { cwd: REAL_REPO, env, encoding: "utf8" });
  const rE = JSON.parse(recoveredE.trim().split("\n").pop() ?? "{}");
  check("CASE E", "a process that shares nothing with this one resumes the same work item from disk alone",
    rE.work_id === taskId && rE.phase === "RUNNING",
    `work_id=${rE.work_id} phase=${rE.phase} next=${String(rE.next).slice(0, 60)}`);
} catch (error) {
  aborted = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("\n[CAPABILITY CREATION GATE PROOF]");
let last = "";
for (const c of checks) {
  if (c.part !== last) { console.log(`\n  ── ${c.part} ──`); last = c.part; }
  console.log(`  ${c.ok ? "✔" : "✘"} ${c.name}\n      ${c.detail}`);
}
if (aborted) console.log(`\n  ✘ proof aborted: ${aborted}`);
const failed = checks.filter((c) => !c.ok).length + (aborted ? 1 : 0);
console.log(`\nRESULT: ${checks.length - checks.filter((c) => !c.ok).length} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
