/**
 * API Worker Adapter (owner, 2026-08-08, Software Factory Step 13.6,
 * Section 4). Reuses the real, existing services/ai/gateway.ts —
 * REUSED, never a duplicate AI Gateway. Only Anthropic gets a real,
 * working adapter here because it is the only real, existing API
 * provider integration in this repo (gateway.ts's real AiProviderName
 * union is "anthropic" | "ollama" — ollama is a LOCAL_RUNTIME adapter,
 * see localModelWorkerAdapter.ts). OpenAI/Gemini are honestly
 * NOT_IMPLEMENTED: a real OPENAI_API_KEY exists in this environment's
 * .env.local, but zero real OpenAI SDK/call code exists anywhere in
 * this repo (grep-verified: no `openai` npm dependency, no `new
 * OpenAI(` call) — an unused key is not a real, existing integration,
 * so building a live adapter for it would violate Section 4's "เฉพาะ
 * Provider ที่มีของเดิมจริง" (existing-integration-only) rule. Gemini has
 * real usage only inside separate Supabase Edge Functions (Deno
 * runtime, LINE chat concern) — unreachable from and unrelated to this
 * Node.js IDE Runtime, so also honestly NOT_IMPLEMENTED here.
 */
import { invokeAiGateway } from "@/services/ai/gateway";
import type { WorkerAdapter, WorkerAvailability, WorkerCostEstimate, WorkerHealthReport, WorkerPreflightResult } from "../workerAdapter";
import type { WorkerRequest, WorkerResponse } from "../workerContract";

let lastLiveCallAt: string | null = null;
let lastLiveCallOk: boolean | null = null;

interface ProposedFileRaw { path: string; operation?: string; content?: string; purpose?: string; risk?: string }

function parseProposal(raw: string): { files: WorkerResponse["proposedChanges"]; answer: string | null } {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) cleaned = cleaned.replace(/^```[a-z]*\n?/i, "").replace(/```$/, "").trim();
  const parsed = JSON.parse(cleaned);
  if (!parsed || !Array.isArray(parsed.files)) throw new Error("response JSON did not contain a real files[] array");
  const files = (parsed.files as ProposedFileRaw[]).map((f) => ({ path: f.path, operation: (f.operation ?? "MODIFY") as WorkerResponse["proposedChanges"][number]["operation"], content: f.content ?? null, purpose: f.purpose ?? "", risk: f.risk ?? "UNKNOWN" }));
  const answer = typeof parsed.answer === "string" && parsed.answer.trim() ? parsed.answer.trim() : null;
  return { files, answer };
}

export const anthropicApiAdapter: WorkerAdapter = {
  id: "anthropic-api", type: "API", provider: "anthropic",
  availability(): WorkerAvailability {
    const configured = !!process.env.ANTHROPIC_API_KEY;
    return { available: configured, reason: configured ? "real ANTHROPIC_API_KEY present" : "no real ANTHROPIC_API_KEY configured in this environment" };
  },
  capabilities() { return ["code.generate"]; },
  estimate(request: WorkerRequest): WorkerCostEstimate {
    const bytes = request.fileContents.reduce((s, f) => s + f.content.length, 0);
    const estimatedTokens = Math.round(bytes / 4) + 500;
    return { estimatedCost: null, estimatedTokens, currency: null, confidence: "LOW" };
  },
  async execute(request: WorkerRequest): Promise<WorkerResponse> {
    const started = Date.now();
    if (!this.availability().available) {
      return { workerRequestId: request.workerRequestId, workerId: "CODE_WORKER", adapterId: this.id, provider: this.provider, model: null, status: "NOT_CONFIGURED", output: null, proposedChanges: [], toolCalls: [], tokenUsage: { input: null, output: null }, cost: { amount: null, currency: null, kind: "UNKNOWN" }, durationMs: Date.now() - started, evidence: [], limitations: ["real ANTHROPIC_API_KEY not configured in this environment"], error: "AI_GATEWAY_ANTHROPIC_NOT_CONFIGURED", finishedAt: new Date().toISOString() };
    }
    const fileBlocks = request.fileContents.map((f) => `--- FILE: ${f.path} ---\n${f.content}`).join("\n\n");
    const prompt = `Task: ${request.taskDescription}\n\nAcceptance Criteria:\n${request.acceptanceCriteria.map((c) => `- ${c}`).join("\n") || "(none)"}\n\nReal, current file contents (the ONLY files you may propose changes to):\n\n${fileBlocks}`;
    const systemPrompt = `You are a code-generation Worker. Respond with ONLY a single, valid JSON object {"answer":"<plain-text answer if the task is a read-only question needing no file change, else null>","files":[{"path":"<one of the given real file paths>","operation":"CREATE|MODIFY|DELETE|RENAME","content":"<new file content, or null for DELETE>","purpose":"<why>","risk":"LOW|MEDIUM|HIGH"}]} — files may be an empty array for a pure question. No markdown fences, no prose outside the JSON object.`;
    const result = await invokeAiGateway({
      origin: "worker-bridge", ownerId: request.workspaceSessionId, sessionId: request.workspaceSessionId,
      capability: "code.generate", effect: "draft", systemPrompt, prompt, maxTokens: Math.min(8000, Math.max(1000, request.maxTokens)),
    });
    lastLiveCallAt = new Date().toISOString();
    lastLiveCallOk = result.ok;
    const durationMs = Date.now() - started;
    if (!result.ok || !result.output) {
      return { workerRequestId: request.workerRequestId, workerId: "CODE_WORKER", adapterId: this.id, provider: this.provider, model: "claude-haiku-4-5-20251001", status: "FAILED", output: null, proposedChanges: [], toolCalls: [], tokenUsage: { input: null, output: null }, cost: { amount: null, currency: null, kind: "UNKNOWN" }, durationMs, evidence: [result.provenance.evidenceId], limitations: [], error: result.error ?? "unknown gateway failure", finishedAt: new Date().toISOString() };
    }
    try {
      const { files, answer } = parseProposal(result.output);
      return { workerRequestId: request.workerRequestId, workerId: "CODE_WORKER", adapterId: this.id, provider: this.provider, model: "claude-haiku-4-5-20251001", status: "SUCCEEDED", output: result.output, answer, proposedChanges: files, toolCalls: [], tokenUsage: { input: null, output: null }, cost: { amount: null, currency: null, kind: "UNKNOWN" }, durationMs, evidence: [result.provenance.evidenceId, result.provenance.requestId], limitations: ["real per-token cost is not exposed by services/ai/gateway.ts"], error: null, finishedAt: new Date().toISOString() };
    } catch (e) {
      return { workerRequestId: request.workerRequestId, workerId: "CODE_WORKER", adapterId: this.id, provider: this.provider, model: "claude-haiku-4-5-20251001", status: "FAILED", output: result.output, proposedChanges: [], toolCalls: [], tokenUsage: { input: null, output: null }, cost: { amount: null, currency: null, kind: "UNKNOWN" }, durationMs, evidence: [result.provenance.evidenceId], limitations: [], error: `real response did not match the required structured schema: ${e instanceof Error ? e.message : String(e)}`, finishedAt: new Date().toISOString() };
    }
  },
  async health(): Promise<WorkerHealthReport> {
    if (!this.availability().available) return { status: "NOT_CONFIGURED", reason: "no real ANTHROPIC_API_KEY configured", lastLiveCallAt, lastLiveCallOk };
    if (lastLiveCallAt === null) return { status: "UNKNOWN", reason: "configured, but no real live call has ever been made this process — Configured ≠ Healthy", lastLiveCallAt, lastLiveCallOk };
    return { status: lastLiveCallOk ? "HEALTHY" : "DEGRADED", reason: lastLiveCallOk ? "most recent real live call succeeded" : "most recent real live call failed", lastLiveCallAt, lastLiveCallOk };
  },
  // Real, CHEAP preflight (owner, 2026-08-08, Owner Command Surface fix)
  // — mirrors cliWorkerAdapter.ts's real pattern: without this, every
  // adapter lacking preflight() falls to tier 2 in
  // workerSelectorRuntime.ts#computePreflightTier, while human-worker is
  // hardcoded to tier 1 — meaning this adapter could never outrank
  // Human Worker even with a real, valid key configured. Never spends a
  // real token: only checks real env var presence, or defers to a
  // stronger real live-call result already observed this process.
  async preflight(): Promise<WorkerPreflightResult> {
    const checkedAt = new Date().toISOString();
    const avail = this.availability();
    if (!avail.available) return { status: "UNAVAILABLE", reason: avail.reason, checkedAt, costIncurred: false };
    if (lastLiveCallAt !== null) {
      return lastLiveCallOk
        ? { status: "HEALTHY", reason: "a real, live LLM call already succeeded this process — stronger evidence than config-only preflight", checkedAt, costIncurred: false }
        : { status: "FAILED", reason: "the most recent real, live LLM call this process failed", checkedAt, costIncurred: false };
    }
    return { status: "AVAILABLE", reason: "real, free, local preflight passed — real ANTHROPIC_API_KEY is present (no real live LLM call made yet this process)", checkedAt, costIncurred: false };
  },
  limitations() { return ["single model (claude-haiku-4-5-20251001) hardcoded in the real gateway", "no real per-call cost number exposed"]; },
};

export const openaiApiAdapter: WorkerAdapter = {
  id: "openai-api", type: "API", provider: "openai",
  availability(): WorkerAvailability { return { available: false, reason: "real OPENAI_API_KEY exists in .env.local but zero real OpenAI SDK/call code exists anywhere in this repo — not a real, existing integration to adapt" }; },
  capabilities() { return []; },
  estimate() { return { estimatedCost: null, estimatedTokens: null, currency: null, confidence: "UNKNOWN" }; },
  async execute(request: WorkerRequest): Promise<WorkerResponse> {
    return { workerRequestId: request.workerRequestId, workerId: "CODE_WORKER", adapterId: this.id, provider: this.provider, model: null, status: "NOT_SUPPORTED", output: null, proposedChanges: [], toolCalls: [], tokenUsage: { input: null, output: null }, cost: { amount: null, currency: null, kind: "UNKNOWN" }, durationMs: 0, evidence: [], limitations: ["no real OpenAI integration exists in this repo"], error: "NOT_IMPLEMENTED", finishedAt: new Date().toISOString() };
  },
  async health(): Promise<WorkerHealthReport> { return { status: "NOT_CONFIGURED", reason: "no real, existing OpenAI integration in this repo", lastLiveCallAt: null, lastLiveCallOk: null }; },
  limitations() { return ["NOT_IMPLEMENTED — no real OpenAI SDK usage exists anywhere in this repo"]; },
};

export const geminiApiAdapter: WorkerAdapter = {
  id: "gemini-api", type: "API", provider: "gemini",
  availability(): WorkerAvailability { return { available: false, reason: "real Gemini usage exists only inside separate Supabase Edge Functions (Deno runtime, LINE chat concern) — unreachable from this Node.js IDE Runtime" }; },
  capabilities() { return []; },
  estimate() { return { estimatedCost: null, estimatedTokens: null, currency: null, confidence: "UNKNOWN" }; },
  async execute(request: WorkerRequest): Promise<WorkerResponse> {
    return { workerRequestId: request.workerRequestId, workerId: "CODE_WORKER", adapterId: this.id, provider: this.provider, model: null, status: "NOT_SUPPORTED", output: null, proposedChanges: [], toolCalls: [], tokenUsage: { input: null, output: null }, cost: { amount: null, currency: null, kind: "UNKNOWN" }, durationMs: 0, evidence: [], limitations: ["no reachable real Gemini integration in this Runtime"], error: "NOT_IMPLEMENTED", finishedAt: new Date().toISOString() };
  },
  async health(): Promise<WorkerHealthReport> { return { status: "NOT_CONFIGURED", reason: "real Gemini integration exists elsewhere (Supabase Edge Functions) but is unreachable from this Runtime", lastLiveCallAt: null, lastLiveCallOk: null }; },
  limitations() { return ["NOT_IMPLEMENTED in this Runtime — real usage is confined to separate Edge Functions"]; },
};
