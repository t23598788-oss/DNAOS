import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { listRegisteredAgents } from "./registry";
import { PROCESS_PATTERNS } from "./detect";
import { loadAllHandoffs, loadAllTasks } from "../../control/agent-gateway/memory-store";
import type { AgentProvider } from "./contract";

const execFileAsync = promisify(execFile);
const STATE_FILE = join(process.cwd(), "connections/agent-registry/data/worker-states.jsonl");
export type CollectedStatus = "IDLE" | "RUNNING" | "WAITING_CONFIRMATION" | "BLOCKED" | "UNKNOWN";
export interface CollectedWorkerState { agent_id: string; provider: AgentProvider; status: CollectedStatus; process_id: number | null; current_task_id: string | null; capability: readonly string[]; safe_to_assign: boolean; heartbeat: string; source: string[]; }

async function processId(provider: AgentProvider): Promise<number | null> {
  const pattern = PROCESS_PATTERNS[provider]; if (!pattern) return provider === "claude-code" ? process.pid : null;
  try { const result = await execFileAsync("/usr/bin/pgrep", ["-f", pattern], { timeout: 5_000, maxBuffer: 8 * 1024 }); const pid = Number(result.stdout.trim().split("\n")[0]); return Number.isFinite(pid) && pid > 0 ? pid : null; } catch { return null; }
}

async function runtimeInventory(): Promise<{ status?: string; worker_count?: number }> {
  try { const response = await fetch("http://127.0.0.1:8791/runtime/inventory"); if (!response.ok) return {}; const value = await response.json() as { status?: string; supervisor?: { worker_count?: number } }; return { status: value.status, worker_count: value.supervisor?.worker_count }; } catch { return {}; }
}

/** Collects only direct runtime/process/task evidence and persists an append-only snapshot. It never changes task status or creates a session. */
export async function collectWorkerStates(): Promise<CollectedWorkerState[]> {
  const [agents, tasks, handoffs, inventory] = await Promise.all([Promise.resolve(listRegisteredAgents()), Promise.resolve(loadAllTasks()), Promise.resolve(loadAllHandoffs()), runtimeInventory()]);
  const result: CollectedWorkerState[] = [];
  for (const agent of agents) {
    const pid = await processId(agent.provider); const prefix = agent.provider === "claude-code" ? "claude-code" : agent.provider;
    const handoff = handoffs.filter((h) => h.agent_id.toLowerCase().startsWith(prefix)).at(-1); const task = handoff ? tasks.find((t) => t.task_id === handoff.task_id) ?? null : null;
    const active = task && !["COMPLETED", "FAILED", "BLOCKED"].includes(task.status);
    const status: CollectedStatus = active ? (task!.status === "WAITING_OWNER_DECISION" ? "WAITING_CONFIRMATION" : "RUNNING") : pid === null ? "IDLE" : "UNKNOWN";
    const source = [`process:${pid === null ? "not-found" : `pid:${pid}`}`, `tasks:${task?.task_id ?? "none"}`, `runtime:127.0.0.1:8791=${inventory.status ?? "unavailable"}`];
    const state: CollectedWorkerState = { agent_id: agent.agent_id, provider: agent.provider, status, process_id: pid, current_task_id: active ? task!.task_id : null, capability: agent.capability, safe_to_assign: status === "IDLE" && agent.availability === "LIVE", heartbeat: new Date().toISOString(), source };
    result.push(state); mkdirSync(join(process.cwd(), "connections/agent-registry/data"), { recursive: true }); appendFileSync(STATE_FILE, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  }
  return result;
}

export function loadLatestCollectedStates(): CollectedWorkerState[] {
  if (!existsSync(STATE_FILE)) return []; const latest = new Map<string, CollectedWorkerState>();
  for (const line of readFileSync(STATE_FILE, "utf8").split("\n").filter(Boolean)) { try { const state = JSON.parse(line) as CollectedWorkerState; latest.set(state.agent_id, state); } catch { /* ignore malformed historical line */ } }
  return [...latest.values()];
}
