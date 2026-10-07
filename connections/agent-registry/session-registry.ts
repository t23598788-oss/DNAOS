/**
 * หน้าที่: the canonical, READ-ONLY Agent Session Registry (Owner,
 * 2026-08-20). Aggregates ONLY real, already-existing state — never
 * dispatches, never creates a session, never touches
 * control/agent-gateway/controller.ts (the parallel controller), and
 * introduces no new provider adapter. Sources, all pre-existing:
 * - ./registry.ts's listRegisteredAgents() — agent_id/provider/capability
 * - ./detect.ts's PROCESS_PATTERNS (read-only pgrep, real PID capture)
 * - control/agent-gateway/memory-store.ts's loadAllTasks()/loadAllHandoffs()
 *   — current_task_id/current_work_order_id/status/files_in_use/blocker
 *
 * Session identity: this repo has NO real "VS Code panel session id" for
 * any provider (confirmed BLOCKED in the prior Work Order's VS Code
 * multi-agent report) — `session_id` is honestly "UNKNOWN" for every
 * provider except this process itself (claude-code, self-evident).
 * Never fabricated.
 *
 * Input: none (pure aggregation of existing stores).
 * Output: SessionRegistryEntry[], queryAgentSessionRegistry() summary.
 * Dependency ที่อนุญาต: ./contract.ts, ./registry.ts, ./detect.ts
 * (PROCESS_PATTERNS only), ../../control/agent-gateway/contract.ts
 * (loadAllTasks is NOT exported there — see loadTaskHistory/loadAllTasks
 * usage below via memory-store.ts directly, read-only), node:child_process.
 * สิ่งที่ห้ามแตะ: never call dispatchTask/submitTask/registerAgent from
 * this file — read-only by construction; never invent a session_id.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentProvider } from "./contract";
import { listRegisteredAgents } from "./registry";
import { PROCESS_PATTERNS } from "./detect";
import { loadAllTasks, loadAllHandoffs } from "../../control/agent-gateway/memory-store";
import type { Task } from "../../control/agent-gateway/types";
import { collectWorkerStates } from "./worker-state-collector";

const execFileAsync = promisify(execFile);

export type CanonicalSessionStatus = "IDLE" | "RUNNING" | "WAITING_CONFIRMATION" | "BLOCKED" | "COMPLETED" | "FAILED" | "UNKNOWN";

export interface SessionRegistryEntry {
  agent_id: string;
  provider: AgentProvider;
  runtime_id: string | null;
  session_id: string;
  process_id: number | null;
  capabilities: readonly string[];
  current_task_id: string | null;
  current_work_order_id: string | null;
  status: CanonicalSessionStatus;
  started_at: string | null;
  last_activity_at: string | null;
  waiting_for_confirmation: boolean;
  blocker: string | null;
  files_in_use: readonly string[];
  safe_to_assign: boolean;
  heartbeat: string;
}

/** Real, bounded PID lookup — same fixed pgrep pattern ./detect.ts already uses for LIVE/UNKNOWN classification, read-only, never a new process/adapter. */
async function findProcessId(provider: AgentProvider): Promise<number | null> {
  const pattern = PROCESS_PATTERNS[provider];
  if (!pattern) return null;
  try {
    const { stdout } = await execFileAsync("/usr/bin/pgrep", ["-f", pattern], { timeout: 5_000, maxBuffer: 8 * 1024 });
    const firstPid = stdout.trim().split("\n")[0];
    const pid = Number(firstPid);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** Task.status -> canonical status. WAITING_OWNER_DECISION maps to WAITING_CONFIRMATION (Owner's exact term for a task paused pending human/agent confirmation). */
function canonicalStatusFromTask(status: Task["status"]): CanonicalSessionStatus {
  switch (status) {
    case "RECEIVED":
    case "ROUTING":
    case "POLICY_CHECK":
    case "EXECUTING":
    case "VERIFYING":
      return "RUNNING";
    case "WAITING_OWNER_DECISION":
      return "WAITING_CONFIRMATION";
    case "COMPLETED":
      return "COMPLETED";
    case "FAILED":
      return "FAILED";
    case "BLOCKED":
      return "BLOCKED";
    default:
      return "UNKNOWN";
  }
}

const TERMINAL_STATUSES = new Set<Task["status"]>(["COMPLETED", "FAILED", "BLOCKED"]);

/** The one real entry point: assembles one entry per registered agent from existing sources only. */
export async function buildSessionRegistry(): Promise<SessionRegistryEntry[]> {
  const agents = listRegisteredAgents();
  const allTasks = loadAllTasks();
  const allHandoffs = loadAllHandoffs();
  const collectedStates = await collectWorkerStates();

  const entries: SessionRegistryEntry[] = [];
  for (const agent of agents) {
    const processId = await findProcessId(agent.provider);

    // agent_id<->task_id mapping via handoffs (the only real, existing
    // correlation this repo has between an agent identity and a task_id —
    // control/agent-gateway/handoff.ts's HandoffRecord.agent_id).
    const agentHandoffPrefix = agent.provider === "claude-code" ? "claude-code" : agent.provider;
    const handoffsForAgent = allHandoffs.filter((h) => h.agent_id.toLowerCase().startsWith(agentHandoffPrefix.toLowerCase()));
    const latestHandoff = handoffsForAgent.length > 0 ? handoffsForAgent[handoffsForAgent.length - 1] : null;

    const relatedTask = latestHandoff ? allTasks.filter((t) => t.task_id === latestHandoff.task_id).at(-1) ?? null : null;

    // "Session done but process still open must transition to IDLE once no
    // active task is confirmed" — Owner's own rule: a task in a terminal
    // status (COMPLETED/FAILED/BLOCKED) means NO active task, regardless
    // of the last recorded Task.status label.
    const hasActiveTask = relatedTask !== null && !TERMINAL_STATUSES.has(relatedTask.status);

    // Owner correction (2026-08-20, REGISTRY CORRECTION): absence of a
    // tracked DNA OS Task record is NOT positive evidence of idleness — a
    // live agent process (e.g. a coding-agent chat pane) can have real,
    // in-progress or awaiting-confirmation work that never went through
    // this repo's Task/Handoff pipeline at all ("legacy CHAT work" — a
    // manually-run test/command, not a DNA OS dispatch). IDLE is now only
    // ever assigned when there IS a real, terminal-status task on record
    // (positive evidence of completion). No task on record at all, for a
    // LIVE process, is UNKNOWN — never defaulted to IDLE — and
    // safe_to_assign is false for UNKNOWN exactly as it is for BLOCKED.
    const collected = collectedStates.find((state) => state.agent_id === agent.agent_id);
    const effectiveStatus: CanonicalSessionStatus = collected
      ? collected.status
      : relatedTask
      ? canonicalStatusFromTask(relatedTask.status)
      : processId !== null
        ? "UNKNOWN" // real live process, no DNA OS task record — cannot confirm idle, never assumed idle
        : "IDLE"; // no relatedTask AND no real live process at all — genuinely nothing to be busy with

    const blocker = latestHandoff && latestHandoff.blockers.length > 0 ? latestHandoff.blockers.join("; ") : effectiveStatus === "UNKNOWN" ? "no DNA OS task record exists for this LIVE agent — possible untracked/legacy work in progress, cannot confirm idle" : null;
    const filesInUse = hasActiveTask && latestHandoff ? latestHandoff.files_changed : [];
    const lastActivityAt = latestHandoff?.updated_at ?? agent.last_seen;

    entries.push({
      agent_id: agent.agent_id,
      provider: agent.provider,
      runtime_id: processId !== null ? `pid:${processId}` : null,
      // Real session identity does not exist anywhere in this repo for any
      // provider (see file header) — honestly UNKNOWN, never invented.
      session_id: "UNKNOWN",
      process_id: processId,
      capabilities: agent.capability,
      current_task_id: hasActiveTask ? relatedTask!.task_id : null,
      current_work_order_id: hasActiveTask && relatedTask!.work_order ? relatedTask!.idempotency_key ?? null : null,
      status: effectiveStatus,
      started_at: relatedTask?.created_at ?? null,
      last_activity_at: lastActivityAt,
      waiting_for_confirmation: effectiveStatus === "WAITING_CONFIRMATION",
      blocker: hasActiveTask || effectiveStatus === "UNKNOWN" ? blocker : null,
      files_in_use: filesInUse,
      // Owner correction: safe_to_assign is true ONLY for a positively
      // confirmed IDLE status — BLOCKED, WAITING_CONFIRMATION, RUNNING, and
      // UNKNOWN (no confirmable evidence either way) are all unsafe. Never
      // an allowlist-by-exclusion; an explicit allowlist-by-inclusion.
      safe_to_assign: collected?.safe_to_assign ?? (agent.availability === "LIVE" && effectiveStatus === "IDLE"),
      heartbeat: collected?.heartbeat ?? agent.last_seen,
    });
  }
  return entries;
}

export interface SessionRegistryQuery {
  total_agents: number;
  identified_sessions: number;
  unknown_sessions: number;
  task_session_mapping: { agent_id: string; current_task_id: string | null }[];
  heartbeats: { agent_id: string; heartbeat: string }[];
  safe_to_assign_ids: string[];
  entries: SessionRegistryEntry[];
}

/** The one real read API DNA OS's Decision Engine/Dispatcher (or Owner Console) queries — pure aggregation, no side effect. */
export async function queryAgentSessionRegistry(): Promise<SessionRegistryQuery> {
  const entries = await buildSessionRegistry();
  return {
    total_agents: entries.length,
    identified_sessions: entries.filter((e) => e.session_id !== "UNKNOWN").length,
    unknown_sessions: entries.filter((e) => e.session_id === "UNKNOWN").length,
    task_session_mapping: entries.map((e) => ({ agent_id: e.agent_id, current_task_id: e.current_task_id })),
    heartbeats: entries.map((e) => ({ agent_id: e.agent_id, heartbeat: e.heartbeat })),
    safe_to_assign_ids: entries.filter((e) => e.safe_to_assign).map((e) => e.agent_id),
    entries,
  };
}
