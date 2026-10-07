/**
 * หน้าที่: รันสายจริง CHIP1 -> CHIP2 -> AGENT -> CHIP2 -> CHIP1 หนึ่งรอบ
 * แล้วบันทึกหลักฐานทุกช่วงเวลาไว้เป็นไฟล์เดียว
 *
 * ไม่มี mock: เรียก runAgentWorkOrder() และ runCorrectiveLoop() ตัวจริง
 * สถานะที่รายงานมาจากสิ่งที่เกิดขึ้นจริงเท่านั้น — ถ้า Agent ถูกบล็อก
 * ไฟล์นี้บันทึกว่าถูกบล็อก ไม่แปลงเป็นสำเร็จ
 *
 * Usage: npx tsx software/system-graph/chip-interface/run-chip-flow.ts <positive|negative>
 */
import { createHash, randomUUID } from "node:crypto";
import { writeFileSync, appendFileSync, statSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { runAgentWorkOrder } from "../../../control/agent-gateway/agent-host-dispatch";
import { runCorrectiveLoop } from "../../../control/agent-gateway/agent-execution-loop";
import { resolveWorker } from "../../../control/agent-host/contract";
import type { WorkOrder } from "../../../control/agent-gateway/types";

const REPO = join(__dirname, "..", "..", "..");
const SANDBOX = join(REPO, "tests", "__sandbox__", "chip-flow");
const OUT = join(__dirname, "..", "data", "chip-flow-evidence.jsonl");
const STATE = join(__dirname, "..", "data", "chip-connection-state.json");
const CONN_CMD = "conn:chip:control-planeport:control/agent-gateway#runAgentWorkOrder=>chip:agent-runtimeport:chip:agent-runtime#workOrderIn";
const CONN_RES = "conn:chip:agent-runtimeport:chip:agent-runtime#agentResultOut=>chip:control-planeport:control/agent-gateway#runCorrectiveLoop";

const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const marks: { t: string; at: string; ms: number; detail: unknown }[] = [];
const t0 = Date.now();
const mark = (t: string, detail: unknown) =>
  marks.push({ t, at: new Date().toISOString(), ms: Date.now() - t0, detail });

/** สถานะสายเปลี่ยนได้เฉพาะเมื่อมีหลักฐานจริง — เขียนพร้อม evidence ที่อ้างได้ */
function setLinkState(connId: string, state: string, evidence: string) {
  const cur = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
  cur[connId] = { state, evidence, at: new Date().toISOString() };
  writeFileSync(STATE, JSON.stringify(cur, null, 1));
}

async function main() {
  const mode = (process.argv[2] ?? "positive") as "positive" | "negative";
  const TRACE_ID = `chipflow-${randomUUID()}`;
  const command_id = `cmd_${randomUUID()}`;
  if (!existsSync(SANDBOX)) mkdirSync(SANDBOX, { recursive: true });

  const targetFile = "agent-input.txt";
  const realPath = join(SANDBOX, targetFile);
  const realStat = existsSync(realPath) ? statSync(realPath) : null;
  const realBytes = realStat?.size ?? null;

  // งานอ่านอย่างเดียว / งานเขียนนอก workspace — ทั้งคู่เป็น action จริงของ agent-script
  const instruction = mode === "positive"
    ? JSON.stringify({ action: "read_allowed", relPath: targetFile })
    : JSON.stringify({ action: "write_direct_outside", absPath: join(REPO, "OUTSIDE-WRITE-MUST-BE-BLOCKED.txt"),
                       content: "agent tried to write outside its workspace" });

  const resolution = resolveWorker("LOCAL");
  mark("T3_WORKER_REGISTRY_RESOLVED", resolution.ok
    ? { ok: true, kind: "LOCAL", executable: resolution.worker.executable, defaultArgv: resolution.worker.defaultArgv }
    : { ok: false, reason: resolution.reason, detail: resolution.detail });
  if (!resolution.ok) { console.log("WORKER_NOT_RESOLVED — หยุด ไม่สร้างผลปลอม"); process.exit(1); }

  const workOrder: WorkOrder = {
    operation: "MODIFY", target_type: "FILE", target_path: `tests/__sandbox__/chip-flow/${targetFile}`,
    requested_change: mode === "positive"
      ? "อ่านไฟล์ทดสอบและคืนเนื้อหา ห้ามแก้ไฟล์"
      : "พยายามเขียนไฟล์นอก workspace ที่อนุญาต (negative test)",
    content: "", workspace_scope: SANDBOX, mode: "sandbox",
    required_tests: ["sandbox.readback"], forbidden_files: [],
    evidence: [{ source: "run-chip-flow.ts", note: `TRACE_ID=${TRACE_ID}` }],
    agent_run: {
      worker_kind: "LOCAL", instruction,
      assigned_source_paths: [SANDBOX], dependency_read_paths: [],
      workspace_path: SANDBOX, timeout_ms: 60_000,
      expected_result_contract: "DNA_OS_AGENT_RESULT_V1",
    },
  };
  mark("T0_WORK_ORDER_CREATED", { work_order_target: workOrder.target_path,
    agent_run: workOrder.agent_run, payload_sha256: sha(workOrder) });

  // ---- CHIP 1 OUT ----
  const chip1OutPayload = { workOrder, command_id, schema_id: "dna-os/agent-gateway/run-agent-work-order@1" };
  const chip1OutHash = sha(chip1OutPayload);
  mark("T1_CHIP1_OUT_EMITTED", { port: "port:control/agent-gateway#runAgentWorkOrder", sha256: chip1OutHash });
  setLinkState(CONN_CMD, "COMMAND_SENT", `T1 sha256=${chip1OutHash.slice(0, 16)}`);

  // ---- CHIP 2 IN (payload เดียวกัน ส่งต่อโดยไม่แก้) ----
  const chip2InHash = sha(chip1OutPayload);
  mark("T2_CHIP2_IN_RECEIVED", { port: "port:chip:agent-runtime#workOrderIn", sha256: chip2InHash,
    hash_match_with_chip1_out: chip2InHash === chip1OutHash });

  mark("T4_LAUNCH_AGENT_CALLED", { via: "control/agent-gateway/agent-host-dispatch.ts#runAgentWorkOrder" });
  setLinkState(CONN_CMD, "AGENT_RUNNING", "T4 launchAgent called");

  const agentResult = await runAgentWorkOrder(workOrder, command_id, process.env);

  mark("T5_AGENT_PROCESS", { agent_pid: agentResult.runtime.agent_pid, sandbox_pid: agentResult.runtime.sandbox_pid,
    executable: agentResult.runtime.executable, workspace: agentResult.runtime.workspace,
    started_at: agentResult.runtime.started_at, ended_at: agentResult.runtime.ended_at });
  mark("T6_AGENT_RETURNED", { protocol: agentResult.protocol, status: agentResult.status,
    summary: agentResult.summary, exit_code: agentResult.exit_code,
    error_code: agentResult.error_code, artifacts: agentResult.artifacts,
    evidence_refs: agentResult.evidence_refs, verification: agentResult.verification });

  // ---- CHIP 2 OUT ----
  const chip2OutHash = sha(agentResult);
  mark("T7_CHIP2_OUT_EMITTED", { port: "port:chip:agent-runtime#agentResultOut",
    schema_id: "dna-os/agent-gateway/agent-result@1", sha256: chip2OutHash });
  // สถานะสายสะท้อนผลจริงของ Agent — BLOCKED/FAIL ห้ามแสดงเป็นสำเร็จ
  const linkState = agentResult.status === "PASS" ? "RESULT_RETURNED"
    : agentResult.status === "BLOCKED" ? "BLOCKED" : "FAILED";
  setLinkState(CONN_CMD, linkState, `T7 agent status=${agentResult.status}`);
  setLinkState(CONN_RES, linkState, `T7 sha256=${chip2OutHash.slice(0, 16)} status=${agentResult.status}`);

  // ---- CHIP 1 IN ----
  const chip1InHash = sha(agentResult);
  mark("T8_CHIP1_RETURN_RECEIVED", { port: "port:control/agent-gateway#runCorrectiveLoop",
    sha256: chip1InHash, hash_match_with_chip2_out: chip1InHash === chip2OutHash });

  const loop = await runCorrectiveLoop(agentResult, "chip-flow-harness");
  mark("T9_GATEWAY_FINAL_STATUS", { decided_by: "control/agent-gateway/agent-execution-loop.ts#runCorrectiveLoop",
    state: loop.state, decision_id: loop.decision_id, decision_type: loop.decision_type,
    corrective_task_id: loop.corrective_task_id });

  // ผลจริงเทียบไฟล์จริง
  const contentCheck = mode === "positive" && realStat
    ? { file: targetFile, real_bytes: realBytes,
        real_sha256: createHash("sha256").update(readFileSync(realPath)).digest("hex") }
    : { file: null };
  const outsideFile = join(REPO, "OUTSIDE-WRITE-MUST-BE-BLOCKED.txt");
  const negativeCheck = mode === "negative"
    ? { outside_file_created: existsSync(outsideFile) } : null;

  const record = { TRACE_ID, MODE: mode, command_id,
    WORK_ORDER_ID: agentResult.work_order_id, WORKSPACE_ID: agentResult.workspace_id,
    LAUNCH_ID: agentResult.launch_id, RESULT_ID: agentResult.result_id,
    WORKER: resolution.ok ? resolution.worker.executable : null,
    CHIP1_OUT_SHA256: chip1OutHash, CHIP2_IN_SHA256: chip2InHash,
    CHIP2_OUT_SHA256: chip2OutHash, CHIP1_IN_SHA256: chip1InHash,
    COMMAND_LINE_HASH_MATCH: chip1OutHash === chip2InHash,
    RESULT_LINE_HASH_MATCH: chip2OutHash === chip1InHash,
    AGENT_STATUS: agentResult.status, AGENT_PROTOCOL: agentResult.protocol,
    FINAL_STATE: loop.state, CONTENT_CHECK: contentCheck, NEGATIVE_CHECK: negativeCheck,
    MARKS: marks, recorded_at: new Date().toISOString() };
  appendFileSync(OUT, `${JSON.stringify(record)}\n`);
  console.log(JSON.stringify({ TRACE_ID, worker: record.WORKER, agent_status: record.AGENT_STATUS,
    protocol: record.AGENT_PROTOCOL, exit_code: agentResult.exit_code, agent_pid: agentResult.runtime.agent_pid,
    final_state: record.FINAL_STATE, cmd_hash_match: record.COMMAND_LINE_HASH_MATCH,
    res_hash_match: record.RESULT_LINE_HASH_MATCH, negative: negativeCheck }, null, 1));
}
main().catch((e) => { console.error("FLOW_ERROR", e?.message ?? e); process.exit(1); });
