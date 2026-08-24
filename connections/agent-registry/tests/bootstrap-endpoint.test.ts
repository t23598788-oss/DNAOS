import { rmSync } from "node:fs";
import { completeBootstrapProbe, issueBootstrapChallenge } from "../worker-registration";

const denied = issueBootstrapChallenge({ worker_id: "pid-only", provider: "codex", runtime_id: "pid:33916", session_id: "UNKNOWN", transport: "stdio", capabilities: ["inspect"], workspace_scope: "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE", heartbeat_at: new Date().toISOString() });
if (!("error" in denied) || denied.error !== "WORKER_IDENTITY_REQUIRED") throw new Error("endpoint accepted fabricated/unknown identity");
const challenge = issueBootstrapChallenge({ worker_id: "fixture-worker", provider: "codex", runtime_id: "fixture-runtime", session_id: "fixture-session", transport: "test", capabilities: ["probe"], workspace_scope: "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE", heartbeat_at: new Date().toISOString() });
if ("error" in challenge) throw new Error(challenge.error);
const challengeId = challenge.challenge_id;
async function main(): Promise<void> {
  const result = await completeBootstrapProbe({ challenge_id: challengeId, session_id: "fixture-session", probe_task_id: "probe-fixture-1", evidence: { evidence_id: "evidence-fixture-1", cwd: "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE", repository_root: "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE", git_branch: "main" }, completed_at: new Date().toISOString() });
  if ("error" in result || result.registration.status !== "IDLE" || !result.registration.safe_to_assign) throw new Error("synthetic readiness handshake failed");
  rmSync("connections/agent-registry/data/worker-registrations.jsonl", { force: true });
  console.log("PASS: generic bootstrap challenge/probe contract; fixture excluded from live capacity");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
