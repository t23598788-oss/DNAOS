/**
 * A6 — direct-provider caller cutover tests (owner, 2026-09-23).
 * Proves the Node/Next callers that USED to talk to a provider directly now ask
 * for a capability, that their contracts are unchanged, and that the worker layer
 * no longer holds a second provider-selection authority. No network, no DB.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { selectAiAdapter, describeAiAdapterFor, loadAiAdapterRegistry } from "../services/ai/resolver";
import { invokeAiGateway } from "../services/ai/gateway";
import { buildEventFromMessages } from "../engines/events/event-builder";

const ROOT = process.cwd();
let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) { passed += 1; console.log(`  ok   ${name}`); }
  else { failures.push(name); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");
/** Executable code only — block comments and full-line // comments removed, so a
 *  historical/documentation mention (A6.6 categories G/H) is not counted as a
 *  hardcode while a real code reference still is. */
const readCode = (p: string) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .map((line) => (line.trimStart().startsWith("//") ? "" : line))
  .join("\n");
const PROVIDER_TOKENS = ["localhost:11434", "11434", "qwen", "thawatchai", "anthropic", "claude", "gemini", "ollama", "generativelanguage"];

const SCREEN_VISION = "app/api/admin/screen-vision/route.ts";
const EVENT_BUILDER = "engines/events/event-builder.ts";
const WORKERS = [
  "app/api/admin/ide/_lib/workerAdapters/apiWorkerAdapter.ts",
  "app/api/admin/ide/_lib/workerAdapters/localModelWorkerAdapter.ts",
];

console.log("A6 — direct provider caller cutover");

// T13 — the screen-vision caller knows neither provider nor model.
{
  const src = read(SCREEN_VISION).toLowerCase();
  const offenders = PROVIDER_TOKENS.filter((t) => src.includes(t.toLowerCase()));
  check("T13 screen-vision has no provider/model/endpoint token", offenders.length === 0, offenders.join(","));
  check("T13b screen-vision asks for the screen.describe capability", /capability: "screen\.describe"/.test(read(SCREEN_VISION)));
  check("T13c screen-vision goes through the canonical gateway", /invokeAiGateway\(/.test(read(SCREEN_VISION)));
  check("T13d no direct fetch() to a model endpoint remains", !/fetch\(/.test(read(SCREEN_VISION)));
}

// T14 — the screen-vision response contract is unchanged.
{
  const src = read(SCREEN_VISION);
  check("T14 still returns { text } on success", /NextResponse\.json\(\{ text \}\)/.test(src));
  check("T14b still returns 404 when no screenshot exists", /status: 404/.test(src) && /ยังไม่มีไฟล์ภาพหน้าจอ/.test(src));
  check("T14c still returns 502 on provider failure", (src.match(/status: 502/g) ?? []).length >= 3);
  check("T14d still POST-only + ADMIN_TIER gated", /export async function POST/.test(src) && /requireAuth\(ADMIN_TIER\)/.test(src));
  check("T14e image is still sent as base64 image/png", /base64: b64, mediaType: "image\/png"/.test(src));
}

// T15 — the event-builder caller knows neither provider nor model.
{
  const src = read(EVENT_BUILDER).toLowerCase();
  const code = readCode(EVENT_BUILDER).toLowerCase();
  const offenders = PROVIDER_TOKENS.filter((t) => code.includes(t.toLowerCase()));
  check("T15 event-builder has no provider/model token in code", offenders.length === 0, offenders.join(","));
  check("T15a the only remaining mentions are documentation", PROVIDER_TOKENS.some((t) => src.includes(t.toLowerCase())) === (offenders.length === 0));
  check("T15b the Anthropic SDK import is gone", !/@anthropic-ai\/sdk/.test(read(EVENT_BUILDER)));
  check("T15c event-builder asks for the text.entity_extract capability", /capability: "text\.entity_extract"/.test(read(EVENT_BUILDER)));
  check("T15d event-builder goes through the canonical gateway", /invokeAiGateway\(/.test(read(EVENT_BUILDER)));
}

// T16 — the event-builder downstream contract is unchanged.
{
  const src = read(EVENT_BUILDER);
  const fields = ["event_type", "material_text", "quantity", "quantity_unit", "destination", "schedule_text", "contact_name", "contact_phone", "status", "confidence"];
  const missing = fields.filter((f) => !src.includes(f));
  check("T16 every extracted field is still mapped", missing.length === 0, missing.join(","));
  check("T16b the JSON-extraction continuation is unchanged", /jsonMatch/.test(src) && /AI ไม่ตอบเป็น JSON/.test(src));
  check("T16c the same ok/error envelope is returned", /\{ ok: true; event: ExtractedEvent \}/.test(src) && /\{ ok: false; error: string \}/.test(src));
  check("T16d context.source_message_ids is still built", /source_message_ids: messages\.map\(\(m\) => m\.id\)/.test(src));
}

// T17 — routing parity for everything A6 cut over.
{
  const env = (name: string) => (["ANTHROPIC_API_KEY", "AI_GATEWAY_OLLAMA_URL"].includes(name) ? "present" : undefined);
  const screen = selectAiAdapter("screen.describe", { context: { runtime: "next", env } });
  check("T17 screen.describe still resolves to the same adapter", screen.ok && screen.id === "ollama", JSON.stringify(screen));
  check("T17b screen.describe keeps its proven model as adapter configuration", screen.ok && screen.model === "qwen2.5vl:7b", screen.ok ? String(screen.model) : "");
  const extract = selectAiAdapter("text.entity_extract", { context: { runtime: "next", env } });
  check("T17c text.entity_extract keeps event-builder on its existing provider", extract.ok && extract.id === "anthropic", JSON.stringify(extract));
  check("T17d event-builder's model is unchanged by the cutover", extract.ok && extract.declaration.configuration.default_model === "claude-haiku-4-5-20251001");
}

// T20 — the worker layer holds no second provider-selection authority.
{
  const offenders: string[] = [];
  for (const f of WORKERS) {
    const code = readCode(f);
    const envReads = [...code.matchAll(/process\.env\.([A-Z0-9_]*(?:ANTHROPIC|OLLAMA|OPENAI|GEMINI)[A-Z0-9_]*)/g)].map((m) => `${f}:process.env.${m[1]}`);
    const modelLiterals = [...code.matchAll(/model: *["'][^"']*["']/g)].map((m) => `${f}:${m[0]}`);
    const modelEnvReads = [...code.matchAll(/model: *process\.env\./g)].map(() => `${f}:model-from-env`);
    offenders.push(...envReads, ...modelLiterals, ...modelEnvReads);
  }
  check("T20 no provider env read and no model literal left in the AI worker adapters", offenders.length === 0, offenders.join(","));
  check("T20b worker adapters ask the resolver instead", WORKERS.every((f) => read(f).includes("describeAiAdapterFor")));
  const registry = loadAiAdapterRegistry();
  check("T20c DigitalOcean stays declared-but-disabled", registry.adapters.some((a) => a.id === "digitalocean" && a.enabled === false));
}

// T21 — the AI layer still has zero canonical-write authority after A6.
{
  const files = [SCREEN_VISION, EVENT_BUILDER, "services/ai/gateway.ts", "services/ai/resolver.ts", "services/ai/adapters.ts"];
  const writes = files.flatMap((f) => [...read(f).matchAll(/\.from\("([a-z_]+)"\)\s*\.(insert|update|upsert|delete)\(/g)].map((m) => `${f}:${m[1]}:${m[2]}`));
  const ALLOWED = ["services/ai/gateway.ts:system_health_status:upsert"];
  const disallowed = writes.filter((w) => !ALLOWED.includes(w));
  check("T21 no business/canonical table write in the A6 cutover files", disallowed.length === 0, disallowed.join(","));
  check("T21a evidence telemetry is the only write target", writes.every((w) => ALLOWED.includes(w)), writes.join(","));
  const canonical = ["engines/canonical/payment-write.ts", "engines/canonical/document-write.ts", "engines/canonical/event-write.ts"];
  const polluted = canonical.filter((f) => /@anthropic-ai\/sdk|invokeAiGateway|localhost:11434/.test(read(f)));
  check("T21b canonical writers hold no provider knowledge", polluted.length === 0, polluted.join(","));
}

// Runtime checks (async — this repo's scripts compile to CJS, so no top-level await).
async function main(): Promise<void> {
  // T18 — the gateway's context/effect guards still work through the cutover path.
  const denied = await invokeAiGateway(
    { origin: "", ownerId: "o", sessionId: "s", capability: "screen.describe", effect: "analysis", prompt: "x" },
    { emitEvidence: async () => {} },
  );
  check("T18 context guard still denies a missing origin", !denied.ok && denied.error === "AI_GATEWAY_CONTEXT_REQUIRED", String(denied.error));

  // T19 — both cutover callers fail closed through the capability path (no key, no direct SDK).
  const savedKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const extractResult = await buildEventFromMessages([{ id: "m1", raw_text: "ขอราคาทรายหยาบ 5 คิว", raw_type: "text", created_at: "2026-09-23T00:00:00Z" }]);
  if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
  const extractError = extractResult.ok ? "" : extractResult.error;
  check(
    "T19 event-builder fails closed (never a silent success, never a direct SDK call)",
    !extractResult.ok && /AI_GATEWAY_(ANTHROPIC_NOT_CONFIGURED|EVIDENCE_UNAVAILABLE)/.test(extractError),
    extractError,
  );
  // With evidence configured, the capability path reports the adapter's real
  // configuration error (same code the pre-A6 gateway produced).
  const withEvidence = await invokeAiGateway(
    { origin: "test", ownerId: "o", sessionId: "s", capability: "text.entity_extract", effect: "classification", prompt: "x" },
    { emitEvidence: async () => {} },
  );
  check("T19c capability path reports the adapter error when evidence is available", !withEvidence.ok && withEvidence.error === "AI_GATEWAY_ANTHROPIC_NOT_CONFIGURED", String(withEvidence.error));

  const savedUrl = process.env.AI_GATEWAY_OLLAMA_URL;
  delete process.env.AI_GATEWAY_OLLAMA_URL;
  const screenInfo = describeAiAdapterFor("screen.describe");
  if (savedUrl !== undefined) process.env.AI_GATEWAY_OLLAMA_URL = savedUrl;
  check("T19b screen-vision path reports its unconfigured adapter honestly", !screenInfo.available && screenInfo.reason === "AI_GATEWAY_OLLAMA_NOT_CONFIGURED", screenInfo.reason);

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.log("FAILED:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

void main();


