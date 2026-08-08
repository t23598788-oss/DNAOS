/**
 * Worker Adapter Interface (owner, 2026-08-08, Software Factory Step
 * 13.6, Section 3). The one real interface every real Adapter
 * (API/CLI/MCP/Local/Remote/Human) implements. Core Runtime code only
 * ever calls through this interface — provider-specific code (Anthropic
 * SDK, execFile argv, HTTP to a local endpoint) lives ONLY inside a real
 * Adapter file, never in factoryWorkspaceRuntime.ts/codeWorkerRuntime.ts.
 */
import type { WorkerAdapterType, WorkerRequest, WorkerResponse } from "./workerContract";

export type WorkerHealthStatus = "HEALTHY" | "DEGRADED" | "NOT_CONFIGURED" | "UNAVAILABLE" | "UNKNOWN";

export interface WorkerHealthReport {
  status: WorkerHealthStatus;
  reason: string;
  lastLiveCallAt: string | null;
  lastLiveCallOk: boolean | null;
}

export interface WorkerAvailability {
  available: boolean;
  reason: string;
}

// ============================================================
// Real, CHEAP preflight (owner, 2026-08-07, Worker Selector ranking
// fix). Distinct from health() above — preflight() checks real local
// runtime/auth/config state ONLY, NEVER spends a real LLM call/token.
// Used by workerSelectorRuntime.ts to decide per-invocation ranking
// priority against Human Worker without requiring a full, costed live
// call first (the chicken-and-egg gap found live 2026-08-07: an AI
// Adapter's health() legitimately starts UNKNOWN every fresh process,
// and Human Worker's health() is always HEALTHY, so a pure health()-only
// ranking could never let an unproven-but-real AI Adapter outrank the
// human fallback). REGISTERED/CONFIGURED/AVAILABLE/UNAVAILABLE/FAILED
// are real preflight-only states — HEALTHY here still means "proven via
// preflight only," never conflated with health()'s stricter, live-call-
// only HEALTHY meaning.
// ============================================================
export type WorkerPreflightStatus = "REGISTERED" | "CONFIGURED" | "AVAILABLE" | "HEALTHY" | "UNAVAILABLE" | "FAILED";

export interface WorkerPreflightResult {
  status: WorkerPreflightStatus;
  reason: string;
  checkedAt: string;
  /** Always false — a real, structural guarantee that preflight() never
   * spends a real token/LLM call. Verified by regression test. */
  costIncurred: false;
}

export interface WorkerCostEstimate {
  estimatedCost: number | null;
  estimatedTokens: number | null;
  currency: string | null;
  confidence: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
}

export interface WorkerAdapter {
  id: string;
  type: WorkerAdapterType;
  provider: string;
  /** Real, deterministic, synchronous check — real config/binary/env
   * presence only, never a live network call (that's health()'s job). */
  availability(): WorkerAvailability;
  capabilities(): string[];
  /** Real, deterministic cost estimate from real request size — never
   * fabricates a number when the real cost model is unknown. */
  estimate(request: WorkerRequest): WorkerCostEstimate;
  /** Real invocation. Must never throw for an expected failure mode
   * (NOT_CONFIGURED/NOT_SUPPORTED/TIMEOUT) — those are real
   * WorkerResponse.status values, not exceptions. */
  execute(request: WorkerRequest): Promise<WorkerResponse>;
  /** Real health — MUST NOT return HEALTHY purely from config presence;
   * only a real, recent, successful live call may report HEALTHY. */
  health(): Promise<WorkerHealthReport>;
  limitations(): string[];
  /** Optional, real, CHEAP preflight — never spends a real token/LLM
   * call. Adapters that don't implement this are simply not eligible for
   * preflight-based Worker Selector priority (falls back to the
   * existing health()-based ranking, unchanged). */
  preflight?(): Promise<WorkerPreflightResult>;
}
