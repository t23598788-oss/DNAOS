/**
 * DigitalOcean Worker Adapter (owner, 2026-08-10, DigitalOcean AI
 * Inference Discovery → Implementation). Calls DigitalOcean's real
 * Serverless Inference API directly
 * (https://inference.do-ai.run/v1/chat/completions, OpenAI-compatible)
 * via plain fetch — no SDK needed (see
 * DIGITALOCEAN_AI_INFERENCE_DISCOVERY_REPORT.md §3). Not routed through
 * services/ai/gateway.ts: that file's AiProviderName union is closed to
 * "anthropic" | "ollama" and widening it was flagged optional, not
 * required (report §12) — this adapter calls DigitalOcean directly, the
 * same way openaiApiAdapter/geminiApiAdapter in apiWorkerAdapter.ts would
 * if they were real (anthropicApiAdapter goes through gateway.ts only
 * because that provider already existed there before Worker Adapters
 * did).
 *
 * Real, disclosed limits (Discovery Report §7-9, §16):
 * - Only 2 model slugs have a confirmed-real per-token rate in the rate
 *   table below (gpt-oss-120b, llama3.3-70b-instruct) — any other
 *   configured model legitimately returns cost.kind="UNKNOWN", never a
 *   fabricated number.
 * - Default DIGITALOCEAN_INFERENCE_MODEL is "llama3-8b-instruct" — the
 *   one model slug independently confirmed real from DigitalOcean's own
 *   official tutorial (community/tutorials/serverless-inference-openai-sdk),
 *   chosen for connectivity-proof reliability, not cost/quality. Its own
 *   per-token rate was NOT confirmed this pass, so its cost.kind is
 *   "UNKNOWN" until confirmed — swapping to a coding-optimized model
 *   (Qwen3 Coder Flash / GPT-5.3-Codex) requires confirming both its real
 *   slug AND its real rate together first, not assuming either.
 * - Streaming and tool-calling are NOT implemented here — Discovery
 *   Report §8/§9 found neither explicitly confirmed in official docs
 *   fetched that pass; this adapter only exercises the plain,
 *   non-streaming chat completion path.
 *
 * Real credential source (owner, 2026-08-11, TASK-081 — closes the real
 * gap MANAGER-07 found: no real UI path let a human actually fill in a
 * DigitalOcean credential). Extends (does not replace) the original
 * env-var-only adapter: credential/config resolution now checks the
 * real Connectors DB FIRST (gateway/connectors.ts#listConnectors(), a
 * connector whose slug starts with "digitalocean" — same pattern
 * scripts/register-tiktok-connector.ts already uses), falling back to
 * the original DIGITALOCEAN_INFERENCE_API_KEY/DIGITALOCEAN_INFERENCE_MODEL
 * env vars only when no real, usable connector row exists. "Usable"
 * respects the real Connect → Register → Test → Enable lifecycle already
 * enforced by gateway/connectors.ts: enabled === true && status ===
 * "connected" — a merely-created-but-untested connector is never treated
 * as usable. Field shape matches the real, live, generic "Add Connector →
 * API Key" form at /admin/connectors exactly (see
 * app/admin/connectors/_components/ConnectorCenterPanel.tsx's
 * FIELDS_BY_TYPE.api_key): config.base_url, config.header_name,
 * config.header_prefix, secret.api_key — plus an optional config.model
 * so a human can override the model per-connector without redeploying an
 * env var; absent, model resolution falls back to the pre-existing
 * DIGITALOCEAN_INFERENCE_MODEL/DEFAULT_MODEL logic unchanged.
 *
 * Real architecture constraint: availability() (workerAdapter.ts) is
 * documented as synchronous/local-only, never a live network call — but
 * a Connectors DB lookup is an async Supabase read. Resolved the same
 * way this file already resolves the health()/preflight() chicken-and-
 * egg gap: a module-level cache (mirrors this file's own pre-existing
 * lastLiveCallAt/lastLiveCallOk pattern), populated by a real,
 * DB-read-only preflight() call (never spends a token — a Supabase read
 * is not an LLM call, compliant with preflight()'s own contract) and
 * refreshed by execute()/health() too. availability() stays synchronous
 * and reads ONLY that cache: never-yet-checked-this-process → false with
 * an honest "not checked yet" reason; last real check found a usable
 * connector or a real env var → true; neither → false with the real
 * reason.
 *
 * Real, disclosed limitation (verified, not assumed, 2026-08-11):
 * workerSelectorRuntime.ts#selectWorker() filters eligibility from
 * adapter.availability() BEFORE it ever calls adapter.preflight() (
 * preflight() is only invoked afterward, on already-eligible candidates,
 * purely to compute ranking tier). So on a fresh process, the real live
 * dispatch path (codeWorkerRuntime.ts → selectWorker()) never calls
 * preflight() before the eligibility check — meaning this adapter's
 * cache starts cold and availability() honestly reports false on the
 * very first real request of a process, even if a usable connector (or
 * env var) really exists, until something (a manual preflight() call, a
 * prior execute()/health() this process, or a future selectWorker() fix)
 * populates the cache. This is a real, disclosed gap in the selection
 * path, not something this adapter alone can fix without widening
 * selectWorker()'s own eligibility check — out of this task's scope
 * (extend the adapter, not rebuild the Router).
 */
import type { WorkerAdapter, WorkerAvailability, WorkerCostEstimate, WorkerHealthReport, WorkerPreflightResult } from "../workerAdapter";
import type { WorkerRequest, WorkerResponse } from "../workerContract";
import { listConnectors } from "@/gateway/connectors";

const API_BASE_URL = "https://inference.do-ai.run/v1";
const DEFAULT_MODEL = "llama3-8b-instruct";

/** Real, confirmed-from-official-docs per-million-token rates (USD) — see
 * DIGITALOCEAN_AI_INFERENCE_DISCOVERY_REPORT.md §7. Only these two model
 * slugs are populated; any other model legitimately returns cost.kind
 * "UNKNOWN" below rather than a guessed number. */
const CONFIRMED_RATE_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  "gpt-oss-120b": { input: 0.10, output: 0.70 },
  "llama3.3-70b-instruct": { input: 0.65, output: 0.65 },
};

function computeCost(model: string, inputTokens: number | null, outputTokens: number | null): WorkerResponse["cost"] {
  const rate = CONFIRMED_RATE_PER_MILLION_TOKENS[model];
  if (!rate || inputTokens === null || outputTokens === null) {
    return { amount: null, currency: null, kind: "UNKNOWN" };
  }
  const amount = (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output;
  return { amount, currency: "USD", kind: "ACTUAL" };
}

let lastLiveCallAt: string | null = null;
let lastLiveCallOk: boolean | null = null;

/** Real, resolved credential/config — either sourced from a real, usable
 * Connectors DB row or from the pre-existing env var fallback. Never
 * holds a fabricated or partially-guessed value: apiKey/baseUrl are
 * always both real and present together, or the whole resolution is
 * null (see resolveCredentials()). */
interface ResolvedCredential {
  apiKey: string;
  baseUrl: string;
  headerName: string;
  headerPrefix: string;
  /** Real, optional per-connector model override (connector.config.model).
   * null means "no override" — callers fall back to the pre-existing
   * DIGITALOCEAN_INFERENCE_MODEL/DEFAULT_MODEL logic, never silently
   * dropping that ability. */
  model: string | null;
  source: "CONNECTOR_DB" | "ENV_VAR";
}

// Real, module-level cache — mirrors this file's own pre-existing
// lastLiveCallAt/lastLiveCallOk pattern (same shape: a value + a "have we
// ever checked this process" timestamp). Populated by resolveCredentials()
// (async, DB-read only) via preflight()/execute()/health(); read
// synchronously-only by availability() and estimate(). See this file's
// header comment for the full real architecture rationale.
let cachedCredential: ResolvedCredential | null = null;
let cachedCredentialResolvedAt: string | null = null;

// Real, test-only injection seam — mirrors this repo's own established
// __debug*-prefixed pattern (e.g. codeWorkerRuntime.ts#__debugProposalCount)
// for exposing a narrow, real hook a regression test can use without a
// full ESM module-mocking framework (this repo has none). Never read or
// written by any real runtime code path — only resolveCredentials() below
// calls through listConnectorsImpl, which defaults to the real, live
// gateway/connectors.ts#listConnectors.
let listConnectorsImpl: typeof listConnectors = listConnectors;
export function __setListConnectorsForTest(fn: typeof listConnectors | null): void {
  listConnectorsImpl = fn ?? listConnectors;
}
export function __resetCredentialCacheForTest(): void {
  cachedCredential = null;
  cachedCredentialResolvedAt = null;
  // Also resets the pre-existing lastLiveCallAt/lastLiveCallOk cache —
  // both are the same category of process-persistent mutable state this
  // Adapter keeps, and a regression test asserting on fresh
  // preflight()/availability() behavior needs both cold, not just the
  // credential cache, or a real failed/succeeded live call from an
  // earlier test case would leak into a later one's expected outcome.
  lastLiveCallAt = null;
  lastLiveCallOk = null;
}

/**
 * Real credential resolution — Connectors DB first, env var fallback
 * (TASK-081). Async because a real Connectors DB lookup is a Supabase
 * read; never called from availability() itself (which must stay
 * synchronous) — only from preflight()/execute()/health(), all of which
 * are already real, async entry points on this Adapter.
 *
 * Real "usable" condition (respects the real Connect → Register → Test →
 * Enable lifecycle already enforced by gateway/connectors.ts — never
 * treats a merely-created-but-untested connector as usable):
 * connector.enabled === true && connector.status === "connected".
 */
async function resolveCredentials(): Promise<void> {
  try {
    const connectors = await listConnectorsImpl();
    const usable = connectors.find((c) => c.slug.startsWith("digitalocean") && c.enabled === true && c.status === "connected");
    if (usable) {
      const config = usable.config as Record<string, unknown>;
      const secret = usable.secret as Record<string, unknown>;
      const apiKey = typeof secret.api_key === "string" && secret.api_key ? secret.api_key : null;
      const baseUrl = typeof config.base_url === "string" && config.base_url ? config.base_url.replace(/\/+$/, "") : null;
      if (apiKey && baseUrl) {
        cachedCredential = {
          apiKey,
          baseUrl,
          headerName: typeof config.header_name === "string" && config.header_name ? config.header_name : "Authorization",
          headerPrefix: typeof config.header_prefix === "string" ? config.header_prefix : "Bearer ",
          model: typeof config.model === "string" && config.model ? config.model : null,
          source: "CONNECTOR_DB",
        };
        cachedCredentialResolvedAt = new Date().toISOString();
        return;
      }
      // Real, honest fallback: a usable connector row exists (enabled +
      // connected) but is missing a real api_key/base_url value — never
      // trusted half-configured; falls through to the env var check below
      // exactly as if no connector existed.
    }
  } catch {
    // Real, honest fallback — a Connectors DB read failure (e.g. this
    // environment's DB is unreachable) never blocks the pre-existing env
    // var path below; not surfaced as a fatal error here.
  }
  const envKey = process.env.DIGITALOCEAN_INFERENCE_API_KEY;
  cachedCredential = envKey
    ? { apiKey: envKey, baseUrl: API_BASE_URL, headerName: "Authorization", headerPrefix: "Bearer ", model: process.env.DIGITALOCEAN_INFERENCE_MODEL || null, source: "ENV_VAR" }
    : null;
  cachedCredentialResolvedAt = new Date().toISOString();
}

interface DoChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

async function callDigitalOcean(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  timeoutMs: number,
  baseUrl: string,
  headerName: string,
  headerPrefix: string
): Promise<{ ok: true; content: string; inputTokens: number | null; outputTokens: number | null } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", [headerName]: `${headerPrefix}${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: maxTokens,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = (await res.json().catch(() => null)) as DoChatCompletionResponse | null;
    if (!res.ok) {
      return { ok: false, error: `DigitalOcean API HTTP ${res.status}: ${body?.error?.message ?? "no error body"}` };
    }
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      return { ok: false, error: "DigitalOcean API returned HTTP 200 but no real message content" };
    }
    return {
      ok: true,
      content: content.trim(),
      inputTokens: body?.usage?.prompt_tokens ?? null,
      outputTokens: body?.usage?.completion_tokens ?? null,
    };
  } catch (e) {
    const err = e as Error;
    if (err.name === "AbortError" || err.name === "TimeoutError") return { ok: false, error: `DigitalOcean API timed out after ${timeoutMs}ms` };
    return { ok: false, error: `DigitalOcean API request failed: ${err.message}` };
  }
}

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

export const digitalOceanApiAdapter: WorkerAdapter = {
  id: "digitalocean-api", type: "API", provider: "digitalocean",
  // Real, honest costClass (Rule 257) — ESTIMATED_COST: unlike
  // anthropic-api's UNKNOWN_COST (gateway.ts hides real cost entirely),
  // this adapter calls DigitalOcean directly and CAN compute a real
  // dollar cost from the real usage.prompt_tokens/completion_tokens the
  // API itself returns, for any model with a confirmed rate in
  // CONFIRMED_RATE_PER_MILLION_TOKENS above. Not "PAID" because the
  // default connectivity model (llama3-8b-instruct) does not yet have a
  // confirmed rate — genuinely partial, real cost visibility, not full.
  costClass: "ESTIMATED_COST",
  // Real, synchronous, cache-only check (TASK-081) — never itself
  // performs the async Connectors-DB read; that only ever happens inside
  // resolveCredentials(), called from preflight()/execute()/health(). See
  // this file's header comment for the full rationale and the real,
  // disclosed first-use-in-a-fresh-process limitation this implies.
  availability(): WorkerAvailability {
    if (cachedCredentialResolvedAt === null) {
      return {
        available: false,
        reason: "credential resolution has not run yet this process — preflight()/execute()/health() populate this real, synchronous-read cache from a live Connectors-DB lookup + env var fallback; availability() itself never performs that async read",
      };
    }
    if (cachedCredential) {
      return {
        available: true,
        reason: cachedCredential.source === "CONNECTOR_DB"
          ? "real, usable DigitalOcean connector found in the Connectors DB (enabled + status=connected)"
          : "real DIGITALOCEAN_INFERENCE_API_KEY present (env var fallback — no usable Connectors DB row)",
      };
    }
    return { available: false, reason: "no usable DigitalOcean connector in the Connectors DB (enabled + connected) and no real DIGITALOCEAN_INFERENCE_API_KEY configured in this environment" };
  },
  capabilities() { return ["code.generate"]; },
  estimate(request: WorkerRequest): WorkerCostEstimate {
    const bytes = request.fileContents.reduce((s, f) => s + f.content.length, 0);
    const estimatedTokens = Math.round(bytes / 4) + 500;
    const model = cachedCredential?.model || process.env.DIGITALOCEAN_INFERENCE_MODEL || DEFAULT_MODEL;
    const rate = CONFIRMED_RATE_PER_MILLION_TOKENS[model];
    if (!rate) return { estimatedCost: null, estimatedTokens, currency: null, confidence: "LOW" };
    const estimatedCost = (estimatedTokens / 1_000_000) * ((rate.input + rate.output) / 2);
    return { estimatedCost, estimatedTokens, currency: "USD", confidence: "MEDIUM" };
  },
  async execute(request: WorkerRequest): Promise<WorkerResponse> {
    const started = Date.now();
    // Real refresh (TASK-081) — execute() always resolves fresh
    // credentials before dispatch, so a real Connectors-DB change (a
    // human just enabled a connector, or fixed/rotated a key and re-Test
    // passed) is picked up on the very next real call, never stuck on a
    // stale cache from an earlier preflight().
    await resolveCredentials();
    const avail = this.availability();
    if (!avail.available) {
      return { workerRequestId: request.workerRequestId, workerId: "CODE_WORKER", adapterId: this.id, provider: this.provider, model: null, status: "NOT_CONFIGURED", output: null, proposedChanges: [], toolCalls: [], tokenUsage: { input: null, output: null }, cost: { amount: null, currency: null, kind: "UNKNOWN" }, durationMs: Date.now() - started, evidence: [], limitations: [avail.reason], error: "DIGITALOCEAN_INFERENCE_NOT_CONFIGURED", finishedAt: new Date().toISOString() };
    }
    const cred = cachedCredential!; // real, non-null — guaranteed by avail.available above
    const model = cred.model || process.env.DIGITALOCEAN_INFERENCE_MODEL || DEFAULT_MODEL;
    const fileBlocks = request.fileContents.map((f) => `--- FILE: ${f.path} ---\n${f.content}`).join("\n\n");
    const userPrompt = `Task: ${request.taskDescription}\n\nAcceptance Criteria:\n${request.acceptanceCriteria.map((c) => `- ${c}`).join("\n") || "(none)"}\n\nReal, current file contents (the ONLY files you may propose changes to):\n\n${fileBlocks}`;
    const systemPrompt = `You are a code-generation Worker. Respond with ONLY a single, valid JSON object {"answer":"<plain-text answer if the task is a read-only question needing no file change, else null>","files":[{"path":"<one of the given real file paths>","operation":"CREATE|MODIFY|DELETE|RENAME","content":"<new file content, or null for DELETE>","purpose":"<why>","risk":"LOW|MEDIUM|HIGH"}]} — files may be an empty array for a pure question. No markdown fences, no prose outside the JSON object.`;
    const maxTokens = Math.min(8000, Math.max(1000, request.maxTokens));

    const result = await callDigitalOcean(cred.apiKey, model, systemPrompt, userPrompt, maxTokens, Math.min(request.timeoutMs, 60_000), cred.baseUrl, cred.headerName, cred.headerPrefix);
    lastLiveCallAt = new Date().toISOString();
    lastLiveCallOk = result.ok;
    const durationMs = Date.now() - started;

    if (!result.ok) {
      return { workerRequestId: request.workerRequestId, workerId: "CODE_WORKER", adapterId: this.id, provider: this.provider, model, status: result.error.includes("timed out") ? "TIMEOUT" : "FAILED", output: null, proposedChanges: [], toolCalls: [], tokenUsage: { input: null, output: null }, cost: { amount: null, currency: null, kind: "UNKNOWN" }, durationMs, evidence: [], limitations: [], error: result.error, finishedAt: new Date().toISOString() };
    }

    const tokenUsage = { input: result.inputTokens, output: result.outputTokens };
    const cost = computeCost(model, result.inputTokens, result.outputTokens);

    try {
      const { files, answer } = parseProposal(result.content);
      return { workerRequestId: request.workerRequestId, workerId: "CODE_WORKER", adapterId: this.id, provider: this.provider, model, status: "SUCCEEDED", output: result.content, answer, proposedChanges: files, toolCalls: [], tokenUsage, cost, durationMs, evidence: [], limitations: [], error: null, finishedAt: new Date().toISOString() };
    } catch (e) {
      // Real, honest fallback: the model answered in plain text instead of
      // the required JSON contract — still a real, successful live call
      // (proves connectivity/response/usage/latency), just not schema-
      // conformant. Reported as PARTIAL, not FAILED — raw text preserved
      // as the answer rather than discarded.
      return { workerRequestId: request.workerRequestId, workerId: "CODE_WORKER", adapterId: this.id, provider: this.provider, model, status: "PARTIAL", output: result.content, answer: result.content, proposedChanges: [], toolCalls: [], tokenUsage, cost, durationMs, evidence: [], limitations: [`real response did not match the required structured JSON schema: ${e instanceof Error ? e.message : String(e)}`], error: null, finishedAt: new Date().toISOString() };
    }
  },
  async health(): Promise<WorkerHealthReport> {
    // Real refresh (TASK-081) — health() also re-resolves so a stale
    // "no connector" cache from an earlier process moment doesn't
    // outlive a real, subsequent connector fix.
    await resolveCredentials();
    if (!this.availability().available) return { status: "NOT_CONFIGURED", reason: "no usable DigitalOcean connector (Connectors DB) and no real DIGITALOCEAN_INFERENCE_API_KEY configured", lastLiveCallAt, lastLiveCallOk };
    if (lastLiveCallAt === null) return { status: "UNKNOWN", reason: "configured, but no real live call has ever been made this process — Configured ≠ Healthy", lastLiveCallAt, lastLiveCallOk };
    return { status: lastLiveCallOk ? "HEALTHY" : "DEGRADED", reason: lastLiveCallOk ? "most recent real live call succeeded" : "most recent real live call failed", lastLiveCallAt, lastLiveCallOk };
  },
  async preflight(): Promise<WorkerPreflightResult> {
    const checkedAt = new Date().toISOString();
    // Real, DB-read-only resolution (TASK-081) — this is the one real
    // place the async Connectors-DB lookup actually happens; never spends
    // a token/LLM call (a Supabase read is not an LLM call), so this stays
    // fully compliant with preflight()'s own "never spends a real
    // token/LLM call" contract. Populates the cache availability() reads.
    await resolveCredentials();
    const avail = this.availability();
    if (!avail.available) return { status: "UNAVAILABLE", reason: avail.reason, checkedAt, costIncurred: false };
    if (lastLiveCallAt !== null) {
      return lastLiveCallOk
        ? { status: "HEALTHY", reason: "a real, live call already succeeded this process — stronger evidence than config-only preflight", checkedAt, costIncurred: false }
        : { status: "FAILED", reason: "the most recent real, live call this process failed", checkedAt, costIncurred: false };
    }
    return {
      status: "AVAILABLE",
      reason: cachedCredential?.source === "CONNECTOR_DB"
        ? "real, free, local preflight passed — a real, usable DigitalOcean connector (enabled + connected) was found in the Connectors DB (no real live call made yet this process)"
        : "real, free, local preflight passed — real DIGITALOCEAN_INFERENCE_API_KEY is present (no real live call made yet this process)",
      checkedAt,
      costIncurred: false,
    };
  },
  limitations() {
    return [
      "streaming not implemented (unconfirmed in official docs — see DIGITALOCEAN_AI_INFERENCE_DISCOVERY_REPORT.md §8)",
      "tool/function calling not implemented (unconfirmed in official docs — see DIGITALOCEAN_AI_INFERENCE_DISCOVERY_REPORT.md §9)",
      `only ${Object.keys(CONFIRMED_RATE_PER_MILLION_TOKENS).length} model slugs have a confirmed real per-token rate (${Object.keys(CONFIRMED_RATE_PER_MILLION_TOKENS).join(", ")}) — other configured models return cost.kind=UNKNOWN`,
      `default model (${DEFAULT_MODEL}) is chosen for confirmed-real-slug connectivity, not for coding quality or confirmed pricing`,
      "availability() only reads a real, module-level cache populated by preflight()/execute()/health() — a real, disclosed gap: workerSelectorRuntime.ts#selectWorker() does not call preflight() before its eligibility filter, so on a cold process this adapter honestly reports unavailable on the very first real request even when a usable connector or env var really exists, until something populates the cache first",
    ];
  },
};
