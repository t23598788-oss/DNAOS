/**
 * MCP Worker Adapter (owner, 2026-08-08, Software Factory Step 13.6,
 * Section 6). Reuse investigation (real, grep-verified): this repo has
 * a real `dna-os-mcp-server` directory and real routes under
 * `app/api/v1/mcp/*` — but those make DNA OS an MCP SERVER (exposing
 * itself to external tools like Claude Desktop/Codex), the OPPOSITE
 * direction from what a Worker Adapter needs (DNA OS as an MCP CLIENT
 * calling OUT to external tools). No real MCP client abstraction exists
 * anywhere in this repo. Per Section 6's explicit instruction
 * ("ถ้าไม่มี: สร้างเฉพาะ Contract/Foundation"), this file is honestly
 * FOUNDATION_ONLY — it declares the real contract shape and always
 * returns NOT_SUPPORTED; it never fabricates a working tool call.
 */
import type { WorkerAdapter, WorkerAvailability, WorkerCostEstimate, WorkerHealthReport } from "../workerAdapter";
import type { WorkerRequest, WorkerResponse } from "../workerContract";

export const mcpWorkerAdapter: WorkerAdapter = {
  id: "mcp-foundation", type: "MCP", provider: "mcp",
  // Real, honest costClass (Rule 257) — UNKNOWN_COST: FOUNDATION_ONLY,
  // no real MCP client exists, no real cost model has ever been
  // established for whatever external tool a future real client might
  // call — never assumed FREE just because it's unreachable today.
  costClass: "UNKNOWN_COST",
  availability(): WorkerAvailability {
    return { available: false, reason: "no real MCP CLIENT abstraction exists in this repo — dna-os-mcp-server/app/api/v1/mcp/* make DNA OS an MCP SERVER, the opposite direction; FOUNDATION_ONLY this Step" };
  },
  capabilities() { return []; },
  estimate(): WorkerCostEstimate { return { estimatedCost: null, estimatedTokens: null, currency: null, confidence: "UNKNOWN" }; },
  async execute(request: WorkerRequest): Promise<WorkerResponse> {
    return {
      workerRequestId: request.workerRequestId, workerId: "CODE_WORKER", adapterId: this.id, provider: this.provider, model: null,
      status: "NOT_SUPPORTED", output: null, proposedChanges: [], toolCalls: [], tokenUsage: { input: null, output: null },
      cost: { amount: null, currency: null, kind: "UNKNOWN" }, durationMs: 0, evidence: [],
      limitations: ["no real MCP client exists in this repo — this is a real, honest Contract/Foundation only, per Section 6"],
      error: "MCP_CLIENT_NOT_IMPLEMENTED", finishedAt: new Date().toISOString(),
    };
  },
  async health(): Promise<WorkerHealthReport> {
    return { status: "NOT_CONFIGURED", reason: "no real MCP client exists in this repo", lastLiveCallAt: null, lastLiveCallOk: null };
  },
  limitations() { return ["FOUNDATION_ONLY — real MCP client implementation (tool discovery, argument validation, structured response mapping) is future work, not built this Step"]; },
};
