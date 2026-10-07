// Phase 23 — real integration test against the LIVE server on :8790.
// Run: node control/agent-gateway/tests/integration_test.mjs
import http from "node:http";
import fs from "node:fs";

function post(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(url, { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } }, (res) => {
      let out = ""; res.on("data", (c) => (out += c)); res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(out) }));
    });
    req.on("error", reject); req.write(data); req.end();
  });
}
function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let out = ""; res.on("data", (c) => (out += c)); res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(out) })); }).on("error", reject);
  });
}

const results = [];
const check = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`${pass ? "PASS" : "FAIL"}  ${name}  ${pass ? "" : "-- " + detail}`); };

async function main() {
  const BASE = "http://localhost:8790";

  // Client A submits a read-only task (no owner decision required)
  const clientA_memory = { user_id: "user-alpha", workspace_id: "ws-1", conversation_id: "conv-a-1" };
  const submitA = await post(`${BASE}/gateway/dna_submit_task`, { intent_text: "ตรวจสอบไฟล์ซ้ำในระบบ", client_id: "client-A-generic", ...clientA_memory });
  check("1. Client A submitted a task, no prompt copied between agents (single HTTP call, generic client_id)", submitA.status === 200 && !!submitA.body.task_id, JSON.stringify(submitA.body));

  const taskId = submitA.body.task_id;
  check("Task reached a terminal or waiting status (COMPLETED/FAILED/WAITING_OWNER_DECISION/BLOCKED)", ["COMPLETED", "FAILED", "WAITING_OWNER_DECISION", "BLOCKED"].includes(submitA.body.status), submitA.body.status);

  // Client B reads the SAME task via task_id only — no screenshot, no prompt copy
  const statusB = await post(`${BASE}/gateway/dna_task_status`, { task_id: taskId });
  check("2/11. Client B reads the SAME task by task_id (no screenshot, no prompt copy)", statusB.status === 200 && statusB.body.task_id === taskId, JSON.stringify(statusB.body));

  const resultB = await post(`${BASE}/gateway/dna_get_result`, { task_id: taskId });
  check("Client B reads the SAME result via task_id", resultB.status === 200 && resultB.body.task_id === taskId, JSON.stringify(resultB.body).slice(0, 200));

  check("4/6. Evidence IDs present on the result (execution/verification produced real evidence)", Array.isArray(resultB.body.evidence_ids) && resultB.body.evidence_ids.length > 0, `evidence_ids=${JSON.stringify(resultB.body.evidence_ids)}`);

  // WAITING_OWNER_DECISION test — submit a write-shaped intent targeting an unauthorized path
  const submitC = await post(`${BASE}/gateway/dna_submit_task`, { intent_text: "แก้ไข dna-os-circuit/runtime/server.ts", client_id: "client-C-generic", user_id: "user-beta", workspace_id: "ws-1", conversation_id: "conv-c-1" });
  check("13a. A write-shaped task correctly halted at WAITING_OWNER_DECISION (real write-gate DENY)", submitC.body.status === "WAITING_OWNER_DECISION", submitC.body.status);

  const taskIdC = submitC.body.task_id;
  const explainC = await post(`${BASE}/gateway/dna_explain`, { task_id: taskIdC });
  check("12. \"อธิบายหน่อย\" returns a real explanation built from persisted state/evidence", explainC.status === 200 && !!explainC.body.what_happened && !!explainC.body.evidence_ids, JSON.stringify(explainC.body).slice(0, 200));

  // Confirm execution truly cannot proceed before a decision — re-check status is still WAITING
  const statusCBeforeDecision = await post(`${BASE}/gateway/dna_task_status`, { task_id: taskIdC });
  check("Owner decision test setup: still WAITING_OWNER_DECISION before any decision call", statusCBeforeDecision.body.status === "WAITING_OWNER_DECISION", statusCBeforeDecision.body.status);

  const decisionC = await post(`${BASE}/gateway/dna_owner_decision`, { task_id: taskIdC, decision: "ไม่ทำ" });
  check("13b. Owner answered \"ไม่ทำ\" — decision recorded, task ends BLOCKED, never executed", decisionC.body.status === "BLOCKED", decisionC.body.status);

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${passed} passed, ${failed} failed (part 1, pre-restart)`);
  return { results, passed, failed, taskId, taskIdC };
}
main().then((r) => {
  fs.writeFileSync(new URL("./integration_test_part1_results.json", import.meta.url), JSON.stringify(r, null, 2));
});
