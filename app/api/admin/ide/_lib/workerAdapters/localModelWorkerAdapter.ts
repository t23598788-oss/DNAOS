/**
 * Local Model Worker Adapter (owner, 2026-08-08, Software Factory Step
 * 13.6, Section 7). Reuses the real, existing services/ai/gateway.ts
 * Ollama integration (AI_GATEWAY_OLLAMA_URL env var, real
 * ollamaProvider()) — never a second local-model HTTP client. Local
 * Model gets NO special privilege: it must go through the exact same
 * real Context Planner / Worker Contract / Budget / File Scope / Change
 * Set / Evidence path as every cloud provider (Section 7).
 *
 * REAL LIVE CHECK (this Step, 2026-08-08): real `ollama` binary exists
 * at /opt/homebrew/bin/ollama on this machine, but no real server is
 * reachable at the default real endpoint (http://localhost:11434) and
 * no real AI_GATEWAY_OLLAMA_URL is configured — honestly NOT_CONFIGURED.
 */
import { invokeAiGateway } from "@/services/ai/gateway";
import type { WorkerAdapter, WorkerAvailability, WorkerCostEstimate, WorkerHealthReport } from "../workerAdapter";
import type { WorkerRequest, WorkerResponse } from "../workerContract";

interface ProposedFileRaw { path: string; operation?: string; content?: string; purpose?: string; risk?: string }

function parseProposal(raw: string): WorkerResponse["proposedChanges"] {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) cleaned = cleaned.replace(/^```[a-z]*\n?/i, "").replace(/```$/, "").trim();
  const parsed = JSON.parse(cleaned);
  if (!parsed || !Array.isArray(parsed.files)) throw new Error("response JSON did not contain a real files[] array");
  return (parsed.files as ProposedFileRaw[]).map((f) => ({ path: f.path, operation: (f.operation ?? "MODIFY") as WorkerResponse["proposedChanges"][number]["operation"], content: f.content ?? null, purpose: f.purpose ?? "", risk: f.risk ?? "UNKNOWN" }));
}

let lastLiveCallAt: string | null = null;
let lastLiveCallOk: boolean | null = null;

/** Real, live, short-timeout reachability check against the real
 * configured endpoint — never inferred from env presence alone. */
export async function realOllamaReachabilityCheck(baseUrl: string, fetchFn: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchFn(`${baseUrl.replace(/\/$/, "")}/api/tags`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch { return false; }
}

export const ollamaLocalAdapter: WorkerAdapter = {
  id: "ollama-local", type: "LOCAL_RUNTIME", provider: "ollama",
  // Real, honest costClass (Rule 257) — FREE: real, local inference,
  // no metered provider — this file's own estimate()/execute() below
  // already report a real $0 ACTUAL cost (not a guess), consistent
  // with every other real, local-only Worker in this repo.
  costClass: "FREE",
  availability(): WorkerAvailability {
    const baseUrl = process.env.AI_GATEWAY_OLLAMA_URL;
    return { available: !!baseUrl, reason: baseUrl ? `real AI_GATEWAY_OLLAMA_URL configured: ${baseUrl}` : "no real AI_GATEWAY_OLLAMA_URL configured in this environment" };
  },
  capabilities() { return ["code.generate"]; },
  estimate(): WorkerCostEstimate { return { estimatedCost: 0, estimatedTokens: null, currency: "USD", confidence: "HIGH" }; },
  async execute(request: WorkerRequest): Promise<WorkerResponse> {
    const started = Date.now();
    const avail = this.availability();
    if (!avail.available) {
      return { workerRequestId: request.workerRequestId, workerId: "CODE_WORKER", adapterId: this.id, provider: this.provider, model: null, status: "NOT_CONFIGURED", output: null, proposedChanges: [], toolCalls: [], tokenUsage: { input: null, output: null }, cost: { amount: 0, currency: "USD", kind: "ACTUAL" }, durationMs: Date.now() - started, evidence: [], limitations: [avail.reason], error: "AI_GATEWAY_OLLAMA_NOT_CONFIGURED", finishedAt: new Date().toISOString() };
    }
    const fileBlocks = request.fileContents.map((f) => `--- FILE: ${f.path} ---\n${f.content}`).join("\n\n");
    const prompt = `Respond with ONLY a single, valid JSON object {"files":[{"path":"<real file path>","operation":"CREATE|MODIFY|DELETE|RENAME","content":"<new content or null>","purpose":"<why>","risk":"LOW|MEDIUM|HIGH"}]}. Task: ${request.taskDescription}\n\nReal file contents:\n${fileBlocks}`;
    const result = await invokeAiGateway({
      origin: "worker-bridge", ownerId: request.workspaceSessionId, sessionId: request.workspaceSessionId,
      capability: "conversation.answer", effect: "draft", prompt, providerHint: "ollama", maxTokens: Math.min(4000, request.maxTokens),
    });
    lastLiveCallAt = new Date().toISOString();
    lastLiveCallOk = result.ok;
    const durationMs = Date.now() - started;
    if (!result.ok || !result.output) {
      return { workerRequestId: request.workerRequestId, workerId: "CODE_WORKER", adapterId: this.id, provider: this.provider, model: process.env.AI_GATEWAY_OLLAMA_MODEL ?? "unknown", status: "FAILED", output: null, proposedChanges: [], toolCalls: [], tokenUsage: { input: null, output: null }, cost: { amount: 0, currency: "USD", kind: "ACTUAL" }, durationMs, evidence: [result.provenance.evidenceId], limitations: [], error: result.error ?? "unknown local model failure", finishedAt: new Date().toISOString() };
    }
    try {
      const files = parseProposal(result.output);
      return { workerRequestId: request.workerRequestId, workerId: "CODE_WORKER", adapterId: this.id, provider: this.provider, model: process.env.AI_GATEWAY_OLLAMA_MODEL ?? "unknown", status: "SUCCEEDED", output: result.output, proposedChanges: files, toolCalls: [], tokenUsage: { input: null, output: null }, cost: { amount: 0, currency: "USD", kind: "ACTUAL" }, durationMs, evidence: [result.provenance.evidenceId], limitations: ["local model output quality is not validated by this Runtime"], error: null, finishedAt: new Date().toISOString() };
    } catch (e) {
      return { workerRequestId: request.workerRequestId, workerId: "CODE_WORKER", adapterId: this.id, provider: this.provider, model: process.env.AI_GATEWAY_OLLAMA_MODEL ?? "unknown", status: "FAILED", output: result.output, proposedChanges: [], toolCalls: [], tokenUsage: { input: null, output: null }, cost: { amount: 0, currency: "USD", kind: "ACTUAL" }, durationMs, evidence: [result.provenance.evidenceId], limitations: [], error: `real response did not match the required structured schema: ${e instanceof Error ? e.message : String(e)}`, finishedAt: new Date().toISOString() };
    }
  },
  async health(): Promise<WorkerHealthReport> {
    const avail = this.availability();
    if (!avail.available) return { status: "NOT_CONFIGURED", reason: avail.reason, lastLiveCallAt, lastLiveCallOk };
    const reachable = await realOllamaReachabilityCheck(process.env.AI_GATEWAY_OLLAMA_URL!);
    if (!reachable) return { status: "UNAVAILABLE", reason: "real endpoint configured but not reachable on a real, live check", lastLiveCallAt, lastLiveCallOk };
    if (lastLiveCallAt === null) return { status: "UNKNOWN", reason: "real endpoint reachable, but no real live generation call has been made this process — Configured ≠ Healthy", lastLiveCallAt, lastLiveCallOk };
    return { status: lastLiveCallOk ? "HEALTHY" : "DEGRADED", reason: lastLiveCallOk ? "most recent real live call succeeded" : "most recent real live call failed", lastLiveCallAt, lastLiveCallOk };
  },
  limitations() { return ["real per-token cost model is not published for local inference — reported as real $0 ACTUAL cost, not a guess", "local model output quality/instruction-following is not validated by this Runtime"]; },
};
