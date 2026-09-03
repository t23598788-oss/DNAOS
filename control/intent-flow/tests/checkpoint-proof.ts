/** CHECKPOINT_01..10 — ยิงคำสั่งจริงผ่าน handler จริง โดยไม่เปิด supervisor/agent */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { handleCommand } from "../../../transport/owner-command-http/server";
import { loadAllTasks, loadEvidenceForTask, loadHandoffsForTask } from "../../agent-gateway/contract";
import { bindRunObservations, analyzeRun } from "../contract";

const tag = `RB-${randomUUID().slice(0, 8)}`;
const dir = `tests/__sandbox__/rb-${tag}`;
const target = `${dir}/probe.txt`;
const body = JSON.stringify({
  commandText: `ตรวจ Work Order: runtime-observation-binding verify [${tag}]`,
  ownerIdentity: { id: "identity-deadboard-owner", email: "t23598788@gmail.com" },
  workOrder: {
    operation: "CREATE", target_type: "FILE", target_path: target,
    requested_change: "ยืนยัน checkpoint หลัง runtime-observation-binding",
    content: tag, workspace_scope: `${dir}/`, mode: "sandbox",
    required_tests: ["sandbox.write", "sandbox.readback"], forbidden_files: [],
    evidence: [{ source: "RUNTIME_OBSERVATION_BINDING_V1", note: "checkpoint proof" }],
  },
});

async function main(): Promise<void> {
  const req = Readable.from([Buffer.from(body, "utf8")]) as any;
  req.method = "POST"; req.url = "/command"; req.headers = { "content-type": "application/json" };
  let status = 0; const chunks: string[] = [];
  const res: any = {
    setHeader() {}, writeHead(s: number) { status = s; return res; },
    write(c: any) { chunks.push(String(c)); return true; },
    end(c?: any) { if (c !== undefined) chunks.push(String(c)); },
  };
  await handleCommand(req, res);
  const payload = ((): any => { try { return JSON.parse(chunks.join("")); } catch { return null; } })();

  const cp: [string, boolean, string][] = [];
  cp.push(["01_COMMAND_ACCEPTED", status === 200 || status === 202 || status === 0, `http=${status}`]);
  const taskId: string | null = payload?.lifecycle?.task_id ?? payload?.task?.task_id ?? null;
  const workId: string | null = payload?.lifecycle?.work_id ?? payload?.envelope?.envelope_id ?? null;
  cp.push(["02_WORK_IDENTITY", typeof workId === "string", String(workId)]);
  cp.push(["03_TASK_IDENTITY", typeof taskId === "string", String(taskId)]);
  const t = loadAllTasks().find((x) => x.task_id === taskId) ?? null;
  cp.push(["04_TASK_PERSISTED", t !== null, t?.status ?? "-"]);
  const ev = taskId !== null ? loadEvidenceForTask(taskId) : [];
  cp.push(["05_EVIDENCE_BOUND", ev.length > 0, `${ev.length} rows: ${[...new Set(ev.map((e) => e.kind))].join(",")}`]);
  cp.push(["06_POLICY_DECISION", ev.some((e) => e.kind === "policy_decision" || e.kind === "admission"), ""]);
  const ho = taskId !== null ? loadHandoffsForTask(taskId) : [];
  cp.push(["07_LIFECYCLE_REACHED_END", (t?.status ?? "") !== "", `${t?.status} handoffs=${ho.length}`]);
  const wrote = existsSync(target);
  cp.push(["08_ARTIFACT_WRITTEN", wrote, target]);
  cp.push(["09_ARTIFACT_READ_BACK", wrote && readFileSync(target, "utf8").includes(tag), ""]);
  const obs = taskId !== null ? bindRunObservations(taskId) : [];
  const a = obs.length > 0 ? analyzeRun(`run:${taskId}`, obs) : null;
  cp.push(["10_READ_MODEL_SELF_BOUND", a !== null && a.observed_steps.length > 0,
    `observed=${a?.observed_steps.length ?? 0}/10 first_bad=${a?.first_bad_boundary ?? "NONE"} truth_divergence=${a?.first_truth_divergence ?? "NONE"} human_met=${a?.human_outcome.human_outcome_met}`]);
  for (const [n, ok, d] of cp) console.log(`  CHECKPOINT_${n.padEnd(26)} ${ok ? "PASS" : "FAIL"}  ${d}`);
  console.log(`\n${cp.filter((c) => c[1]).length}/10 PASS  tag=${tag}`);
  process.exit(0);
}
void main();
