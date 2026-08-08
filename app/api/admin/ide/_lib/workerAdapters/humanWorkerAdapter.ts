/**
 * Human Worker Adapter (owner, 2026-08-08, Software Factory Step 13.6,
 * Section 14). A real Adapter — not a hidden fallback. Used when no
 * real AI Worker is suitable, no Provider is ready, risk is high, the
 * Owner must decide, a tool needs an interactive session, or an
 * external action needs a human. Always honestly reports
 * OWNER_ACTION_REQUIRED (via BLOCKED status + an explicit limitation
 * string, since BLOCKED is the closest real status in the Section 2
 * enum — this Adapter never claims SUCCEEDED for a human action DNA OS
 * itself did not perform).
 */
import type { WorkerAdapter, WorkerAvailability, WorkerCostEstimate, WorkerHealthReport } from "../workerAdapter";
import type { WorkerRequest, WorkerResponse } from "../workerContract";

export const humanWorkerAdapter: WorkerAdapter = {
  id: "human-worker", type: "HUMAN", provider: "human",
  availability(): WorkerAvailability { return { available: true, reason: "the real, human Owner is always a real, available fallback" }; },
  capabilities() { return ["code.generate", "analysis", "review", "decision", "external-action"]; },
  estimate(): WorkerCostEstimate { return { estimatedCost: null, estimatedTokens: null, currency: null, confidence: "UNKNOWN" }; },
  async execute(request: WorkerRequest): Promise<WorkerResponse> {
    return {
      workerRequestId: request.workerRequestId, workerId: "HUMAN_WORKER", adapterId: this.id, provider: this.provider, model: null,
      status: "BLOCKED", output: null, proposedChanges: [], toolCalls: [], tokenUsage: { input: null, output: null },
      cost: { amount: null, currency: null, kind: "UNKNOWN" }, durationMs: 0, evidence: [],
      limitations: ["OWNER_ACTION_REQUIRED — this real action requires the human Owner to act; DNA OS never performs it automatically"],
      error: null, finishedAt: new Date().toISOString(),
    };
  },
  async health(): Promise<WorkerHealthReport> { return { status: "HEALTHY", reason: "the human Owner is real and always available by definition", lastLiveCallAt: null, lastLiveCallOk: null }; },
  limitations() { return ["never automated — deliberately, always requires real, explicit Owner action"]; },
};
