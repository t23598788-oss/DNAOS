/**
 * Unified AI Contract — business schema tests (2026-10-20).
 * Offline: no network, no DB, no provider call. Runs the same fixtures against
 * the Node module (services/ai/businessSchema.ts) and its Deno mirror, so the
 * two runtimes cannot drift on business rules.
 */
import { readFileSync } from "fs";
import { join } from "path";
import * as node from "../services/ai/businessSchema";
import * as deno from "../supabase/functions/_shared/ai/businessSchema";
import { selectAiAdapter, envAdapterConstraint, preferredAdapterEnvName, loadAiAdapterRegistry } from "../services/ai/resolver";

const ROOT = process.cwd();
let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) { passed += 1; console.log(`  ok   ${name}`); }
  else { failures.push(name); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");

type Mod = typeof node;
const runtimes: [string, Mod][] = [["node", node], ["deno", deno as unknown as Mod]];

const validEvent = {
  event_type: "ขอราคา", material_text: "ดินถม", quantity: 10, quantity_unit: "คิว",
  destination: "บางนา", schedule_text: "พรุ่งนี้เช้า", contact_name: "คุณสมชาย",
  contact_phone: "081-234-5678", status: "quotation_pending", confidence: 0.9,
};
const validEntities = {
  material: "ทรายหยาบ", quantity: 5, contact_name: null, contact_phone: "0812345678",
  project_name: null, destination_text: "สมุทรปราการ", vehicle_type: "6_wheeler", concrete_type: null,
};

// Fixtures: each must produce the stated outcome on BOTH runtimes.
const eventFixtures: { name: string; input: unknown; ok: boolean; code?: string }[] = [
  { name: "E1 valid event passes", input: validEvent, ok: true },
  { name: "E2 null event_type passes", input: { ...validEvent, event_type: null }, ok: true },
  { name: "E3 unknown event_type blocked", input: { ...validEvent, event_type: "ลักลอบ" }, ok: false, code: "AI_SCHEMA_INVALID" },
  { name: "E4 negative quantity blocked", input: { ...validEvent, quantity: -3 }, ok: false, code: "AI_SCHEMA_INVALID" },
  { name: "E5 string quantity blocked", input: { ...validEvent, quantity: "ten" }, ok: false, code: "AI_SCHEMA_INVALID" },
  { name: "E6 bad phone blocked", input: { ...validEvent, contact_phone: "12345" }, ok: false, code: "AI_SCHEMA_INVALID" },
  { name: "E7 confidence >1 blocked", input: { ...validEvent, confidence: 1.5 }, ok: false, code: "AI_SCHEMA_INVALID" },
  { name: "E8 unknown status blocked", input: { ...validEvent, status: "paid" }, ok: false, code: "AI_SCHEMA_INVALID" },
  { name: "E9 array (wrong shape) blocked", input: [validEvent], ok: false, code: "AI_SCHEMA_INVALID" },
  { name: "E10 null input blocked", input: null, ok: false, code: "AI_SCHEMA_INVALID" },
  { name: "E11 wrong type for material_text blocked", input: { ...validEvent, material_text: 42 }, ok: false, code: "AI_SCHEMA_INVALID" },
];
const entityFixtures: { name: string; input: unknown; ok: boolean; code?: string }[] = [
  { name: "N1 valid entities pass", input: validEntities, ok: true },
  { name: "N2 unknown vehicle_type blocked", input: { ...validEntities, vehicle_type: "boat" }, ok: false, code: "AI_SCHEMA_INVALID" },
  { name: "N3 negative quantity blocked", input: { ...validEntities, quantity: -1 }, ok: false, code: "AI_SCHEMA_INVALID" },
  { name: "N4 phone with letters blocked", input: { ...validEntities, contact_phone: "08abc" }, ok: false, code: "AI_SCHEMA_INVALID" },
  { name: "N5 non-object blocked", input: "ดินถม", ok: false, code: "AI_SCHEMA_INVALID" },
];
const geoFixtures: { name: string; input: unknown; ok: boolean; code?: string }[] = [
  { name: "G1 Bangkok coordinates pass", input: { lat: 13.75, lng: 100.5 }, ok: true },
  { name: "G2 null (vague address) passes as no-answer", input: null, ok: true },
  { name: "G3 lat out of range blocked", input: { lat: 120, lng: 100 }, ok: false, code: "AI_SCHEMA_INVALID" },
  { name: "G4 string coordinates blocked", input: { lat: "13.7", lng: "100.5" }, ok: false, code: "AI_SCHEMA_INVALID" },
  { name: "G5 outside Thailand service area blocked by policy", input: { lat: 51.5, lng: -0.12 }, ok: false, code: "AI_POLICY_BLOCKED" },
];

console.log("Unified AI contract — business schema");
for (const [rt, mod] of runtimes) {
  for (const f of eventFixtures) {
    const r = mod.validateEventExtract(f.input);
    const good = r.ok === f.ok && (f.ok || (!r.ok && r.code === f.code));
    check(`${rt}: ${f.name}`, good, JSON.stringify(r));
  }
  for (const f of entityFixtures) {
    const r = mod.validateEntities(f.input);
    const good = r.ok === f.ok && (f.ok || (!r.ok && r.code === f.code));
    check(`${rt}: ${f.name}`, good, JSON.stringify(r));
  }
  for (const f of geoFixtures) {
    const r = mod.validateGeocode(f.input);
    const good = r.ok === f.ok && (f.ok || (!r.ok && r.code === f.code));
    check(`${rt}: ${f.name}`, good, JSON.stringify(r));
  }
}

// Normalisation: phone dashes stripped, so downstream never sees "081-234-5678".
{
  const r = node.validateEventExtract(validEvent);
  check("N-norm phone normalised to digits", r.ok && r.value.contact_phone === "0812345678");
}

// Parity: the Deno mirror must carry the same rule body as the Node module.
{
  // Compare executable rules only: comments and whitespace are stripped, so the
  // doc-comments that differ between the two files cannot hide a rule difference.
  const body = (src: string) =>
    src
      .slice(src.indexOf("export const AI_SCHEMA_INVALID"))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "")
      .replace(/\s+/g, "");
  const nodeBody = body(read("services/ai/businessSchema.ts"));
  const denoBody = body(read("supabase/functions/_shared/ai/businessSchema.ts"));
  check("P1 Deno mirror rule body identical to Node module", nodeBody === denoBody);
}

// Wiring: each business caller routes its model output through the gate.
{
  const eb = read("engines/events/event-builder.ts");
  check("W1 event-builder calls validateEventExtract before returning", /validateEventExtract\(raw\)/.test(eb) && eb.indexOf("validateEventExtract(raw)") < eb.indexOf("return { ok: true, event }"));
  const helpers = read("supabase/functions/line-webhook-v2/helpers.ts");
  check("W2 entity extraction routes through validateEntities", /validateEntities\(JSON\.parse/.test(helpers));
  check("W3 geocode routes through validateGeocode", /validateGeocode\(JSON\.parse/.test(helpers));
  check("W4 no raw JSON.parse result is returned unchecked from helpers", !/return JSON\.parse\(result\.output/.test(helpers));
}

// Capability constraint (AI_GATEWAY_PREFERRED_ADAPTER_<CAPABILITY>): restricts to one
// adapter, never changes priority, never falls back. Offline — mock implementations.
{
  const registry = loadAiAdapterRegistry();
  const impl = (id: string) => ({ id, kind: "ai", capabilities: [], runtimes: ["next"], status: () => ({ configured: true, reason: "mock", model: null, endpoint: null }), invoke: async () => "" });
  const implementations = { ollama: impl("ollama"), anthropic: impl("anthropic"), gemini: impl("gemini"), mlx: impl("mlx") };
  const ctx = { runtime: "next" as const, env: () => "present" };
  const pick = (env: Record<string, string>) =>
    selectAiAdapter("text.entity_extract", { registry, implementations: implementations as never, runtime: "next", context: ctx, adapterConstraint: envAdapterConstraint("text.entity_extract", env as NodeJS.ProcessEnv) });

  check("C1 env name follows AI_GATEWAY_PREFERRED_ADAPTER_<CAPABILITY>", preferredAdapterEnvName("text.entity_extract") === "AI_GATEWAY_PREFERRED_ADAPTER_TEXT_ENTITY_EXTRACT");
  const none = pick({});
  // Expected default = the adapter the registry's A6 evidence names as effective today
  // (anthropic). ollama does not declare text.entity_extract for the next runtime.
  check("C2 without constraint, default selection is unchanged (anthropic, A6 effective adapter)", none.ok && none.adapter.id === "anthropic", JSON.stringify(none).slice(0, 120));
  const g = pick({ AI_GATEWAY_PREFERRED_ADAPTER_TEXT_ENTITY_EXTRACT: "gemini" });
  check("C3 constraint to gemini selects gemini", g.ok && g.id === "gemini", JSON.stringify(g));
  const a = pick({ AI_GATEWAY_PREFERRED_ADAPTER_TEXT_ENTITY_EXTRACT: "anthropic" });
  check("C4 constraint to anthropic selects anthropic", a.ok && a.id === "anthropic");
  const bad = pick({ AI_GATEWAY_PREFERRED_ADAPTER_TEXT_ENTITY_EXTRACT: "mlx" });
  check("C5 constraint to an adapter that does not serve the capability fails closed (no fallback)", !bad.ok && bad.code === "AI_ADAPTER_CONSTRAINT_UNSATISFIED", JSON.stringify(bad));
  const typo = pick({ AI_GATEWAY_PREFERRED_ADAPTER_TEXT_ENTITY_EXTRACT: "nope" });
  check("C6 unknown adapter id fails closed", !typo.ok && typo.code === "AI_ADAPTER_CONSTRAINT_UNSATISFIED", JSON.stringify(typo));
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log("FAILED:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
