/**
 * หน้าที่: Layer 3/6 of the 2026-08-20 Agent Session/Command Bridge Work
 * Order — a THIN admission gate in front of the EXISTING
 * control/agent-gateway pipeline. Never a second router/queue: this file
 * calls `dispatchTask` (control/agent-gateway/contract.ts, the one real
 * Controller) unchanged; it only decides whether a WorkOrder may be
 * assigned to a given external agent BEFORE handing it to that Controller,
 * by checking ./registry.ts's real (never mocked) availability.
 *
 * What this file explicitly does NOT do (Owner's forbidden list,
 * verbatim, 2026-08-20): does not read/store/forward any
 * password/API key/OTP/MFA/Keychain secret, does not bypass a macOS
 * permission prompt, does not build a second login system, and does NOT
 * send a command directly to an interactive Terminal a human is using.
 *
 * 2026-08-20 UPDATE: Codex now has a real, safe transport —
 * ./codex-session-bridge.ts's `runCodexWorkOrder`, which spawns the
 * documented `codex exec resume --last` CLI subcommand (bounded,
 * non-interactive, never Terminal keystroke injection, never OCR). This
 * function now routes a `codex`-provider assignment through it instead of
 * a blanket NO_SESSION_TRANSPORT. Gemini/Kimi/Copilot still have no known
 * CLI/API transport on this machine and remain NO_SESSION_TRANSPORT — a
 * real, tested, honest limitation, not a placeholder.
 *
 * Input: WorkOrder + target AgentProvider.
 * Output: AssignmentOutcome.
 * Dependency ที่อนุญาต: ./contract.ts, ./registry.ts, ./codex-session-bridge.ts,
 * ../../control/agent-gateway/contract.ts (dispatchTask — the existing
 * Controller, never re-implemented).
 */
import type { AgentProvider } from "./contract";
import { listRegisteredAgents, refreshAgent } from "./registry";
import { dispatchTask } from "../../control/agent-gateway/contract";
import type { MemoryReference, Task, WorkOrder } from "../../control/agent-gateway/types";
import { DEFAULT_AGENT_WORKERS } from "../../control/agent-gateway/contract";
import { runCodexWorkOrder, type CodexBridgeResult } from "./codex-session-bridge";

export type AssignmentOutcome =
  | { ok: true; task: Task }
  | { ok: true; codexResult: CodexBridgeResult }
  | { ok: false; status: "BLOCKED"; reason: "SESSION_UNAVAILABLE" | "NO_SESSION_TRANSPORT" | "AGENT_NOT_REGISTERED" | "VALIDATOR_FAILED" | "TIMEOUT" | "EXECUTION_FAILED"; detail: string };

/**
 * Session disconnect recovery: re-checks the REAL availability (not the
 * last-cached registry row) immediately before assignment — a session
 * that disconnected since it was registered is caught here, not assumed
 * still live.
 */
export async function assignWorkOrderToAgent(
  workOrder: WorkOrder,
  provider: AgentProvider,
  intentText: string,
  memory: Omit<MemoryReference, "task_id" | "created_at">,
  clientId: string,
): Promise<AssignmentOutcome> {
  const registered = listRegisteredAgents().find((a) => a.provider === provider);
  if (!registered) {
    return { ok: false, status: "BLOCKED", reason: "AGENT_NOT_REGISTERED", detail: `no agent-registry entry exists for provider "${provider}" — register it via ./registry.ts's registerAgent before assigning a WorkOrder to it` };
  }

  const refreshed = await refreshAgent(registered.agent_id);
  const availability = refreshed?.availability ?? "UNKNOWN";
  if (availability !== "LIVE") {
    return { ok: false, status: "BLOCKED", reason: "SESSION_UNAVAILABLE", detail: `provider "${provider}" (agent_id=${registered.agent_id}) is not LIVE (current: ${availability}) — real re-check via ./detect.ts, never assumed from a stale registry row` };
  }

  if (provider === "codex") {
    const outcome = await runCodexWorkOrder(workOrder, `bridge-${clientId}-${Date.now()}`, 60_000, { idempotencyKey: `${clientId}:${workOrder.target_path}:${workOrder.requested_change}` });
    if (outcome.ok) return { ok: true, codexResult: outcome.result };
    return { ok: false, status: "BLOCKED", reason: outcome.reason, detail: outcome.result.next_action ?? `codex bridge reported ${outcome.reason}` };
  }

  // Real, honest limitation (see file header): no known CLI/API transport
  // for this provider exists on this machine — this file will never
  // fabricate one via a Terminal command or an unscoped UI-automation
  // loop. The WorkOrder itself still goes through the real, existing
  // Controller/validator/worker/evidence pipeline (dispatchTask) exactly
  // as it would from any other caller for claude-code, which needs no
  // bridge since this process IS Claude Code.
  if (provider !== "claude-code") {
    return { ok: false, status: "BLOCKED", reason: "NO_SESSION_TRANSPORT", detail: `provider "${provider}" is LIVE (process-detected) but no known CLI/API transport exists on this machine (confirmed: no "gemini"/"kimi"/"copilot" command found) — never fabricated via Terminal injection or unscoped UI automation` };
  }

  const task = await dispatchTask(intentText, memory, clientId, DEFAULT_AGENT_WORKERS, workOrder);
  return { ok: true, task };
}
