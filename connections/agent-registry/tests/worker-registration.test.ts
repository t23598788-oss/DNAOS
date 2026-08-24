import { rmSync } from "node:fs";
rmSync("/tmp/dna-os-worker-registration-test", { recursive: true, force: true });
import { registerAndCheckReadiness } from "../worker-registration";

async function main(): Promise<void> {
  const result = await registerAndCheckReadiness({ worker_id: "process-only", provider: "codex", runtime_id: "pid:33916", session_id: "UNKNOWN", capabilities: ["inspect"], workspace_scope: "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE", heartbeat_at: new Date().toISOString(), current_task_id: null, max_active_tasks: 1 });
  if (result.registration.status !== "BLOCKED" || result.registration.safe_to_assign) throw new Error("process-only worker was incorrectly made ready");
  console.log("PASS: readiness rejects process-only/UNKNOWN session without probe evidence");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
