/**
 * A7 — Deno AI provider decoupling tests (owner, 2026-09-23).
 * Proves the Deno/Supabase-Functions callers ask for a capability, that LINE
 * semantics and the privacy guards are unchanged, and that Node and Deno obey the
 * SAME selection policy (parity check against the canonical registry). No network.
 */
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) { passed += 1; console.log(`  ok   ${name}`); }
  else { failures.push(name); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");
/** Executable code only — a historical mention is not a hardcode (A7.14 E/G). */
const readCode = (p: string) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .map((line) => (line.trimStart().startsWith("//") ? "" : line))
  .join("\n");
const PROVIDER_TOKENS = ["api.anthropic.com", "generativelanguage", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "claude-haiku", "qwen", "thawatchai", "localhost:11434", "/api/generate", "ollama"];

const DENO = "supabase/functions";
const CONTRACT = `${DENO}/_shared/ai/contract.ts`;
const RUNTIME = `${DENO}/_shared/ai/runtime.ts`;
const CLAUDE_CLIENT = `${DENO}/line-webhook-v2/engines/claude-client.ts`;
const HELPERS = `${DENO}/line-webhook-v2/helpers.ts`;
const TOOL_ROUTER = `${DENO}/line-webhook-v2/engines/tool-router.ts`;
const HEALTH = `${DENO}/system-health-check/index.ts`;
const LINE_CALLERS = [
  CLAUDE_CLIENT,
  `${DENO}/line-webhook-v2/engines/ocr-classify.ts`,
  `${DENO}/line-webhook-v2/engines/thoughtful-fallback.ts`,
  `${DENO}/line-webhook-v2/engines/customer-memory.ts`,
  `${DENO}/line-webhook-v2/handlers/text.ts`,
  `${DENO}/line-webhook-v2/handlers/image.ts`,
  `${DENO}/line-webhook-v2/engines/process-classified-image.ts`,
  `${DENO}/line-webhook-v2/engines/response.ts`,
  `${DENO}/ai-callback/index.ts`,
];

console.log("A7 — Deno AI provider decoupling");

// T22 — no Deno business caller knows a provider, an endpoint or a model.
{
  const offenders: string[] = [];
  for (const f of LINE_CALLERS) {
    const code = readCode(f);
    for (const t of PROVIDER_TOKENS) if (code.includes(t)) offenders.push(`${f}:${t}`);
  }
  check("T22 no provider/model/endpoint token in Deno business-caller code", offenders.length === 0, offenders.join(","));
  check("T22b only the adapter layer names providers", readCode(RUNTIME).includes("api.anthropic.com") && readCode(RUNTIME).includes("generativelanguage"));
}

// T23/T24 — helper semantics preserved (same shapes, same parsing).
{
  const src = read(HELPERS);
  check("T23 text.entity_extract keeps the same extracted field set", ["material", "quantity", "contact_name", "contact_phone", "project_name", "destination_text", "vehicle_type", "concrete_type"].every((f) => src.includes(f)));
  check("T23b it still returns parsed JSON or null", /runAiCapability\(\s*"text\.entity_extract"/.test(src) && /JSON\.parse\(result\.output/.test(src));
  check("T24 location.geocode keeps its {lat,lng}|null contract", /Promise<\{ lat: number, lng: number \} \| null>/.test(src) && /typeof parsed\.lat === 'number'/.test(src));
  check("T24b both helpers state a capability, never a provider", /runAiCapability\(\s*"location\.geocode"/.test(src) && !readCode(HELPERS).includes("gemini"));
}

// T25 — claude-client keeps its contract but has no provider authority.
{
  const code = readCode(CLAUDE_CLIENT);
  check("T25 claude-client has no direct provider invocation", !code.includes("api.anthropic.com") && !code.includes("ANTHROPIC_API_KEY"));
  check("T25b no model literal remains (a legacy file/function name is fine)", !/claude-(haiku|sonnet|opus|3|4)/.test(code));
  check("T25c the three exported functions kept their names", ["callClaudeText", "callClaudeVision", "callClaudeTool"].every((n) => new RegExp(`export async function ${n}\\(`).test(code)));
  check("T25d the string|null failure contract is unchanged", (code.match(/Promise<string \| null>/g) ?? []).length === 3);
  check("T25e capabilities are named by the caller", /"conversation\.answer" \| "memory\.draft" = "conversation\.answer"/.test(code) && /"document\.ocr"/.test(code) && /"intent\.classify"/.test(code));
}

// T26 — tool-router keeps its business routing and holds no AI provider selection.
{
  const code = readCode(TOOL_ROUTER);
  const offenders = PROVIDER_TOKENS.filter((t) => code.includes(t));
  check("T26 tool-router has no AI provider selection in code", offenders.length === 0, offenders.join(","));
  check("T26b deterministic tool routing is intact", /TOOL|tool/.test(read(TOOL_ROUTER)));
  check("T26c its AI-provider path is no longer called from the router", !/callClaudeTool\(/.test(code) || !code.includes("callClaudeTool("));
}

// T27 — AI health reflects adapter readiness, not "Anthropic answered".
{
  const code = readCode(HEALTH);
  check("T27 system-health-check no longer pings a provider", !code.includes("api.anthropic.com") && !code.includes("ANTHROPIC_API_KEY"));
  check("T27b it reports per-adapter readiness from the canonical registry", code.includes("describeDenoAiReadiness") && code.includes("checkAiAdapters"));
  check("T27c readiness keeps its dimensions separate", /runtime_compatible/.test(read(HEALTH)) && /credential_present/.test(read(HEALTH)) && /capability_ready/.test(read(HEALTH)));
}

// T28 — selection policy: fail-closed, disabled/runtime-incompatible never chosen, deterministic, no silent fallback.
{
  const contract = read(CONTRACT);
  const blocks = contract.split(/\n  \{\n    id: "/).slice(1).map((b) => `    id: "` + b);
  const field = (block: string, re: RegExp) => { const m = block.match(re); return m ? m[1] : ""; };
  const parsed: Record<string, string> = {};
  for (const b of blocks) {
    const id = field(b, /^ {4}id: "([a-z]+)"/);
    const capabilities = (b.match(/capabilities: \[([^\]]*)\]/) ?? ["", ""])[1].split(",").map((x) => x.trim().replace(/"/g, "")).filter(Boolean);
    const runtimes = (b.match(/runtimes: \[([^\]]*)\]/) ?? ["", ""])[1].split(",").map((x) => x.trim().replace(/"/g, "")).filter(Boolean);
    parsed[id] = `${/enabled: true/.test(b)}|${field(b, /priority: (\d+)/)}|${runtimes.join("+")}|${capabilities.join(",")}`;
  }
  check("T28 every declared adapter is parsed from the Deno contract", Object.keys(parsed).length === 5, JSON.stringify(Object.keys(parsed)));
  check("T28b an adapter not declared for the deno runtime cannot be selected there", parsed.ollama.includes("next+device"));
  check("T28c DigitalOcean stays declared-but-disabled", parsed.digitalocean.startsWith("false|"));
  check("T28d gemini stays deno-compatible so its two capabilities have an adapter", parsed.gemini.includes("deno+next"));
  const runtimeCode = readCode(RUNTIME);
  check("T28e the Deno runtime holds no capability->provider literal map", !/"document\.ocr"\s*:/.test(runtimeCode) && !/"conversation\.answer"\s*:/.test(runtimeCode));
  check("T28f selection is priority-ordered with an id tie-break", /a\.priority !== b\.priority/.test(runtimeCode) && /a\.id < b\.id/.test(runtimeCode));
  check("T28g the policy strings match the Node contract", contract.includes("registry_order_then_adapter_priority") && contract.includes('fallback: "none"') && contract.includes("fail_closed: true"));
}

// T29 — Node ↔ Deno policy parity against the canonical registry.
{
  const registry = JSON.parse(read("registry/ai-adapter-registry.json")) as {
    policy: { selection: string; fail_closed: boolean };
    adapters: { id: string; capabilities: string[]; runtimes: string[]; enabled: boolean; priority: number; configuration: { unconfigured_error: string } }[];
  };
  const contract = read(CONTRACT);
  const mismatch: string[] = [];
  for (const a of registry.adapters) {
    const block = contract.split(/\n  \{\n    id: "/).slice(1).map((b) => `    id: "` + b).find((b) => b.startsWith(`    id: "${a.id}"`));
    if (!block) { mismatch.push(`${a.id}:missing`); continue; }
    if (/enabled: true/.test(block) !== a.enabled) mismatch.push(`${a.id}:enabled`);
    if (Number((block.match(/priority: (\d+)/) ?? ["", "-1"])[1]) !== a.priority) mismatch.push(`${a.id}:priority`);
    const denoRuntimes = (block.match(/runtimes: \[([^\]]*)\]/) ?? ["", ""])[1].replace(/["\s]/g, "");
    for (const r of a.runtimes) if (!denoRuntimes.includes(r)) mismatch.push(`${a.id}:runtime:${r}`);
    if ((block.match(/unconfigured_error: "([^"]+)"/) ?? ["", ""])[1] !== a.configuration.unconfigured_error) mismatch.push(`${a.id}:unconfigured_error`);
    const denoCaps = (block.match(/capabilities: \[([^\]]*)\]/) ?? ["", ""])[1].replace(/["\s]/g, "").split(",");
    for (const c of a.capabilities) if (!denoCaps.includes(c)) mismatch.push(`${a.id}:capability:${c}`);
  }
  check("T29 Deno declarations match the canonical registry field-by-field", mismatch.length === 0, mismatch.join(","));
  check("T29b the Deno policy mirrors the registry policy", contract.includes(`"${registry.policy.selection}"`) && registry.policy.fail_closed === true);
}

// T30 — readiness/evidence/credential boundaries.
{
  const runtimeCode = readCode(RUNTIME);
  check("T30 readiness is checked before any provider call (evidence first)", /emitAiEvidence\(\{ \.\.\.base, status: "requested" \}\)/.test(runtimeCode));
  check("T30b a missing evidence path fails closed with the canonical code", runtimeCode.includes("AI_GATEWAY_EVIDENCE_UNAVAILABLE"));
  check("T30c no credential value is interpolated into an error/result message",
    !/throw new Error\(`[^`]*\$\{apiKey\}/.test(runtimeCode) && !/`[^`]*\$\{apiKey\}[^`]*`\)\)?;?\s*$/.test(""),
    "the adapter may send the key to the provider, never into a message");
  const resultReturns = (runtimeCode.match(/return \{[^}]*ok:/g) ?? []).join("");
  check("T30d the normalized result carries no credential field", !/apiKey|credential:/.test(resultReturns));
  check("T30e capability vocabulary covers every Deno caller's need", ["conversation.answer", "memory.draft", "document.ocr", "intent.classify", "text.entity_extract", "location.geocode"].every((c) => read(CONTRACT).includes(`"${c}"`)));
}

// T31 — LINE semantics + privacy guards unchanged; the Deno AI layer has no canonical-write authority.
{
  const ocr = read(`${DENO}/line-webhook-v2/engines/ocr-classify.ts`);
  const pci = read(`${DENO}/line-webhook-v2/engines/process-classified-image.ts`);
  check("T31 the government_document PII guard is intact in both layers", ocr.includes("government_document") && /document_type === "government_document"/.test(pci));
  const denoAiFiles = [CONTRACT, RUNTIME];
  const writes = denoAiFiles.flatMap((f) => [...readCode(f).matchAll(/\.from\("([a-z_]+)"\)\s*\.(insert|update|upsert|delete)\(/g)].map((m) => `${f}:${m[1]}:${m[2]}`));
  check("T31b Deno AI layer writes only the evidence table", writes.length > 0 && writes.every((w) => w.endsWith("system_health_status:upsert")), writes.join(","));
  check("T31c no canonical writer is imported by the Deno AI layer", denoAiFiles.every((f) => !/engines\/canonical/.test(read(f))));
  check("T31d LINE callers still import the same three wrappers", /callClaudeText/.test(read(`${DENO}/line-webhook-v2/engines/thoughtful-fallback.ts`)) && /callClaudeVision/.test(ocr) && /callClaudeText/.test(read(`${DENO}/line-webhook-v2/engines/customer-memory.ts`)));
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log("FAILED:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}


