# DigitalOcean AI Inference — Discovery Report

**Discovery only, per Owner instruction.** No source code modified, no dependency installed, no provider created. This document surveys (1) DNA OS's real existing AI provider/worker architecture and (2) DigitalOcean's real official AI inference offerings, so a future Worker can build the smallest real connection instead of guessing.

---

## 1. เครื่องมือ/บริการที่พบ (What DigitalOcean actually offers)

Three distinct, separately-named real products — not one thing:

| Product | What it is |
|---|---|
| **Serverless Inference** | A single OpenAI-compatible hosted API endpoint, pay-per-token, zero infrastructure to manage. Multi-tenant capacity. |
| **Dedicated Inference** (GA) | A managed but *reserved* GPU inference service — Kubernetes-native, DigitalOcean runs the serving stack (vLLM engine, ingress, RDMA for multi-node, autoscaling, prefix-aware routing) on GPUs billed by the hour. You pick the model + GPU type; DO manages everything around it. |
| **GPU Droplets** (+ Bare Metal GPU) | Raw GPU virtual machines. No managed inference stack at all — you install and run your own server (e.g. your own vLLM/Ollama), same as any other VM. This is infrastructure, not an inference *service*. |

There is no separate "Model Catalog" product — the model list (§5) is simply what Serverless/Dedicated Inference expose; there's also a related but distinct **Gradient AI Agents** product (`*.agents.do-ai.run`, its own `agent_access_key`) for building agent workflows on top of inference — not requested, noted only to avoid confusing its auth with Serverless Inference's.

## 2. Official documentation

- Platform overview: `docs.digitalocean.com/products/gradient-ai-platform/`
- Serverless Inference overview: `docs.digitalocean.com/products/inference/how-to/si-overview/`
- Serverless Inference endpoints: `docs.digitalocean.com/products/inference/how-to/si-endpoints/`
- Dedicated Inference how-to: `docs.digitalocean.com/products/inference/how-to/use-dedicated-inference/`
- Model list: `docs.digitalocean.com/products/inference/details/models/`
- MCP servers (DO's own infra-control MCP, separate concern — see §9): `docs.digitalocean.com/reference/mcp/`

## 3. Package/SDK ที่จำเป็นจริง

**None required.** The API is OpenAI-compatible — the official `openai` Python/Node SDK (or any OpenAI-compatible client) works by only changing `base_url` and the API key. DNA OS's existing providers (`services/ai/gateway.ts`) don't use any provider SDK at all for Ollama (raw `fetch`) and use the `@anthropic-ai/sdk` only for the Anthropic path — so the honest minimum for a DigitalOcean adapter is **zero new packages**: plain `fetch` against an OpenAI-compatible REST endpoint, exactly like the existing `ollamaProvider()` already does for Ollama's own REST API.

## 4. API endpoint

- **Serverless Inference base URL:** `https://inference.do-ai.run` — real endpoints confirmed: `POST /v1/chat/completions`, `POST /v1/responses`, `POST /v1/images/generations`, `POST /v1/audio/speech`.
- **Dedicated Inference:** each deployment gets its own endpoint exposing `POST /v1/chat/completions` (OpenAI-compatible shape: model slug, `messages[]`, `max_tokens`).

## 5. Authentication

- **Serverless Inference:** a **model access key** (or a DigitalOcean personal access token), sent as `Authorization: Bearer <token>` — standard OpenAI-SDK-compatible header, confirmed via DigitalOcean's own curl examples. One key grants access to every model behind the endpoint.
- **Dedicated Inference:** a bearer token auto-generated per deployment at provisioning time — same `Authorization: Bearer` shape, but scoped to that one deployment's endpoint.
- **Not the same as** DigitalOcean's control-plane API tokens (`dop_v1_*`/`doo_v1_*`/`dor_v1_*`, used for `api.digitalocean.com` to provision resources) or the separate Gradient Agents `agent_access_key` — three different credential types for three different surfaces. Only the model access key is relevant here.

## 6. Model ที่ใช้ได้ (real models found)

Both Serverless and Dedicated Inference expose a large multi-vendor catalog behind the one endpoint — Anthropic, OpenAI, Meta, DeepSeek, Alibaba (Qwen), Moonshot (Kimi), NVIDIA (Nemotron), Google (Gemma), Mistral, Z.ai (GLM), and others. Notable for this Owner's stated use case:

**Real Anthropic Claude models available through DigitalOcean itself** (both tiers): Claude Fable 5, Claude Opus 5, Claude Opus 4.8/4.7/4.6/4.5, Claude Sonnet 5, Claude Sonnet 4.6/4.5, Claude Haiku 4.5 — same models DNA OS already calls directly via `ANTHROPIC_API_KEY`. Pricing for these is stated to follow "the model owner's rates" — i.e. going through DigitalOcean for Claude specifically is not expected to be cheaper than calling Anthropic directly; the only reason to route Claude traffic through DO would be infrastructure/billing consolidation, not cost savings. Not independently price-verified line-by-line — flagged, not assumed.

**Explicitly coding-oriented models found:**
- **Qwen3 Coder Flash** (262K context) — coding-focused, available on both Serverless and Dedicated.
- **GPT-5.3-Codex** (400K context) — explicitly described as designed for coding, Serverless only.
- GPT-5.6/5.5/5.4 family and GPT-4.1 also flagged "coding capable" in DigitalOcean's own listing, Serverless only.

**Real open-weight options for local-style large-context-window reasoning:** DeepSeek V4 Pro/Flash (1M context), Llama 4 Maverick, gpt-oss-120b/20b — relevant if the Owner wants a non-Anthropic, non-OpenAI option specifically to diversify away from those two vendors.

## 7. Pricing model

- **Serverless Inference:** per-token, prepaid balance only (no minimum commitment, no monthly contract). Real example rates found: GPT-OSS-120B $0.10 input / $0.70 output per million tokens; Llama 3.3 70B $0.65 / $0.65 per million tokens. A full official per-model price table exists on DigitalOcean's pricing page but was not fully enumerated here — line-by-line rates should be pulled fresh before any cost comparison is finalized, since they were not exhaustively confirmed this pass.
- **Dedicated Inference:** billed by **GPU-hours used**, not tokens — economical only for steady, high-throughput, predictable traffic; wasteful for bursty/low-volume traffic since you pay for reserved capacity whether or not it's used.
- **GPU Droplets:** standard Droplet/hour pricing; reserved multi-month contracts found as low as **$1.91–$7.94 per GPU/hour** depending on GPU type and commitment — but this is raw VM pricing, with zero inference stack included; you'd still need to run and maintain your own server (e.g. install Ollama or vLLM yourself), i.e. the same operational burden DNA OS already carries with its own RunPod-hosted Ollama.

## 8. Streaming response

Not explicitly documented on the pages fetched this pass — DigitalOcean's own marketing claims full OpenAI SDK/LangChain/LlamaIndex compatibility "out of the box," and streaming (`stream: true` → SSE) is a standard, load-bearing part of the OpenAI Chat Completions contract that an "OpenAI-compatible" claim implies, but this specific claim was **not found spelled out in an official doc page** in this pass. Status: **PARTIAL — likely true given the compatibility claim, not independently confirmed with a quoted doc line.** Verify with one real streaming test call before relying on it.

## 9. Tool calling / function calling

Same caveat as streaming: not spelled out on the Serverless Inference endpoint page fetched this pass, but implied by the OpenAI-compatibility claim (the `tools` parameter is core to that same contract). **PARTIAL — verify with a real test call**, not confirmed via an explicit quoted doc statement.

**Web search / web fetch / MCP:** DigitalOcean's own MCP-related products are about a **different direction of MCP** than what this Owner's ask (#9) is likely asking about — `docs.digitalocean.com/reference/mcp/` is DigitalOcean's own MCP *server* that lets an AI agent (e.g. Claude Desktop, Cursor) control DigitalOcean's infrastructure (create Droplets, manage Apps, etc.) — it's DO exposing itself as an MCP *tool provider*, not DO's inference API accepting MCP servers as tools for the models it serves. Separately, the Gradient AI **Agents** product (not Inference) does let you attach MCP servers to an agent. Neither of these is "web search/web fetch built into the inference call" the way Anthropic's own `web_search_20260209` server tool works — **no evidence found of a built-in web-search/web-fetch capability on DigitalOcean's inference endpoints themselves.** Status: **NOT_FOUND for inference-level web search/fetch; PARTIAL/different-direction for MCP.**

## 10. โมเดลที่เหมาะกับงานเขียนและวิเคราะห์ source code

Real, named options, from strongest-signal to weakest:
1. **Claude Opus 5 / Claude Sonnet 5** (via DigitalOcean, same models DNA OS already calls directly) — DNA OS's own existing `apiWorkerAdapter.ts` already declares `capabilities(): ["code.generate"]` for its direct Anthropic path; a DO-routed Claude call would be functionally equivalent for code quality, differing only in infrastructure/billing path, not model capability.
2. **GPT-5.3-Codex** — explicitly built for coding, only reachable via DigitalOcean's Serverless tier in this survey (DNA OS has no existing OpenAI integration at all — confirmed by `apiWorkerAdapter.ts`'s own header comment: real `OPENAI_API_KEY` sits unused in `.env.local`, zero OpenAI SDK/call code exists anywhere in this repo).
3. **Qwen3 Coder Flash** — real, coding-focused, open-weight, available on both Serverless and Dedicated tiers, likely the cheapest real option for a genuinely new (non-Anthropic-duplicate) code-capable cloud path.

## 11. Source files เดิมของ DNA OS ที่สามารถ reuse

DNA OS already has **two** real, separate layers relevant here — checked directly, not assumed:

**A) `services/ai/gateway.ts`** — the real AI capability→provider gateway. `AiProviderName` is a closed TypeScript union: `"anthropic" | "ollama"` only. `AiProvider` interface is a single `complete(request): Promise<string>` — no streaming, no tool-calling at this layer today. `CAPABILITY_PROVIDER` is a static per-capability routing table (not a smart cost/task router). The `ollamaProvider()` function is the closest existing pattern to reuse for a DigitalOcean call: plain `fetch`, no SDK, reads a base-URL env var, non-streaming.

**B) `app/api/admin/ide/_lib/workerAdapter.ts` + `workerAdapters/*` + `workerSelectorRuntime.ts`** — a separate, more capable Factory-Worker-level abstraction, and the one that actually matches what the Owner described as "AI Router → Local Model / Cloud Provider":
- `WorkerAdapter` interface: `id`, `type` (`"API" | "CLI" | "MCP" | "LOCAL_RUNTIME" | "REMOTE_RUNTIME" | "HUMAN"`), `provider`, `costClass` (`"FREE" | "ESTIMATED_COST" | "PAID" | "UNKNOWN_COST"` — real cost taxonomy, tied to a real Constitution rule, Rule 257 "Execution Plane Cost Gate"), `availability()`, `capabilities(): string[]`, `estimate()`, `execute()`, `health()`, `limitations()`.
- `localModelWorkerAdapter.ts` (`id: "ollama-local"`) and `apiWorkerAdapter.ts` (`id: "anthropic-api"`) are both real, working implementations of this interface today — both **reuse** `services/ai/gateway.ts` underneath rather than duplicating HTTP logic (explicit rule stated in both files' own headers).
- **`selectWorker()` in `workerSelectorRuntime.ts` is the real, already-built AI Router**: filters adapters by `capabilities().includes(request.capabilityRequired)`, excludes cloud-backed adapters when `request.privacyLevel === "LOCAL_ONLY"` (**this is already the exact "data that shouldn't leave the machine → force Local" rule the Owner described** — not something to build new), then ranks the remainder by a real preflight/health/cost tiebreak, with Human Worker as the guaranteed final fallback. Zero routing code would need to be written to add a new provider — only a new `WorkerAdapter` implementation, registered into the existing registry.

**C) `app/api/admin/ide/_lib/workerAdapters/apiWorkerAdapter.ts`'s own stated rule** is directly relevant precedent: it explicitly declined to build an OpenAI adapter despite a real (unused) `OPENAI_API_KEY` existing, citing "เฉพาะ Provider ที่มีของเดิมจริง" (existing-integration-only). DigitalOcean has **no existing integration at all** in this repo (confirmed: no `DIGITALOCEAN_*`/`DO_API_*` env var anywhere, no SDK, no call site) — so per that same precedent, this would be a genuinely new adapter, not a reuse of dormant credentials.

**D) Not directly relevant, checked and ruled out:** `services/ai-connection/*` (oauth.ts/vault.ts/manager.ts/healthCheck.ts/statusRepository.ts) is a **different subsystem** — RFC 8707 MCP OAuth *resource-server* connection management for exposing DNA OS's own MCP server to external clients (inbound), explicitly disclosed in its own header as "Stage 1... NOT invoked anywhere yet." Not a second AI-provider abstraction competing with `gateway.ts` — flagged so a future Worker doesn't wire a DigitalOcean adapter into the wrong subsystem by name-matching alone.

## 12. สิ่งที่ต้องเพิ่มจริง (what's genuinely new, not reuse)

1. One new file, e.g. `app/api/admin/ide/_lib/workerAdapters/digitalOceanWorkerAdapter.ts`, implementing `WorkerAdapter` — same shape as the two existing real adapters, plain `fetch` to `https://inference.do-ai.run/v1/chat/completions`, `Authorization: Bearer <model_access_key>`.
2. Widen `AiProviderName` in `services/ai/gateway.ts` from `"anthropic" | "ollama"` to include `"digitalocean"` **only if** routing through the lower-level gateway is also wanted (not strictly required if the Factory-Worker-level adapter alone is sufficient for the Owner's stated goal).
3. One new env var: a DigitalOcean model access key (name TBD by whoever builds it, e.g. `DIGITALOCEAN_INFERENCE_API_KEY`) — does not exist in `.env.local` today.
4. Register the new adapter in `WORKER_ADAPTER_REGISTRY` (wherever that's assembled — not located in this discovery pass, flagged for the builder to find).
5. A real streaming/tool-calling verification pass (§8/§9) before relying on either — DigitalOcean's own docs didn't spell these out explicitly in what was fetched this pass.

## 13. Dependency ที่ไม่จำเป็น

- **No `openai` npm/pip package needed** — plain `fetch`/`curl` against the OpenAI-compatible REST shape is sufficient and matches this repo's own existing pattern (`ollamaProvider()` uses raw `fetch`, not any SDK).
- **No DigitalOcean control-plane SDK (`digitalocean` / `@digitalocean/dots-wrapper` etc.) needed** — those are for provisioning Droplets/Apps via the control-plane API, an entirely different concern from calling an already-provisioned inference endpoint.
- **No LangChain/LlamaIndex** — DigitalOcean's docs mention compatibility with these as a selling point for *other* users' existing stacks; DNA OS has no LangChain/LlamaIndex usage anywhere in this repo today, and adding one just to reach an OpenAI-compatible REST endpoint would be pure, unnecessary overhead.

## 14. Architecture ที่แนะนำ (smallest real version, per Owner's diagram)

```
DNA OS
  ↓
AI Router  ←── already real: workerSelectorRuntime.ts:selectWorker()
  ├── Local Model  ←── already real: localModelWorkerAdapter.ts (Ollama, costClass FREE)
  └── DigitalOcean Inference  ←── NEW: digitalOceanWorkerAdapter.ts (costClass PAID)
           ↓
        Model (Claude / Qwen3 Coder Flash / GPT-5.3-Codex / etc., selected via config, not hardcoded)
```

Selection already happens on exactly the axes the Owner asked for, via existing, real code — not proposed, already built:
- **งาน (task/capability):** `capabilities().includes(request.capabilityRequired)` — the new adapter declares `["code.generate"]` (or others) same as the existing Anthropic adapter.
- **ความสามารถ:** which model the adapter is configured to call (config value, not hardcoded per Law 1-style discipline already used elsewhere in this repo for Connector configs).
- **context requirement:** not currently a `WorkerAdapter` field — real, small gap; `estimate()` could be extended to consider it, or the caller can choose which adapter to prefer via `ownerPreference` (already a real parameter on `selectWorker()`).
- **ความเร็ว/cost:** already real — `health()`/preflight rank + `estimate().estimatedCost` tiebreak.
- **ข้อมูลที่ไม่ควรออกจากเครื่อง → Local:** already real — `privacyLevel === "LOCAL_ONLY"` exclusion in `selectWorker()`.

## 15. Estimated implementation scope

Small, bounded by precedent — the existing two adapters (`localModelWorkerAdapter.ts`, `apiWorkerAdapter.ts`) are each well under 150 lines and follow an identical shape. A DigitalOcean adapter following the same pattern is realistically:
- 1 new adapter file (~100–150 lines, mirroring the existing two)
- 1 registry-array edit (add one line)
- 1 new env var
- Optionally, 1 small widening of `AiProviderName` in `gateway.ts` if lower-layer routing is also wanted
- 1 real, live test call to confirm streaming/tool-calling behavior before those are relied on (§8/§9 gaps)

No new architecture, no new router, no new abstraction — this matches the Owner's own "ห้ามสร้างระบบซ้ำ" instruction and reuses the exact pattern this repo already proved twice.

## 16. Risks / limitations

- **Streaming and tool-calling support are inferred, not confirmed** from official docs fetched this pass (§8/§9) — must be verified with a real test call before any Worker depends on either behavior.
- **Claude-via-DigitalOcean is not necessarily cheaper** than calling Anthropic directly (§6) — routing Claude traffic through DO only makes sense for infra/billing consolidation, not cost, unless verified otherwise.
- **Dedicated Inference's GPU-hour billing is a real cost trap for bursty/low-volume traffic** — reserved capacity is charged whether used or not; only Serverless Inference's pure per-token model matches DNA OS's current usage pattern (occasional Worker-triggered calls, not steady high-throughput traffic), based on what's known about DNA OS's usage from this repo alone.
- **Full per-model Serverless pricing table was not exhaustively pulled** — only two example rates were confirmed (§7); a real cost comparison against Anthropic direct/Ollama-local needs the complete table before a final provider decision.
- **`AiProviderName`'s closed-union type in `gateway.ts`** means any adapter reuse of that lower layer requires a real (small) type-level code change — flagged so it isn't missed as "just add a string."
- **No DigitalOcean account/API key exists in this environment today** — this entire report is desk research against public documentation; nothing here has been tested against a live DigitalOcean endpoint.
