/**
 * AI Resolver / Adapter contract tests (PHASE A4–A5, owner 2026-09-23).
 * Proves the canonical AI contract + resolver in isolation: no network, no DB,
 * no provider call. Fixtures live here; production declarations live in
 * registry/ai-adapter-registry.json.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { loadAiAdapterRegistry, selectAiAdapter, listDeclaredCapabilities } from "../services/ai/resolver";
import { AI_ADAPTER_IMPLEMENTATIONS } from "../services/ai/adapters";
import { invokeAiGateway, aiGatewayProviderFor, type AiGatewayDependencies } from "../services/ai/gateway";
import type {
  AiAdapter, AiAdapterDeclaration, AiAdapterRegistryFile, AiCapability,
} from "../services/ai/adapterContract";

const ROOT = process.cwd();
let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) { passed += 1; console.log(`  ok   ${name}`); }
  else { failures.push(name); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");

/** The routing the pre-A4 gateway enforced with its static CAPABILITY_PROVIDER map. */
const PRE_A4_EFFECTIVE_ROUTING: Record<string, string> = {
  "conversation.answer": "ollama",
  "intent.classify": "ollama",
  "screen.describe": "ollama",
  "document.ocr": "anthropic",
  "document.event_extract": "anthropic",
  "document.crop": "ollama",
  "memory.draft": "ollama",
  "material.resolve": "ollama",
  "code.generate": "anthropic",
};

const envWith = (...names: string[]) => (name: string) => (names.includes(name) ? "present" : undefined);

const calls: string[] = [];
function mockAdapter(id: string, capabilities: AiCapability[], opts: { configured?: boolean; runtimes?: ("next" | "deno" | "device")[] } = {}): AiAdapter {
  return {
    id: id as AiAdapter["id"],
    kind: "ai",
    capabilities,
    runtimes: opts.runtimes ?? ["next"],
    status: () => ({ configured: opts.configured ?? true, reason: "mock adapter", model: "mock-model", endpoint: null }),
    invoke: async () => { calls.push(id); return `mock:${id}`; },
  };
}

function declaration(id: string, capabilities: AiCapability[], over: Partial<AiAdapterDeclaration> = {}): AiAdapterDeclaration {
  return {
    id: id as AiAdapterDeclaration["id"],
    kind: "ai",
    provider: id,
    runtimes: ["next"],
    capabilities,
    enabled: true,
    priority: 10,
    authorization: { requirement: "none", note: "fixture" },
    configuration: { required_any_env: [], endpoint_env: null, model_env: null, default_model: null, unconfigured_error: `AI_GATEWAY_${id.toUpperCase()}_NOT_CONFIGURED` },
    execution: { status: "gateway-adapter", note: "fixture" },
    declared_by: "test",
    evidence: "test fixture",
    ...over,
  };
}

function fixtureRegistry(adapters: AiAdapterDeclaration[], extra: string[] = []): AiAdapterRegistryFile {
  const declared: Record<string, string> = {};
  for (const c of [...extra, ...adapters.flatMap((a) => a.capabilities)]) declared[c] = "fixture capability";
  return {
    version: 1,
    kind: "ai_adapter_registry",
    note: "test fixture",
    authority: { entry: "test", selection: "test" },
    policy: { selection: "registry_order_then_adapter_priority", fallback: "none", fail_closed: true, tie_break: "priority then id" },
    capabilities: declared,
    adapters,
  };
}

const collectEvidence = () => {
  const events: { status: string; provider: string; error?: string }[] = [];
  return { events, emit: async (e: { status: string; provider: string; error?: string }) => { events.push(e); } };
};

console.log("AI resolver / adapter contract — A4–A5");

// T1 — a capability selects a compatible registered adapter (caller names no provider).
{
  const sel = selectAiAdapter("document.ocr", { context: { runtime: "next", env: envWith("ANTHROPIC_API_KEY") } });
  check("T1 capability selects compatible registered adapter", sel.ok && sel.id === "anthropic", JSON.stringify(sel));
  const sel2 = selectAiAdapter("conversation.answer", { context: { runtime: "next", env: envWith("AI_GATEWAY_OLLAMA_URL") } });
  check("T1b second capability resolves independently", sel2.ok && sel2.id === "ollama");
}

// T2 — a disabled adapter can never be selected.
{
  const registry = fixtureRegistry([declaration("alpha", ["code.generate"], { enabled: false })]);
  const sel = selectAiAdapter("code.generate", { registry, implementations: { alpha: mockAdapter("alpha", ["code.generate"]) } as never });
  check("T2 disabled adapter cannot be selected", !sel.ok && sel.code === "AI_NO_COMPATIBLE_ADAPTER", JSON.stringify(sel));
}

// T3 — an adapter that does not declare the capability cannot serve it
// (the capability vocabulary knows code.generate; no adapter declares it).
{
  const registry = fixtureRegistry([declaration("alpha", ["memory.draft"])], ["code.generate"]);
  const sel = selectAiAdapter("code.generate", { registry, implementations: { alpha: mockAdapter("alpha", ["memory.draft"]) } as never });
  check("T3 unsupported capability cannot select an adapter", !sel.ok && sel.code === "AI_NO_COMPATIBLE_ADAPTER");
}

// T4 — an unconfigured/unavailable adapter fails closed with the SAME code as pre-A4.
{
  const registry = fixtureRegistry([declaration("alpha", ["memory.draft"])]);
  const sel = selectAiAdapter("memory.draft", { registry, implementations: { alpha: mockAdapter("alpha", ["memory.draft"], { configured: false }) } as never });
  check("T4 unconfigured adapter fails closed with its declared code", !sel.ok && sel.code === "AI_GATEWAY_ALPHA_NOT_CONFIGURED", JSON.stringify(sel));
}

// T5 — no compatible adapter = fail closed, and nothing is invoked.
{
  calls.length = 0;
  const registry = fixtureRegistry([declaration("alpha", ["memory.draft"])], ["code.generate"]);
  const sel = selectAiAdapter("code.generate", { registry, implementations: { alpha: mockAdapter("alpha", ["memory.draft"]) } as never });
  check("T5 no compatible adapter fails closed", !sel.ok && sel.code === "AI_NO_COMPATIBLE_ADAPTER" && calls.length === 0);
  const unknown = selectAiAdapter("code.generate", { registry: fixtureRegistry([], []), implementations: {} });
  check("T5b unregistered capability keeps the pre-A4 error code", !unknown.ok && unknown.code === "AI_GATEWAY_CAPABILITY_NOT_REGISTERED");
}

// T6 — provider/model identity is neither required nor possible from a business caller.
{
  const gatewaySource = read("services/ai/gateway.ts");
  const contractSource = read("services/ai/adapterContract.ts");
  check("T6 request has no providerHint field", !/providerHint\??:/.test(contractSource));
  const businessCallers = [
    "app/api/admin/ide/_lib/workerAdapters/apiWorkerAdapter.ts",
    "app/api/admin/ide/_lib/workerAdapters/localModelWorkerAdapter.ts",
    "app/api/internal/ai/gateway/route.ts",
  ];
  const offenders = businessCallers.filter((f) => /providerHint:/.test(read(f)));
  check("T6b no AI business caller passes providerHint", offenders.length === 0, offenders.join(","));
  check("T6c the static CAPABILITY_PROVIDER policy is gone", !/CAPABILITY_PROVIDER/.test(gatewaySource + contractSource));
  check("T6d gateway holds no capability->provider literal map", !/"document\.ocr"\s*:/.test(gatewaySource));
}

// T7 — adding a mock compatible adapter needs ZERO business-caller edits.
{
  const businessCaller = "app/api/admin/ide/_lib/workerAdapters/apiWorkerAdapter.ts";
  const before = read(businessCaller);
  const registry = fixtureRegistry([
    declaration("beta", ["code.generate"], { priority: 5 }),
    declaration("alpha", ["code.generate"], { priority: 9 }),
  ]);
  const impls = { beta: mockAdapter("beta", ["code.generate"]), alpha: mockAdapter("alpha", ["code.generate"]) } as never;
  calls.length = 0;
  const sel = selectAiAdapter("code.generate", { registry, implementations: impls });
  check("T7 a newly registered adapter is selected with no caller change", sel.ok && (sel.id as string) === "beta");
  check("T7b business caller source is untouched by adding an adapter", read(businessCaller) === before);
}

// T8 — deterministic selection (stable across repeats, id tie-break when priorities match).
{
  const registry = fixtureRegistry([
    declaration("zeta", ["code.generate"], { priority: 7 }),
    declaration("alpha", ["code.generate"], { priority: 7 }),
  ]);
  const impls = { zeta: mockAdapter("zeta", ["code.generate"]), alpha: mockAdapter("alpha", ["code.generate"]) } as never;
  const picks = new Set<string>();
  for (let i = 0; i < 25; i += 1) {
    const sel = selectAiAdapter("code.generate", { registry, implementations: impls });
    if (sel.ok) picks.add(sel.id);
  }
  check("T8 selection is deterministic (tie-break by id)", picks.size === 1 && picks.has("alpha"), [...picks].join(","));
}

// T9 — evidence identifies the adapter ACTUALLY selected (provenance after the resolver).
// Wrapped in an async entry point: this repo's scripts are compiled to CJS, which
// has no top-level await.
async function main(): Promise<void> {
  const registry = fixtureRegistry([declaration("gamma", ["memory.draft"], { priority: 3 })]);
  const impls = { gamma: mockAdapter("gamma", ["memory.draft"]) } as never;
  const collector = collectEvidence();
  const result = await invokeAiGateway(
    { origin: "test", ownerId: "owner", sessionId: "session", capability: "memory.draft", effect: "draft", prompt: "hello" },
    { registry, implementations: impls, emitEvidence: collector.emit as AiGatewayDependencies["emitEvidence"] } as never,
  );
  check("T9 gateway returns the selected adapter as provenance", result.ok && (result.provenance.provider as string) === "gamma", JSON.stringify(result.provenance));
  check("T9b evidence carries the real adapter id", collector.events.every((e) => (e.provider as string) === "gamma") && collector.events.length >= 2, JSON.stringify(collector.events));
  const failed = await invokeAiGateway(
    { origin: "test", ownerId: "owner", sessionId: "session", capability: "document.crop", effect: "draft", prompt: "x" },
    { registry, implementations: impls, emitEvidence: collector.emit as AiGatewayDependencies["emitEvidence"] } as never,
  );
  check("T9c fail-closed path reports unselected + emits a failed evidence event", !failed.ok && failed.provenance.provider === "unselected" && collector.events.some((e) => e.status === "failed"));

// T10 — the AI layer has zero canonical-write authority.
{
  const aiFiles = ["services/ai/gateway.ts", "services/ai/resolver.ts", "services/ai/adapters.ts", "services/ai/adapterContract.ts", "services/ai/bridge-local.ts", "services/ai/bridge-claude.ts", "services/ai/translator.ts"];
  const sources = aiFiles.map((f) => ({ f, s: read(f) }));
  // Every DB write in the AI layer is enumerated by the table it targets; the only
  // target allowed is the evidence/telemetry table the gateway already used pre-A4.
  const ALLOWED_WRITE_TABLES = ["system_health_status"];
  const writes = sources.flatMap(({ f, s }) =>
    [...s.matchAll(/\.from\("([a-z_]+)"\)\s*\.(insert|update|upsert|delete)\(/g)].map((m) => ({ f, table: m[1], op: m[2] })));
  const disallowed = writes.filter((w) => !ALLOWED_WRITE_TABLES.includes(w.table));
  const rpcCalls = sources.filter(({ s }) => /\.rpc\(/.test(s));
  const canonicalImports = sources.filter(({ s }) => /engines\/canonical/.test(s));
  check("T10 AI layer writes no business/canonical table", disallowed.length === 0, disallowed.map((w) => `${w.f}:${w.table}:${w.op}`).join(","));
  check("T10a evidence telemetry is the only write target", writes.length > 0 && writes.every((w) => w.table === "system_health_status"), JSON.stringify(writes));
  check("T10b no RPC call in the AI layer", rpcCalls.length === 0, rpcCalls.map((w) => w.f).join(","));
  check("T10c the AI layer imports no canonical writer", canonicalImports.length === 0, canonicalImports.map((w) => w.f).join(","));
  check("T10d the registry declares the same capability vocabulary the contract type has", listDeclaredCapabilities().length === Object.keys(PRE_A4_EFFECTIVE_ROUTING).length + 2);
}

// T11 — current-routing parity: the resolver reproduces the pre-A4 effective routing.
{
  const env = envWith("AI_GATEWAY_OLLAMA_URL", "ANTHROPIC_API_KEY");
  const mismatches: string[] = [];
  for (const [capability, expected] of Object.entries(PRE_A4_EFFECTIVE_ROUTING)) {
    const sel = selectAiAdapter(capability as AiCapability, { runtime: "next", context: { runtime: "next", env } });
    const got = sel.ok ? sel.id : `ERROR:${sel.code}`;
    if (got !== expected) mismatches.push(`${capability}: expected ${expected}, got ${got}`);
  }
  check("T11 all 9 pre-existing capabilities keep their effective routing", mismatches.length === 0, mismatches.join(" | "));
  check("T11b aiGatewayProviderFor answers from the resolver", aiGatewayProviderFor("document.ocr") === "anthropic" && aiGatewayProviderFor("memory.draft") === "ollama");
}

// T12 — the address/route capabilities derive from real callers, and are named by the WORK.
{
  const helpers = read("supabase/functions/line-webhook-v2/helpers.ts");
  check("T12 real caller for text.entity_extract exists", /export async function extractStructuredEntitiesWithGemini\(/.test(helpers));
  check("T12b real caller for location.geocode exists", /export async function resolveAddressToCoordinates\(/.test(helpers));
  const registry = loadAiAdapterRegistry();
  const providerNames = ["ollama", "anthropic", "gemini", "claude", "gpt", "openai"];
  const capabilityNames = Object.keys(registry.capabilities);
  const providerNamed = capabilityNames.filter((c) => providerNames.some((p) => c.toLowerCase().includes(p)));
  check("T12c no capability is named after a provider", providerNamed.length === 0, providerNamed.join(","));
  check("T12d the two new capabilities are declared with a real adapter", registry.adapters.some((a) => a.capabilities.includes("text.entity_extract")) && registry.adapters.some((a) => a.capabilities.includes("location.geocode")));
  check("T12e declared adapters only name proven providers", registry.adapters.every((a) => ["ollama", "anthropic", "gemini", "digitalocean"].includes(a.id)));
  check("T12f the non-executable provider is declared but not selectable", registry.adapters.some((a) => a.id === "digitalocean" && a.enabled === false) && !AI_ADAPTER_IMPLEMENTATIONS.digitalocean);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.log("FAILED:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

void main();



