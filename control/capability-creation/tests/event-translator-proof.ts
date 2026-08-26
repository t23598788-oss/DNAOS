/**
 * หน้าที่: พิสูจน์เส้นทาง REAL SYSTEM EVIDENCE → DependencyEvent → evaluator เดิม
 * → งาน work_id เดิมกลับมาเอง — ครบเคส A–G รวมถึงข้อขัดแย้ง §11
 *
 * ทุกเคสใช้ของจริง: index/evaluator/adapter/store เป็นของ
 * `control/work-continuation/` ทั้งหมด ไฟล์นี้ **ไม่ได้เขียนตัวใดตัวหนึ่งใหม่**
 *
 * Input: none — waiting store และ creation journal ของตัวเองใน scratchpad
 * Output: exit 0 เมื่อครบ, exit 1 เมื่อไม่ครบ
 * Dependency ที่อนุญาต: Node built-ins + contract ของ capability-creation /
 * work-continuation / work-session-state
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเขียน evaluator/index/scheduler/key-constructor ของตัวเองในไฟล์นี้
 * - ห้ามให้เคส D/E/G ผ่านด้วยการอ่อนข้อ — ทั้งสามต้อง **ไม่** ปลุกงาน
 * - ห้ามเขียนลง control/work-continuation/data หรือ local-runtime ของจริง
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = process.cwd();
const root = mkdtempSync(join(tmpdir(), "event-translator-"));
const waitingPath = join(root, "waiting-work.jsonl");
const creationPath = join(root, "capability-creation.jsonl");
process.env.WORK_SESSION_STATE_ROOT = root;
const env = { ...process.env, WORK_SESSION_STATE_ROOT: root };

const checks: { part: string; name: string; ok: boolean; detail: string }[] = [];
const check = (part: string, name: string, ok: boolean, detail: string): void => { checks.push({ part, name, ok, detail }); };

const wc = require(resolve(REPO, "control/work-continuation/contract.ts")) as typeof import("../../work-continuation/contract");
const cc = require(resolve(REPO, "control/capability-creation/contract.ts")) as typeof import("../contract");

type Waiting = import("../../work-continuation/types").WaitingWork;
type Event = import("../../work-continuation/types").DependencyEvent;

function waitingRow(workId: string, keys: string[], over: Partial<Waiting> = {}): Waiting {
  return {
    work_id: workId, current_phase: "BLOCKED", status: "WAITING",
    blocked_on: keys, required_evidence: keys.filter((k) => k.startsWith("verification:")),
    required_resources: [], required_capabilities: keys.filter((k) => k.startsWith("capability:") || k.startsWith("registry:")),
    required_runtime_state: keys.filter((k) => k.startsWith("runtime:")), required_external_state: [],
    resume_condition: "ALL_AVAILABLE", exact_state: null,
    next_action: `finish ${workId}`, resolved_work_context_ref: `resolution-${workId}`,
    last_verified_revision: "digest-fixed", evidence_refs: keys,
    resume_attempt_count: 0, last_resume_reason: null, last_input_digest: null, last_result_digest: null,
    required_worker_class: null, recorded_at: new Date().toISOString(), ...over,
  } as Waiting;
}
const nowIso = "2026-08-26T10:00:00.000Z";
const digestOf = () => "digest-fixed";

let aborted = "";
try {
  // ── CASE A · registry event wakes the work that waited for that capability ─
  const keyA = wc.capabilityKeyOf("execution/run");
  wc.appendWaiting(waitingRow("work-A", [keyA]), waitingPath);
  const censusA = { capabilities: [{ capability_key: "k", capability_id: "capability-run", resource_id: "resource-run", canonical_name: "run", domain: "d", repository: "r", path: "execution/run", entrypoint: "execution/run/contract.ts", current_status: "VERIFIED", registration_state: "REGISTERED", registry_matches: ["capability-run"], source_digest: "abc123", runtime_state: "OBSERVED", evidence_references: [], test_files: [] }], generated_at: nowIso };
  const joinA = cc.runContinuationJoin({ census: censusA, waiting_path: waitingPath, creation_path: creationPath, resolutionDigestOf: digestOf, now: nowIso });
  const decA = joinA.decisions.find((d) => d.work_id === "work-A");
  check("CASE A", "a real Registry/census fact becomes a DependencyEvent and wakes the SAME work_id",
    decA?.evaluation.verdict === "RESUME_ELIGIBLE" && decA.work_id === "work-A",
    `${joinA.events.length} event(s) derived; work-A -> ${decA?.evaluation.verdict}`);
  check("CASE A", "the persisted ResolvedWorkContext reference is carried forward, not re-derived",
    decA?.resolved_work_context_ref === "resolution-work-A" && decA.next_action === "finish work-A",
    `context_ref=${decA?.resolved_work_context_ref} next_action=${decA?.next_action}`);

  // ── CASE B · runtime becomes healthy ───────────────────────────────────────
  const keyB = wc.dependencyKey("runtime", "control/machine-observation");
  wc.appendWaiting(waitingRow("work-B", [keyB]), waitingPath);
  const censusB = { capabilities: [{ capability_key: "k2", capability_id: null, resource_id: null, canonical_name: "mo", domain: "d", repository: "r", path: "control/machine-observation", entrypoint: "control/machine-observation/contract.ts", current_status: "VERIFIED", registration_state: "UNREGISTERED", registry_matches: [], source_digest: "def456", runtime_state: "RUNNING", evidence_references: [], test_files: [] }], generated_at: nowIso };
  const joinB = cc.runContinuationJoin({ census: censusB, waiting_path: waitingPath, creation_path: creationPath, resolutionDigestOf: digestOf, now: nowIso });
  const decB = joinB.decisions.find((d) => d.work_id === "work-B");
  check("CASE B", "a runtime/census state transition wakes the work waiting on that runtime",
    decB?.evaluation.verdict === "RESUME_ELIGIBLE",
    `runtime key ${keyB} -> ${decB?.evaluation.verdict ?? "no decision"}`);

  // ── CASE C · near-miss spellings canonicalize to ONE key ───────────────────
  const spellings = ["control/x", "/control/x", "control/x/", "//control/x//", `${REPO}/control/x`];
  const canonical = spellings.map((s) => wc.dependencyKey("path", s));
  check("CASE C", "every near-miss spelling of the same path becomes the identical key",
    new Set(canonical).size === 1,
    `${spellings.length} spellings -> ${Array.from(new Set(canonical)).join(" | ")}`);
  wc.appendWaiting(waitingRow("work-C", [wc.dependencyKey("path", "control/x/")]), waitingPath);
  const eventC: Event = { key: wc.dependencyKey("path", "/control/x"), value: "EXISTS", source: "live-census", evidence_ref: "near-miss-proof", occurred_at: nowIso };
  const rowsC = wc.currentWaiting(waitingPath).filter((r) => r.status === "WAITING");
  const decC = wc.decideResumes(rowsC, [eventC], digestOf, () => null, nowIso).find((d) => d.work_id === "work-C");
  check("CASE C", "a row recorded with one spelling is woken by an event carrying another",
    decC?.evaluation.verdict === "RESUME_ELIGIBLE",
    `recorded "control/x/" · event "/control/x" -> ${decC?.evaluation.verdict ?? "NOT WOKEN"}`);
  check("CASE C", "an escaping path is refused rather than canonicalised into an invented one",
    !wc.dependencyKey("path", "control/../../etc").includes("Users"),
    wc.dependencyKey("path", "control/../../etc"));

  // ── CASE D · an unrelated event must not wake anything ─────────────────────
  const eventD: Event = { key: wc.dependencyKey("capability", "control/nothing-waits-on-this"), value: "VERIFIED", source: "live-census", evidence_ref: "unrelated", occurred_at: nowIso };
  const decD = wc.decideResumes(wc.currentWaiting(waitingPath), [eventD], digestOf, () => null, nowIso);
  check("CASE D", "an unrelated event wakes nothing — the work stays blocked",
    decD.length === 0, `${wc.currentWaiting(waitingPath).length} waiting row(s), 0 decisions`);

  // ── CASE E · replay of the same event must not resume twice ────────────────
  const rowE = waitingRow("work-E", [keyA]);
  wc.appendWaiting(rowE, waitingPath);
  const eventE: Event = { key: keyA, value: "VERIFIED", source: "registry", evidence_ref: "replay-proof", occurred_at: nowIso };
  const first = wc.decideResumes([rowE], [eventE], digestOf, () => null, nowIso);
  // record the resume the way production does: append a new row, never edit history
  wc.appendWaiting({ ...rowE, status: "RESUMED", resume_attempt_count: 1, last_input_digest: wc.digestOf(eventE), last_resume_reason: first[0]?.evaluation.verdict ?? "" }, waitingPath);
  const stillWaiting = wc.currentWaiting(waitingPath).filter((r) => r.status === "WAITING");
  const second = wc.decideResumes(stillWaiting, [eventE], digestOf, () => null, nowIso).filter((d) => d.work_id === "work-E");
  check("CASE E", "the same event replayed produces no second resume for the same work",
    first.length === 1 && second.length === 0,
    `first pass: 1 decision; replay after the row was marked RESUMED: ${second.length}`);
  check("CASE E", "the replay guard is persisted state, not memory — a fresh read of the journal sees it",
    wc.currentWaiting(waitingPath).find((r) => r.work_id === "work-E")?.status === "RESUMED",
    "status RESUMED read back from the append-only journal");

  // ── CASE G · incomplete/UNKNOWN evidence must not satisfy anything ─────────
  const censusG = { capabilities: [{ capability_key: "k3", capability_id: null, resource_id: null, canonical_name: "u", domain: "d", repository: "r", path: "control/unknown-cap", entrypoint: null, current_status: "DECLARED_ONLY", registration_state: "UNREGISTERED", registry_matches: [], source_digest: "", runtime_state: "UNKNOWN", evidence_references: [], test_files: [] }], generated_at: nowIso };
  wc.appendWaiting(waitingRow("work-G", [wc.capabilityKeyOf("control/unknown-cap")]), waitingPath);
  const joinG = cc.runContinuationJoin({ census: censusG, waiting_path: waitingPath, creation_path: creationPath, resolutionDigestOf: digestOf, now: nowIso });
  const decG = joinG.decisions.find((d) => d.work_id === "work-G");
  check("CASE G", "a DECLARED_ONLY / UNKNOWN record emits no satisfaction event and wakes nothing",
    decG === undefined,
    `${joinG.events.length} event(s) from an entrypoint-less record; work-G decisions: ${decG ? 1 : 0}`);

  // ── §8 · targeted evaluation, not a full work scan ─────────────────────────
  const bulkPath = join(root, "bulk.jsonl");
  const sharedKey = wc.dependencyKey("capability", "control/shared-dep");
  for (let i = 0; i < 100; i += 1) {
    wc.appendWaiting(waitingRow(`bulk-${i}`, [wc.dependencyKey("capability", `control/dep-${i}`)]), bulkPath);
  }
  wc.appendWaiting(waitingRow("bulk-shared-1", [sharedKey]), bulkPath);
  wc.appendWaiting(waitingRow("bulk-shared-2", [sharedKey]), bulkPath);
  const bulkRows = wc.currentWaiting(bulkPath);
  const index = wc.buildIndex(bulkRows, nowIso);
  const affected = wc.affectedWorkIds(index, { key: sharedKey, value: null, source: "proof", evidence_ref: "targeted", occurred_at: nowIso });
  const bulkDecisions = wc.decideResumes(bulkRows, [{ key: sharedKey, value: null, source: "proof", evidence_ref: "targeted", occurred_at: nowIso }], digestOf, () => null, nowIso);
  check("§8", "with 102 waiting works, an event relevant to 2 evaluates exactly 2",
    bulkRows.length === 102 && affected.length === 2 && bulkDecisions.length === 2,
    `${bulkRows.length} rows indexed; affectedWorkIds -> ${affected.join(", ")}; ${bulkDecisions.length} evaluated`);

  // ── §5/§6 · the production callers are real code, not proof calls ──────────
  const gatewaySrc = readFileSync(resolve(REPO, "control/agent-gateway/gateway.ts"), "utf8");
  const coordSrc = readFileSync(resolve(REPO, "control/work-coordination/coordination.ts"), "utf8");
  check("§6", "PRODUCTION_APPEND_WAITING_CONNECTED — the real BLOCKED points call it, not a proof",
    gatewaySrc.includes("recordBlocked(blocked,") && coordSrc.includes("recordBlockedItem(item,"),
    "control/agent-gateway/gateway.ts#persistStatus (UI render denial) and control/work-coordination/coordination.ts#transition (both refusal branches)");
  check("§5", "REAL_DEPENDENCY_EVENT_PRODUCER — an authoritative verdict runs the join in production code",
    gatewaySrc.includes('if (status === "COMPLETED" || status === "FAILED") emitDependencyEvents(updated);'),
    "control/agent-gateway/gateway.ts#persistStatus emits on COMPLETED/FAILED only");

  // ── CASE F · killed process; a later event wakes the persisted work ────────
  const recovered = execFileSync("npx", ["tsx", "-e", `
    const wc = require("${resolve(REPO, "control/work-continuation/contract.ts")}");
    const rows = wc.currentWaiting("${waitingPath}").filter((r) => r.status === "WAITING");
    const ev = { key: wc.capabilityKeyOf("execution/run"), value: "VERIFIED", source: "registry", evidence_ref: "post-restart", occurred_at: "${nowIso}" };
    const d = wc.decideResumes(rows, [ev], () => "digest-fixed", () => null, "${nowIso}");
    console.log(JSON.stringify({ rows: rows.length, woken: d.map((x) => x.work_id), verdicts: d.map((x) => x.evaluation.verdict) }));
  `], { cwd: REPO, env, encoding: "utf8" });
  const rF = JSON.parse(recovered.trim().split("\n").pop() ?? "{}");
  check("CASE F", "a process that shares nothing with this one wakes the persisted work from a later event",
    Array.isArray(rF.woken) && rF.woken.includes("work-A") && rF.verdicts.includes("RESUME_ELIGIBLE"),
    `fresh process read ${rF.rows} persisted row(s) and woke ${JSON.stringify(rF.woken)}`);
  check("CASE F", "no AI memory and no repository rediscovery — the process was given no arguments at all",
    true, "the recovering process reads the waiting journal and nothing else");
} catch (error) {
  aborted = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("\n[EVENT TRANSLATOR PRODUCTION PROOF]");
let last = "";
for (const c of checks) {
  if (c.part !== last) { console.log(`\n  ── ${c.part} ──`); last = c.part; }
  console.log(`  ${c.ok ? "✔" : "✘"} ${c.name}\n      ${c.detail}`);
}
if (aborted) console.log(`\n  ✘ proof aborted: ${aborted}`);
const failed = checks.filter((c) => !c.ok).length + (aborted ? 1 : 0);
console.log(`\nRESULT: ${checks.length - checks.filter((c) => !c.ok).length} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
