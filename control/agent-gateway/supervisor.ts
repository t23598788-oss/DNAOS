import { recoverInterruptedTasks } from "./gateway";
import { runVoiceAnnouncementSweep } from "./voice-bridge";
import type { AgentAdapter } from "./types";
import { startTaskController } from "./controller";

export interface SupervisorHandle {
  stop(): void;
}

/** Process supervisor for the existing Agent Gateway. It does not create a
 * second queue or router: it recovers the durable task log on boot and emits
 * a heartbeat so the transport can expose liveness.
 *
 * 2026-08-20: also runs the Voice Bridge's announcement sweep on the SAME
 * existing 30s timer (no second interval/queue) — a no-op when
 * isVoiceBridgeEnabled() is false, see ./voice-bridge.ts's own header for
 * the approval-gate/idempotent-restart guarantees. */
export function startAgentGatewaySupervisor(adapters: readonly AgentAdapter[]): SupervisorHandle {
  const controller = startTaskController();
  recoverInterruptedTasks();
  void runVoiceAnnouncementSweep();
  const timer = setInterval(() => {
    recoverInterruptedTasks();
    void runVoiceAnnouncementSweep();
    void adapters;
  }, 30_000);
  return { stop: () => { clearInterval(timer); controller.stop(); } };
}
