import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeThroughExistingAgentHost } from "./contract";

const workspace = mkdtempSync(join(tmpdir(), "dna-os-transport-test-"));
async function main(): Promise<void> {
const result = await executeThroughExistingAgentHost({
  command_id: "transport-test-command",
  handoff_id: "transport-test-handoff",
  worker_kind: "LOCAL",
  workspace_dir: workspace,
  repository_read_paths: [],
  instruction_argv: ["/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE/control/agent-host/agent-script.mjs", JSON.stringify({ action: "read_allowed", relPath: "missing.txt" })],
  host_env: { PATH: process.env.PATH, TMPDIR: tmpdir(), LANG: "C", LC_ALL: "C" },
  allowed_operations: ["READ_SOURCE"],
  side_effect_class: "READ_ONLY",
});

if (!result.ok) throw new Error(`transport failed: ${result.reason}`);
if (!result.execution_id || !result.evidence_id || result.launch.exitCode !== 0) throw new Error("transport did not return a real successful launch");
console.log(JSON.stringify({ ok: true, transport_id: result.transport_id, execution_id: result.execution_id, evidence_id: result.evidence_id, pid: result.launch.pid }));
}
void main();
