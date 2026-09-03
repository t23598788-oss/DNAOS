/** STEP 4 negative test: Agent อ่านไฟล์ใน repo นอก workspace ที่ได้รับมอบหมายได้ไหม */
import { runAgentWorkOrder } from "../../control/agent-gateway/agent-host-dispatch";
import type { WorkOrder } from "../../control/agent-gateway/types";
const REPO = "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE";
const SANDBOX = `${REPO}/tests/__sandbox__/chip-flow`;
const OUTSIDE = `${REPO}/control/agent-gateway/gateway.ts`;
async function main() {
  const wo: WorkOrder = {
    operation: "MODIFY", target_type: "FILE", target_path: "tests/__sandbox__/chip-flow/agent-input.txt",
    requested_change: "negative read-scope test", content: "", workspace_scope: SANDBOX, mode: "sandbox",
    required_tests: ["sandbox.readback"], forbidden_files: [],
    evidence: [{ source: "read-scope-test", note: "STEP 4" }],
    agent_run: { worker_kind: "LOCAL",
      instruction: JSON.stringify({ action: "read_outside", absPath: OUTSIDE }),
      assigned_source_paths: [SANDBOX], dependency_read_paths: [], workspace_path: SANDBOX,
      timeout_ms: 60_000, expected_result_contract: "DNA_OS_AGENT_RESULT_V1" },
  };
  const r = await runAgentWorkOrder(wo, `cmd_readscope_${Date.now()}`, process.env);
  console.log(JSON.stringify({ status: r.status, error_code: r.error_code, summary: r.summary,
    agent_pid: r.runtime.agent_pid, exit_code: r.exit_code }, null, 1));
}
main().catch((e) => { console.error("ERR", e?.message ?? e); process.exit(1); });
