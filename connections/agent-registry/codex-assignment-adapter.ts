import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { WorkOrder } from "../../control/agent-gateway/types";

const execFileAsync = promisify(execFile);
const ROOT = "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE";
export interface CodexAssignment { assignment_id: string; task_id: string; worker_id: string; provider: "codex"; runtime_id: string; session_id: string; correlation_token: string; work_order: WorkOrder; }
export interface CodexAssignmentEvidence { evidence_id: string; assignment_id: string; task_id: string; worker_id: string; assigned_session_id: string; execution_session_id: string; output: { cwd: string; repository_root: string; git_branch: string }; }

/** Provider boundary: the session is supplied by Assignment, never selected here. */
export async function executeCodexAssignment(assignment: CodexAssignment): Promise<CodexAssignmentEvidence> {
  const prompt = "Return exactly three lines: pwd; git rev-parse --show-toplevel; git branch --show-current. Do not modify files.";
  const result = await execFileAsync("/Applications/ChatGPT.app/Contents/Resources/codex", ["exec", "resume", assignment.session_id, "--json", prompt], { cwd: ROOT, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
  const events = String(result.stdout).split("\n").filter(Boolean).map((line) => { try { return JSON.parse(line) as { type?: string; thread_id?: string; item?: { type?: string; aggregated_output?: string; text?: string } }; } catch { return null; } }).filter(Boolean) as Array<{ type?: string; thread_id?: string; item?: { type?: string; aggregated_output?: string; text?: string } }>;
  const started = events.find((event) => event.type === "thread.started");
  const execution_session_id = started?.thread_id ?? "NONE";
  if (execution_session_id !== assignment.session_id) throw new Error("SESSION_CORRELATION_MISMATCH");
  // item.started and item.completed share the same item type. Only the
  // completed event carries the result; selecting the first command event
  // yields an empty output and causes a false PROBE_EVIDENCE_INVALID.
  const completedCommand = events.find((event) => event.type === "item.completed" && event.item?.type === "command_execution" && Boolean(event.item.aggregated_output?.trim()));
  const output = completedCommand?.item?.aggregated_output ?? events.find((event) => event.type === "item.completed" && event.item?.type === "agent_message" && Boolean(event.item.text?.trim()))?.item?.text ?? "";
  const lines = output.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 3 || lines[0] !== ROOT || lines[1] !== ROOT) throw new Error("PROBE_EVIDENCE_INVALID");
  return { evidence_id: `evidence-${assignment.assignment_id}`, assignment_id: assignment.assignment_id, task_id: assignment.task_id, worker_id: assignment.worker_id, assigned_session_id: assignment.session_id, execution_session_id, output: { cwd: lines[0], repository_root: lines[1], git_branch: lines[2] } };
}
