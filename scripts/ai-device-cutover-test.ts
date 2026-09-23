/**
 * A8 — Device/Watcher AI decoupling tests (owner, 2026-09-23).
 * Proves the device runtime obeys the same contract as Node/Next and Deno, that
 * the watcher asks for capabilities only, and that the whole existing process
 * (polling, ai_tasks, tracing, callback, pod, privacy guards) is untouched.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { selectDeviceAdapter, runDeviceAiCapability, loadDeviceAdapterRegistry } from "../local-runtime/ai/device-ai-runtime.mjs";

const ROOT = process.cwd();
let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) { passed += 1; console.log(`  ok   ${name}`); }
  else { failures.push(name); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");
const readCode = (p: string) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .map((line) => (line.trimStart().startsWith("//") || line.trimStart().startsWith("*") ? "" : line))
  .join("\n");

const WATCHER = "local-runtime/ai-task-watcher.mjs";
const DEVICE_RUNTIME = "local-runtime/ai/device-ai-runtime.mjs";
const PROVIDER_TOKENS = ["qwen", "thawatchai", "ollama", "anthropic", "claude", "gemini", "localhost:11434", "/api/generate"];

console.log("A8 — device/watcher AI decoupling");

// T32 — the watcher asks for capabilities only.
{
  const code = readCode(WATCHER);
  const offenders = PROVIDER_TOKENS.filter((t) => code.includes(t));
  check("T32 watcher code has no provider/model/endpoint token", offenders.length === 0, offenders.join(","));
  check("T32b it names the five capabilities it needs", ["document.ocr", "text.entity_extract", "conversation.answer", "memory.draft", "material.resolve"].every((c) => code.includes(`"${c}"`)));
  check("T32c it goes through the device AI runtime", code.includes("runDeviceAiCapability") && code.includes("generateForCapability"));
  check("T32d no model constant remains", !/VISION_MODEL|TEXT_MODEL/.test(code));
}

// T33 — the existing process is untouched (polling, tasks, tracing, callback, pod, guards).
{
  const src = read(WATCHER);
  check("T33 polling + task identity unchanged", /from\("ai_tasks"\)/.test(src) && /CURRENT_TASK_ID/.test(src));
  check("T33b tracing stages still written", /appendTrace\(/.test(src) && src.includes("callback_posting") && src.includes("ai_request_sent"));
  check("T33c callback contract unchanged", /postCallback\(\{ taskId: task\.id, kind: "classify_image", classified \}\)/.test(src) && src.includes("x-callback-secret"));
  check("T33d RunPod pod lifecycle untouched", src.includes("runpod") || src.includes("LAST_ACTIVE_PATH"));
  check("T33e the code-level privacy guard is intact", /parsed\.document_type === "government_document"/.test(src) && /parsed\.raw_ocr_text = null/.test(src));
  check("T33f the material verbatim-name guard is intact", /verbatim/.test(src));
  check("T33g ai_tasks kinds unchanged", ["classify_image", "handle_text", "resolve_material"].every((k) => src.includes(`"${k}"`)));
}

// T34 — the device runtime loads the canonical registry (no snapshot to drift).
{
  const code = readCode(DEVICE_RUNTIME);
  check("T34 device runtime reads the canonical registry from disk", code.includes("registry") && code.includes("ai-adapter-registry.json") && code.includes("readFileSync"));
  check("T34b it holds no embedded declaration list", !/priority:\s*\d+/.test(code) && !/"enabled":/.test(code));
  check("T34c its policy matches the shared contract", code.includes("AI_NO_COMPATIBLE_ADAPTER") && code.includes("AI_GATEWAY_CAPABILITY_NOT_REGISTERED") && /a\.priority !== b\.priority/.test(code));
  const registry = loadDeviceAdapterRegistry(ROOT) as { adapters: { id: string; runtimes: string[] }[] };
  check("T34d only one adapter declares the device runtime", registry.adapters.filter((a) => a.runtimes.includes("device")).length === 1);
}

// T35 — real selection behaviour on the device runtime (canonical registry).
async function main(): Promise<void> {
  const registry = loadDeviceAdapterRegistry(ROOT);
  const choose = (capability: string) => selectDeviceAdapter(capability, { registry, projectDir: ROOT });

  for (const capability of ["document.ocr", "text.entity_extract", "conversation.answer", "memory.draft", "material.resolve"]) {
    const selection = choose(capability);
    check(`T35 ${capability} resolves on the device runtime`, selection.ok && selection.declaration.id === "ollama", JSON.stringify(selection));
  }
  check("T35b the vision capability keeps its proven model as configuration", choose("document.ocr").model === "qwen2.5vl:72b");
  check("T35c the text capability keeps its proven model as configuration", choose("text.entity_extract").model === "thawatchai");

  // Fail closed, never a fallback.
  const notDeclared = choose("screen.describe") as { ok: boolean; code?: string };
  check("T35d a capability with no device adapter fails closed", !notDeclared.ok && ["AI_NO_COMPATIBLE_ADAPTER", "AI_GATEWAY_CAPABILITY_NOT_REGISTERED"].includes(String(notDeclared.code)), JSON.stringify(notDeclared));
  const unknown = choose("does.not.exist") as { ok: boolean; code?: string };
  check("T35e an unregistered capability fails closed with the canonical code", !unknown.ok && unknown.code === "AI_GATEWAY_CAPABILITY_NOT_REGISTERED");
  const anthropicOnly = selectDeviceAdapter("document.ocr", {
    registry: { capabilities: { "document.ocr": "x" }, adapters: [{ id: "anthropic", enabled: true, priority: 20, runtimes: ["next", "deno"], capabilities: ["document.ocr"], configuration: {} }] },
  }) as { ok: boolean; code?: string };
  check("T35f a runtime-incompatible adapter is never selected", !anthropicOnly.ok && anthropicOnly.code === "AI_NO_COMPATIBLE_ADAPTER");
  const disabled = selectDeviceAdapter("document.ocr", {
    registry: { capabilities: { "document.ocr": "x" }, adapters: [{ id: "ollama", enabled: false, priority: 10, runtimes: ["device"], capabilities: ["document.ocr"], configuration: {} }] },
  }) as { ok: boolean; code?: string };
  check("T35g a disabled adapter is never selected", !disabled.ok && disabled.code === "AI_NO_COMPATIBLE_ADAPTER");

  const picks = new Set<string>();
  for (let i = 0; i < 25; i += 1) { const r = choose("document.ocr"); if (r.ok) picks.add(r.declaration.id); }
  check("T35h selection is deterministic", picks.size === 1 && picks.has("ollama"), [...picks].join(","));

  // Evidence is required and precedes the provider call.
  const noEvidence = await runDeviceAiCapability("document.ocr", { prompt: "x", maxTokens: 10 }, { endpoint: "http://127.0.0.1:1" });
  check("T35i a missing evidence hook fails closed", !noEvidence.ok && noEvidence.error === "AI_GATEWAY_EVIDENCE_UNAVAILABLE", String(noEvidence.error));

  const events: { status: string; adapterId?: string; model?: string; error?: string }[] = [];
  const noEndpoint = await runDeviceAiCapability("document.ocr", { prompt: "x", maxTokens: 10 }, {
    endpoint: null, registry, projectDir: ROOT,
    evidence: async (e: { status: string; adapterId?: string; model?: string; error?: string }) => { events.push(e); },
  });
  check("T35j a missing endpoint fails closed with the adapter code", !noEndpoint.ok && noEndpoint.error === "AI_GATEWAY_OLLAMA_NOT_CONFIGURED", String(noEndpoint.error));
  check("T35k evidence was recorded BEFORE the provider attempt", events.length === 2 && events[0].status === "requested" && events[1].status === "failed");
  check("T35l evidence names the adapter that was selected", events.every((e) => e.adapterId === "ollama"));

  // T36 — the device AI layer holds no DB authority at all; the watcher keeps
  // only the transport/evidence writes it already had.
  const runtimeCode = readCode(DEVICE_RUNTIME);
  check("T36 the device AI runtime performs no DB access whatsoever", !runtimeCode.includes("supabase") && !/\.from\(/.test(runtimeCode));
  const writeOps = [...readCode(WATCHER).matchAll(/\.from\("([a-z_]+)"\)\s*\.(insert|update|upsert|delete)\(/g)].map((m) => `${m[1]}:${m[2]}`);
  const allowedWrites = ["ai_tasks:update", "ai_tasks:insert", "system_health_status:upsert", "business_events:update"];
  const unexpectedWrites = [...new Set(writeOps)].filter((w) => !allowedWrites.includes(w));
  check("T36b the watcher writes only transport/evidence rows", unexpectedWrites.length === 0, unexpectedWrites.join(","));
  check("T36c every write-op target the watcher uses was already its own duty (unchanged by A8)", writeOps.every((w) => /^(ai_tasks|system_health_status|business_events):/.test(w)));


  // ---- A10: the last device scripts + the config surface ----
  const A10_SCRIPTS: [string, string][] = [
    ["local-runtime/watch-drive.mjs", "document.ocr"],
    ["local-runtime/backfill-slips.mjs", "document.ocr"],
    ["local-runtime/backfill-slips-test.mjs", "document.ocr"],
    ["local-runtime/print-watcher.mjs", "document.crop"],
  ];
  for (const [file, capability] of A10_SCRIPTS) {
    const code = readCode(file);
    // `ollama` may survive ONLY in device-INFRASTRUCTURE names that A10 must not
    // rename (all owned outside these scripts): the pod gateway helper
    // getReadyOllamaUrl, the module ./ollama-cloud-gateway.mjs, and the local
    // state directory /Users/tam/dna-os-ollama/. Every other provider token —
    // endpoint, model literal, selection — must be zero.
    const offenders = PROVIDER_TOKENS.filter((t) => t !== "ollama").filter((t) => code.includes(t));
    const ollamaMentions = (code.match(/ollama/gi) ?? []).length;
    const allowedOllama = [/getReadyOllamaUrl/g, /ollama-cloud-gateway\.mjs/g, /dna-os-ollama/g];
    const allowedMentions = allowedOllama.reduce((total, re) => total + (code.match(re) ?? []).length, 0);
    check(`A10 ${file} has no provider endpoint/model literal/selection token`, offenders.length === 0 && ollamaMentions === allowedMentions, `${offenders.join(",")} ollama=${ollamaMentions} allowed=${allowedMentions}`);
    check(`A10a ${file} declares no model literal`, !/model:\s*["']/.test(code) && !/qwen|thawatchai|claude-|gemini-/.test(code));
    check(`A10b ${file} states the ${capability} capability`, code.includes(`"${capability}"`) && code.includes("runDeviceAiCapability"));
    check(`A10c ${file} supplies real evidence`, code.includes("createDeviceEvidence"));
  }
  check("A10d ollama declares document.crop for the device runtime", (registry.adapters.find((a: { id: string }) => a.id === "ollama") as { capabilities_by_runtime: { device: string[] } }).capabilities_by_runtime.device.includes("document.crop"));

  const configSrc = read("app/api/admin/system-config/route.ts");
  check("A10e system-config holds no hardcoded provider list", !/"Claude \(Anthropic\)"|"Ollama \(Local\)"/.test(configSrc) && configSrc.includes("loadAiAdapterRegistry"));
  check("A10f it reports readiness through the resolver", configSrc.includes("describeAiAdapterFor"));
  check("A10g the output contract keys are preserved", ["id", "name", "integrated", "configured", "env_var"].every((k) => configSrc.includes(`${k}:`)) && configSrc.includes("ai_models:"));
  check("A10h every declaration carries a display name", (registry.adapters as { display_name?: string }[]).every((a) => Boolean(a.display_name)));
  check("A10i no device script contains selection logic", A10_SCRIPTS.every(([file]) => !/priority|selectDeviceAdapter/.test(readCode(file))));

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.log("FAILED:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

void main();

