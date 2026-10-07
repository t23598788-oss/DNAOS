/**
 * WRITE PIPE PROOF (Owner, CONNECT_AGENT_REQUESTED_ACTION_TO_EXISTING_WRITE_AUTHORITY_PIPE).
 *
 * พิสูจน์สายเดียว: Agent เขียน "ข้อเสนอ" ในพื้นที่ของตัวเองเท่านั้น -> DNA OS
 * resolve artifact ตามขอบเขต -> routeRequestedAction -> WriteIntent ->
 * WriteGateDecision -> executeFileWrite -> เป้าหมาย canonical เปลี่ยน
 *
 * ทุกตัวเลขในรายงานมาจากการวัด: sha256 ของเป้าหมาย 3 จุด และ audit log จริงของ
 * execution/file-write (ซึ่งบันทึก gate_decision_id ไว้ในทุกแถว)
 */
process.env.AGENT_GATEWAY_DATA_DIR =
  "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE/tests/__pipeline__/isolated-store-writepipe";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from "node:fs";
import { submitTask, getTask, loadEvidenceForTask, aiWriteAdapter } from "../../control/agent-gateway/contract";
import { routeRequestedAction } from "../../control/agent-gateway/agent-authority-router";
import { createTaskWorkspace } from "../../control/agent-gateway/workspace-manager";
import { executeFileWrite } from "../../execution/file-write/contract";
import type { WorkOrder } from "../../control/agent-gateway/types";

const REPO = "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE";
const SANDBOX_REL = "tests/__sandbox__/true-test-a";
const FIX = `${REPO}/${SANDBOX_REL}`;
const TARGET_REL = `${SANDBOX_REL}/input.txt`;
const AUDIT = `${REPO}/execution/file-write/write-audit-log.json`;
const WS_ROOT = `${REPO}/control/agent-host/test-workspace/allowed`;

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const auditRows = (): { gate_decision_id: string; status: string; resolved_path: string }[] => {
  try { return JSON.parse(readFileSync(AUDIT, "utf-8")); } catch { return []; }
};

function newWorkspace(tag: string) {
  mkdirSync(WS_ROOT, { recursive: true });
  return createTaskWorkspace({
    work_order_id: `wo-writepipe-${tag}`, command_id: `cmd-writepipe-${tag}`,
    assigned_source: [FIX], workspace_root: WS_ROOT,
  });
}

/** PHASE 5/6: สายจริงตั้งแต่ submitTask */
async function mainProof() {
  mkdirSync(FIX, { recursive: true });
  writeFileSync(`${FIX}/input.txt`, `fixture v1 ${new Date().toISOString()}\n`);
  const before = sha(readFileSync(`${FIX}/input.txt`));
  const auditBefore = auditRows().length;

  const ws = newWorkspace("main");
  const proposed = `PROPOSED BY AGENT, WRITTEN BY DNA OS EXECUTOR ${new Date().toISOString()}\n`;
  const wo: WorkOrder = {
    operation: "MODIFY", target_type: "FILE", target_path: TARGET_REL,
    requested_change: "agent proposes, DNA OS writes", content: proposed,
    workspace_scope: SANDBOX_REL, mode: "sandbox",
    required_tests: ["sandbox.readback"], forbidden_files: [`${REPO}/control`],
    evidence: [{ source: "write-pipe-proof", note: "main" }],
    agent_run: {
      worker_kind: "LOCAL",
      instruction: JSON.stringify({ action: "propose_authorized_write", artifact_rel_path: "proposal.txt",
        content: proposed, operation: "FILE_MODIFY", target_path: TARGET_REL }),
      workspace_id: ws.workspace_id,
      assigned_source_paths: [FIX], dependency_read_paths: [],
      workspace_path: ws.allowed_write_workspace,
      timeout_ms: 60_000, expected_result_contract: "DNA_OS_AGENT_RESULT_V1",
    },
  };

  const task = await submitTask("WRITE PIPE PROOF", 
    { user_id: "owner", workspace_id: "test", conversation_id: `c-${Date.now()}`, parent_task_id: null },
    "write-pipe-proof", [aiWriteAdapter], wo,
    { target_capability_id: "real_file_write_after_authorization" } as never);

  const after = sha(readFileSync(`${FIX}/input.txt`));
  const ev = loadEvidenceForTask(task.task_id);
  const ingest = ev.filter((e) => e.kind === "verification").map((e) => e.payload).slice(-2);
  const exec = ev.find((e) => e.source?.includes("admitted-agent-execution"))?.payload as Record<string, unknown> | undefined;
  const newRows = auditRows().slice(auditBefore);
  const targetRows = newRows.filter((r) => r.resolved_path.endsWith("/input.txt"));

  return {
    submit_status: task.status, task_status_now: getTask(task.task_id)?.status ?? null,
    SHA_BEFORE: before,
    SHA_AFTER_AGENT: (exec?.sha256_target_after_agent ?? null),
    SHA_AFTER_ROUTER: after,
    AGENT_CHANGED_TARGET: exec?.agent_direct_target_mutation === true ? "YES" : "NO",
    DNA_OS_EXECUTOR_CHANGED_TARGET: targetRows.length > 0 && before !== after ? "YES" : "NO",
    TARGET_CONTENT_NOW: readFileSync(`${FIX}/input.txt`, "utf-8").trim(),
    AGENT_DIRECT_TARGET_MUTATION_COUNT: exec?.agent_direct_target_mutation === true ? 1 : 0,
    REQUESTED_ACTION_COUNT: exec?.requested_action_count ?? null,
    EXECUTE_FILE_WRITE_CALL_COUNT: targetRows.length,
    WRITE_GATE_CALL_COUNT: new Set(targetRows.map((r) => r.gate_decision_id)).size,
    ROUTED_OUTCOMES: exec?.routed_outcomes ?? null,
    TERMINAL_STATUS_REASON: ingest,
  };
}

/** PHASE 2 negative: A2 — ทุกชนิดของการหลุดขอบเขต */
async function a2EscapeClasses() {
  const ws = newWorkspace("a2");
  const inside = `${ws.allowed_write_workspace}/proposal.txt`;
  writeFileSync(inside, "escape-probe\n");
  const link = `${ws.allowed_write_workspace}/link-out.txt`;
  if (!existsSync(link)) symlinkSync(`${REPO}/package.json`, link);

  const ctx = { workspace: ws, origin: { kind: "ADMITTED_TASK" as const, task_id: "task-a2", command_id: "cmd-a2" }, authorization_reference: null };
  const cases: [string, string][] = [
    ["ABSOLUTE_OUTSIDE_WORKSPACE", `artifact://${REPO}/package.json`],
    ["RELATIVE_TRAVERSAL_ESCAPE", "artifact://../../../../../package.json"],
    ["SYMLINK_ESCAPE", "artifact://link-out.txt"],
    ["ARTIFACT_UNRESOLVABLE", "artifact://does-not-exist.txt"],
    ["CONTAINED_CONTROL", `artifact://${inside}`],
  ];
  const out: Record<string, unknown>[] = [];
  for (const [expect, ref] of cases) {
    const auditBefore = auditRows().length;
    const r = await routeRequestedAction({ operation: "FILE_MODIFY", artifact_ref: ref, target: TARGET_REL }, ctx);
    out.push({ escape_class_expected: expect, status: r.status,
      reason: r.status === "EXECUTED" ? "(executed)" : (r as { reason: string }).reason.slice(0, 140),
      reached_write_gate: auditRows().length > auditBefore });
  }
  return out;
}

/** PHASE 6 negative: A3 — target นอกความเป็นเจ้าของของ TEST_FIXTURE */
async function a3TargetOwnership() {
  const ws = newWorkspace("a3");
  const inside = `${ws.allowed_write_workspace}/proposal.txt`;
  writeFileSync(inside, "must never be written to a non-owned target\n");
  const targetBefore = sha(readFileSync(`${REPO}/control/agent-gateway/gateway.ts`));
  const r = await routeRequestedAction(
    { operation: "FILE_MODIFY", artifact_ref: `artifact://${inside}`, target: "control/agent-gateway/gateway.ts" },
    { workspace: ws, origin: { kind: "ADMITTED_TASK" as const, task_id: "task-a3", command_id: "cmd-a3" }, authorization_reference: null });
  const targetAfter = sha(readFileSync(`${REPO}/control/agent-gateway/gateway.ts`));
  return { status: r.status, reason: r.status === "EXECUTED" ? "(executed)" : (r as { reason: string }).reason.slice(0, 160),
    NON_OWNED_TARGET_UNCHANGED: targetBefore === targetAfter ? "YES" : "NO" };
}

/** A4 — executeFileWrite โดยไม่มี decision ที่ถูกต้อง */
function a4NoGateDecision() {
  const w = executeFileWrite(
    { correlation_id: "c-a4", intent_id: "wi-a4", gate_decision_id: "fabricated", operation: "MODIFY",
      target_type: "FILE", target_path: TARGET_REL, content: "A4 must never land\n",
      requesting_identity_id: "a4-probe" },
    undefined as never,
  );
  return { status: w.status, refusal_code: w.refusal_code };
}

async function main() {
  rmSync(`${REPO}/tests/__pipeline__/isolated-store-writepipe`, { recursive: true, force: true });
  const MAIN = await mainProof();
  const A2 = await a2EscapeClasses();
  const A3 = await a3TargetOwnership();
  const A4 = a4NoGateDecision();
  console.log(JSON.stringify({ MAIN, A2, A3, A4 }, null, 1));
}
main().catch((e) => { console.error("ERR", e?.stack ?? e); process.exit(1); });
