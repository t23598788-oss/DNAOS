/**
 * หน้าที่: §11 + §12 — พิสูจน์ว่า **สถานะของระบบชนะรายงานของ Agent**
 *
 * มีข้อขัดแย้งค้างอยู่จริง:
 *   รายงานเก่า  `connections/email-alert-source` = OPERATIONAL (จาก Gmail proof)
 *   รายงานใหม่  `connections/email-alert-source` = IMPLEMENTED_NOT_REACHABLE
 * ไฟล์นี้ไม่เลือกข้างจากรายงานใดเลย มันเดินไปอ่านหลักฐาน canonical แล้วให้
 * ประตูตัวเดิมตัดสิน — คำตอบที่ได้จึงเป็นผลของกฎ ไม่ใช่ผลของความเห็น
 *
 * และตรวจ translator ที่เพิ่งสร้างด้วยกฎเดียวกัน ไม่ยกเว้นให้ตัวเอง
 *
 * Input: none — อ่าน census/registry/joint/evidence ของจริงแบบ read-only
 * Output: exit 0 เมื่อทุกข้ออ้างตรงกับหลักฐาน, exit 1 เมื่อไม่ตรง
 * Dependency ที่อนุญาต: Node built-ins + contract ของ capability-creation
 * สิ่งที่ห้ามแตะ:
 * - ห้ามตัดสินจากข้อความในรายงานหรือ commit message
 * - ห้ามแก้ไฟล์ใด ๆ — ไฟล์นี้อ่านอย่างเดียว
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO = process.cwd();
const cc = require(resolve(REPO, "control/capability-creation/contract.ts")) as typeof import("../contract");
type Contract = import("../types").CapabilityCreationContract;

const checks: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: string): void => { checks.push({ name, ok, detail }); };

function censusRow(path: string): Record<string, unknown> | null {
  const p = join(REPO, "software/live-census/data/last-census.json");
  if (!existsSync(p)) return null;
  const d = JSON.parse(readFileSync(p, "utf8")) as { capabilities?: Record<string, unknown>[]; records?: Record<string, unknown>[] };
  return (d.capabilities ?? d.records ?? []).find((r) => String(r.path) === path) ?? null;
}

/** Real callers of a symbol outside its own folder, excluding tests and proofs. */
function productionCallers(symbol: string, root: string): string[] {
  const skip = new Set([".git", "node_modules", ".next", "dist", "local-runtime"]);
  const stack = [REPO];
  const found: string[] = [];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { continue; }
    for (const entry of entries) {
      if (skip.has(entry)) continue;
      const full = join(dir, entry);
      let st; try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) { stack.push(full); continue; }
      if (!entry.endsWith(".ts")) continue;
      const rel = full.slice(REPO.length + 1);
      if (rel.startsWith(root)) continue;
      if (rel.includes("/tests/") || rel.endsWith(".test.ts") || rel.includes("-proof")) continue;
      let body: string; try { body = readFileSync(full, "utf8"); } catch { continue; }
      if (new RegExp(`\\b${symbol}\\b`).test(body)) found.push(rel);
    }
  }
  return found;
}

function base(name: string, root: string, over: Partial<Contract>): Contract {
  return {
    capability_name: name, owner_domain: "UNKNOWN", repository: "DNA-OS-INFRASTRUCTURE",
    capability_root: root, resource_id: cc.UNKNOWN, capability_id: cc.UNKNOWN,
    purpose: "", execution_owner: cc.UNKNOWN,
    input_type: "", input_contract: [], input_source: cc.UNKNOWN,
    trigger_type: cc.UNKNOWN as never, trigger_owner: cc.UNKNOWN,
    output_type: "", output_contract: [], output_consumer: cc.UNKNOWN, output_destination: cc.UNKNOWN,
    runtime_type: "IN_PROCESS", service_id: cc.UNKNOWN, invocation_method: cc.UNKNOWN,
    required_dependencies: [], credential_boundary: "UNKNOWN",
    work_id: cc.UNKNOWN, persistent_state_owner: cc.UNKNOWN, evidence_owner: cc.UNKNOWN,
    verification_commands: [], runtime_proof: cc.UNKNOWN, completion_conditions: [],
    source_of_truth: cc.UNKNOWN, temporary_or_persistent: cc.UNKNOWN as never,
    cleanup_owner: cc.UNKNOWN, retention_status: cc.UNKNOWN, ...over,
  } as Contract;
}

// ── §11 · email-alert-source ────────────────────────────────────────────────
const EMAIL_ROOT = "connections/email-alert-source";
const emailCensus = censusRow(EMAIL_ROOT);
const emailCallers = productionCallers("fetchAlertEmails", EMAIL_ROOT);
const jointRows = existsSync(join(REPO, "observability/joint-monitor/data/joints.jsonl"))
  ? readFileSync(join(REPO, "observability/joint-monitor/data/joints.jsonl"), "utf8").split("\n").filter((l) => l.includes("email-alert")).length
  : 0;

const emailContract = base("email-alert-source", EMAIL_ROOT, {
  purpose: "translate the existing Gmail reader's output into RawAlertEmail[]",
  output_consumer: "control/alert-correlation",
  output_destination: "control/alert-correlation/contract.ts",
  trigger_type: cc.UNKNOWN as never, input_source: cc.UNKNOWN,
});
const emailGate = cc.evaluateCompletionGate({
  contract: emailContract, entry_symbol: "fetchAlertEmails",
  // A test that makes a real Gmail call is a real call — but it is a TEST path,
  // not a runtime path, and the lifecycle rules say so explicitly. Passing it
  // as runtime evidence here would be exactly the "tests alone" promotion the
  // Owner forbade.
  runtime_invocation_evidence: null,
  registered: emailCensus?.capability_id && emailCensus?.resource_id
    ? { resource_id: String(emailCensus.resource_id), capability_id: String(emailCensus.capability_id) } : null,
  verification: { ran: false, passed: false, detail: `census verification_state=${String(emailCensus?.verification_state)}` },
});

check("the canonical evidence is read, not a report",
  emailCensus !== null,
  `census: runtime_state=${String(emailCensus?.runtime_state)} callers=${JSON.stringify(emailCensus?.callers)} verification_state=${String(emailCensus?.verification_state)} capability_id=${String(emailCensus?.capability_id)}`);
check("no production caller references its entry symbol",
  emailCallers.length === 0,
  `grep for fetchAlertEmails outside ${EMAIL_ROOT}, excluding tests/proofs: ${emailCallers.length} hit(s)`);
check("no observed runtime traffic",
  jointRows === 0, `${jointRows} joint row(s) mention email-alert`);
check("EMAIL_ALERT_SOURCE_CANONICAL_STATUS = IMPLEMENTED_NOT_REACHABLE",
  emailGate.state === "IMPLEMENTED_NOT_REACHABLE",
  `${emailGate.state} — ${emailGate.missing.map((m) => m.kind).join(", ")}`);
check("the earlier OPERATIONAL claim is refuted by rule, not by opinion",
  emailGate.state !== "OPERATIONAL" && emailGate.missing.some((m) => m.kind === "INPUT" || m.kind === "ROUTING"),
  "a real Gmail call inside its own test satisfies neither INPUT_CONNECTED nor ROUTABLE; the lifecycle rule 'tests alone = IMPLEMENTED_NOT_RUNTIME_PROVEN' is what decides");

// ── §12 · the translator halves, judged by the same rules ───────────────────
const wiringCallers = productionCallers("runContinuationJoin", "control/capability-creation");
const waitingCallers = productionCallers("recordBlockedWork", "control/capability-creation");
check("the new production join HAS a real production caller",
  wiringCallers.length > 0, `runContinuationJoin called from: ${wiringCallers.join(", ") || "(none)"}`);
check("the production waiting recorder HAS a real production caller",
  waitingCallers.length > 0, `recordBlockedWork called from: ${waitingCallers.join(", ") || "(none)"}`);

const translatorGate = cc.evaluateCompletionGate({
  contract: base("capability-creation", "control/capability-creation", {
    purpose: "capability creation contract, gates, and the wiring-fact half of the event translator",
    input_type: "task status transition", input_contract: ["Task", "WorkItem"],
    input_source: "control/agent-gateway/gateway.ts#persistStatus",
    trigger_type: "VERIFICATION_RESULT", trigger_owner: "control/agent-gateway",
    output_type: "DependencyEvent[] + WaitingWork rows", output_contract: ["DependencyEvent", "WaitingWork"],
    output_consumer: "control/work-continuation", output_destination: "control/work-continuation/contract.ts",
    invocation_method: "direct call from control/agent-gateway/gateway.ts#persistStatus",
    execution_owner: "control/agent-gateway", credential_boundary: "NONE",
    persistent_state_owner: "control/work-session-state", evidence_owner: "control/agent-gateway",
    verification_commands: ["npx tsx control/capability-creation/tests/event-translator-proof.ts"],
    runtime_proof: "a real task reaching COMPLETED/FAILED runs the join",
    completion_conditions: ["control/work-continuation receives the events"],
    source_of_truth: "control/work-continuation", temporary_or_persistent: "PERSISTENT" as never,
    cleanup_owner: "control/work-session-state", retention_status: "NOT_DECLARED", work_id: "work-2026-08-26-close-architecture-debt",
  }),
  entry_symbol: "runContinuationJoin",
  // Honest: nothing has yet OBSERVED a real task reaching COMPLETED/FAILED and
  // running this join in production. The wiring exists; the observation does not.
  runtime_invocation_evidence: null,
  registered: null,
  verification: { ran: true, passed: true, detail: "event-translator-proof 15/15" },
});
check("§12 the translator is judged by the same rules and is NOT promoted from tests",
  translatorGate.state === "IMPLEMENTED_NOT_RUNTIME_PROVEN" || translatorGate.state === "IMPLEMENTED_NOT_REACHABLE",
  `${translatorGate.state} — missing: ${translatorGate.missing.map((m) => `${m.kind}(${m.blocked_on})`).join(", ")}`);

console.log("\n[CANONICAL STATUS PROOF]");
for (const c of checks) console.log(`  ${c.ok ? "✔" : "✘"} ${c.name}\n      ${c.detail}`);
const failed = checks.filter((c) => !c.ok).length;
console.log(`\nRESULT: ${checks.length - failed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
