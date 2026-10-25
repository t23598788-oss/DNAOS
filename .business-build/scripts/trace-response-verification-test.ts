/**
 * Unified AI Trace & Response Verification tests (2026-10-20).
 * Offline: mock adapters and an injected evidence sink, so no network and no DB.
 * Blocking is proven by behaviour (the released text is null), not by reading source.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { invokeAiGateway, type AiGatewayDependencies } from "../services/ai/gateway";
import type { AiAdapter, AiAdapterDeclaration, AiAdapterRegistryFile, AiEvidenceEvent } from "../services/ai/adapterContract";
import * as tc from "../services/ai/traceContract";
import * as tcDeno from "../supabase/functions/_shared/ai/traceContract";
import { validateEventExtract } from "../services/ai/businessSchema";

const ROOT = process.cwd();
let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) { passed += 1; console.log(`  ok   ${name}`); }
  else { failures.push(name); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");

const OWNER = "owner@example.com";
const OTHER_OWNER = "other-tenant@example.com";

function declaration(id: string, capabilities: string[]): AiAdapterDeclaration {
  return {
    id: id as AiAdapterDeclaration["id"], kind: "ai", provider: id, runtimes: ["next"],
    capabilities: capabilities as AiAdapterDeclaration["capabilities"], enabled: true, priority: 10,
    authorization: { requirement: "none", note: "fixture" },
    configuration: { required_any_env: [], endpoint_env: null, model_env: null, default_model: "fixture-model", unconfigured_error: "X" },
    execution: { status: "gateway-adapter", note: "fixture" }, declared_by: "test", evidence: "fixture",
  };
}
function registryFor(decl: AiAdapterDeclaration): AiAdapterRegistryFile {
  const caps: Record<string, string> = {};
  for (const c of decl.capabilities) caps[c] = "fixture";
  return { version: 1, kind: "ai_adapter_registry", note: "fixture", authority: { entry: "t", selection: "t" },
    policy: { selection: "t", fallback: "none", fail_closed: true, tie_break: "priority then id" }, capabilities: caps, adapters: [decl] };
}

const seenContexts: Record<string, unknown>[] = [];
function adapter(id: string, output: string): AiAdapter {
  return {
    id: id as AiAdapter["id"], kind: "ai", capabilities: ["memory.draft"], runtimes: ["next"],
    status: () => ({ configured: true, reason: "fixture", model: "fixture-model", endpoint: null }),
    invoke: async (_req, ctx) => { seenContexts.push({ ...ctx }); return output; },
  };
}

function deps(output: string, evidence: AiEvidenceEvent[], extra: Partial<AiGatewayDependencies> = {}): AiGatewayDependencies {
  const decl = declaration("alpha", ["memory.draft"]);
  return {
    registry: registryFor(decl),
    implementations: { alpha: adapter("alpha", output) } as never,
    emitEvidence: async (e) => { evidence.push(e); },
    ...extra,
  };
}
const baseReq = { origin: "test", ownerId: OWNER, sessionId: "s1", capability: "memory.draft" as const, effect: "draft" as const, prompt: "hello" };

async function main(): Promise<void> {
  console.log("Unified AI trace & response verification");

  // --- 1. Trace propagation through the real gateway -----------------------
  {
    const ev: AiEvidenceEvent[] = [];
    seenContexts.length = 0;
    const r = await invokeAiGateway({ ...baseReq, traceId: "trace-caller-42" }, deps("ok", ev));
    check("TR1 caller trace id is reused in provenance", r.ok && r.provenance.traceId === "trace-caller-42", JSON.stringify(r.provenance));
    check("TR2 every evidence event carries the same trace id", ev.length >= 2 && ev.every((e) => e.traceId === "trace-caller-42"), JSON.stringify(ev.map((e) => e.traceId)));
    check("TR3 adapter receives the trace id in its invoke context", seenContexts[0]?.traceId === "trace-caller-42", JSON.stringify(seenContexts[0]));
    check("TR4 request id stays separate from trace id", r.provenance.requestId !== r.provenance.traceId);
  }
  {
    const ev: AiEvidenceEvent[] = [];
    const r = await invokeAiGateway({ ...baseReq }, deps("ok", ev));
    check("TR5 trace id is minted when the caller supplies none", r.ok && r.provenance.traceId.startsWith("trace-"), r.provenance.traceId);
  }
  {
    const ev: AiEvidenceEvent[] = [];
    const r = await invokeAiGateway({ ...baseReq, traceId: "trace-denied" }, deps("ok", ev, { implementations: {} as never }));
    check("TR6 denied/unselected path still carries the caller trace id", !r.ok && r.provenance.traceId === "trace-denied" && ev.every((e) => e.traceId === "trace-denied"));
  }
  {
    // Evidence failure is not swallowed: the gateway throws, so no output reaches a caller.
    let threw = false;
    try {
      await invokeAiGateway({ ...baseReq, traceId: "trace-ev" }, deps("ok", [], { emitEvidence: async () => { throw new Error("AI_GATEWAY_EVIDENCE_UNAVAILABLE"); } }));
    } catch { threw = true; }
    check("TR7 evidence failure throws; no output is returned without evidence", threw);
  }

  // --- 2. Response gate: false success, missing evidence, schema, cross-tenant ---
  const ok = { ok: true, recordId: "rec-1", ownerId: OWNER, traceId: "t-1" };
  {
    const d = tc.gateResponse({ traceId: "t-1", ownerId: OWNER, schemaValid: true, evidenceRecorded: true, claimsOutcome: true, canonical: ok });
    check("RB1 verified canonical outcome is released", d.allowed && d.verification === "VERIFIED" && d.recordId === "rec-1");
    check("RB1b released text is returned when allowed", tc.releaseResponse("บันทึกแล้ว", d) === "บันทึกแล้ว");
  }
  {
    const d = tc.gateResponse({ traceId: "t-1", ownerId: OWNER, schemaValid: true, evidenceRecorded: true, claimsOutcome: true, canonical: null });
    check("FS1 false success: claim without canonical result is BLOCKED", !d.allowed && d.code === "CANONICAL_EVIDENCE_MISSING", JSON.stringify(d));
    check("FS1b blocked text is never released", tc.releaseResponse("บันทึกแล้ว", d) === null);
    check("FS1c block carries the trace id", !d.allowed && d.traceId === "t-1");
  }
  {
    const d = tc.gateResponse({ traceId: "t-1", ownerId: OWNER, schemaValid: true, evidenceRecorded: true, claimsOutcome: true, canonical: { ...ok, ok: false, error: "DB_REJECTED" } });
    check("FS2 canonical reported failure: BLOCKED even if AI says success", !d.allowed && d.code === "CANONICAL_NOT_OK" && tc.releaseResponse("สำเร็จ", d) === null);
  }
  {
    const d = tc.gateResponse({ traceId: "t-1", ownerId: OWNER, schemaValid: true, evidenceRecorded: true, claimsOutcome: true, canonical: { ...ok, recordId: null } });
    check("FS3 canonical ok without a record id: BLOCKED", !d.allowed && d.code === "CANONICAL_EVIDENCE_MISSING");
  }
  {
    const d = tc.gateResponse({ traceId: "t-1", ownerId: OWNER, schemaValid: true, evidenceRecorded: true, claimsOutcome: true, canonical: { ...ok, traceId: "t-OTHER" } });
    check("FS4 canonical result from a different trace: BLOCKED", !d.allowed && d.code === "CANONICAL_TRACE_MISMATCH");
  }
  {
    const d = tc.gateResponse({ traceId: "t-1", ownerId: OWNER, schemaValid: true, evidenceRecorded: true, claimsOutcome: true, canonical: { ...ok, traceId: null } });
    check("FS5 canonical result that does not echo the trace: BLOCKED (cannot prove same request)", !d.allowed && d.code === "CANONICAL_TRACE_MISMATCH");
  }
  {
    const d = tc.gateResponse({ traceId: "t-1", ownerId: OWNER, schemaValid: true, evidenceRecorded: true, claimsOutcome: true, canonical: { ...ok, ownerId: OTHER_OWNER } });
    check("CT1 cross-tenant canonical record: BLOCKED", !d.allowed && d.code === "CANONICAL_CROSS_TENANT", JSON.stringify(d));
    check("CT1b cross-tenant block releases nothing", tc.releaseResponse("ข้อมูลของลูกค้าอื่น", d) === null);
  }
  {
    const d = tc.gateResponse({ traceId: "t-1", ownerId: OWNER, schemaValid: false, evidenceRecorded: true, claimsOutcome: true, canonical: ok });
    check("IS1 invalid business schema blocks even with a canonical ok", !d.allowed && d.code === "AI_SCHEMA_BLOCKED");
  }
  {
    const d = tc.gateResponse({ traceId: "t-1", ownerId: OWNER, schemaValid: true, evidenceRecorded: false, claimsOutcome: false });
    check("EV1 missing AI evidence blocks even an answer-only response", !d.allowed && d.code === "AI_EVIDENCE_MISSING");
  }
  {
    const d = tc.gateResponse({ traceId: "t-1", ownerId: OWNER, schemaValid: true, evidenceRecorded: true, claimsOutcome: false });
    check("AN1 answer-only response (no outcome claim) is released as UNVERIFIED", d.allowed && d.verification === "UNVERIFIED");
  }

  // Invalid business input is rejected before it can become a claim.
  check("IS2 invalid event schema is rejected by the business validator", !validateEventExtract({ event_type: "ลักลอบ", confidence: 2 }).ok);

  // --- 3. Provenance honesty ----------------------------------------------
  {
    const p = tc.buildDataProvenance({ providerId: "alpha", modelId: "m", capability: "memory.draft", runtime: "next", ownerId: OWNER, sourceRefs: ["msg-1"], updatedAt: "2026-10-20T00:00:00Z", evidenceRef: "ev-1", canonicalVerified: true });
    check("DP1 VERIFIED only when canonical verified AND evidence present", p.verification === "VERIFIED" && p.evidenceRef === "ev-1");
    const noEv = tc.buildDataProvenance({ providerId: "alpha", modelId: "m", capability: "memory.draft", runtime: "next", ownerId: OWNER, sourceRefs: [], updatedAt: "t", evidenceRef: null, canonicalVerified: true });
    check("DP2 no evidence reference stays UNVERIFIED even if canonical claims verified", noEv.verification === "UNVERIFIED");
    const notCanonical = tc.buildDataProvenance({ providerId: "alpha", modelId: null, capability: "memory.draft", runtime: "next", ownerId: OWNER, sourceRefs: [], updatedAt: "t", evidenceRef: "ev", canonicalVerified: false });
    check("DP3 AI-only extraction is UNVERIFIED and model unknown stays null", notCanonical.verification === "UNVERIFIED" && notCanonical.modelId === null);
    check("DP4 sources are copied, not aliased", (() => { const src = ["a"]; const q = tc.buildDataProvenance({ providerId: null, modelId: null, capability: "c", runtime: "next", ownerId: OWNER, sourceRefs: src, updatedAt: "t", evidenceRef: null, canonicalVerified: false }); src.push("b"); return q.sourceRefs.length === 1; })());
  }

  // --- 4. Trace id helper --------------------------------------------------
  check("TI1 ensureTraceId reuses a non-empty supplied id", tc.ensureTraceId("  abc  ", () => "minted") === "abc");
  check("TI2 ensureTraceId mints when supplied is blank", tc.ensureTraceId("   ", () => "minted") === "minted");

  // --- 5. Node / Deno contract parity --------------------------------------
  check("CP1 Deno trace contract file is byte-identical to Node", read("services/ai/traceContract.ts") === read("supabase/functions/_shared/ai/traceContract.ts"));
  // Same decisions on both runtimes for the same inputs.
  const cases: Parameters<typeof tc.gateResponse>[0][] = [
    { traceId: "t", ownerId: OWNER, schemaValid: true, evidenceRecorded: true, claimsOutcome: true, canonical: null },
    { traceId: "t", ownerId: OWNER, schemaValid: true, evidenceRecorded: true, claimsOutcome: true, canonical: { ok: true, recordId: "r", ownerId: OWNER, traceId: "t" } },
    { traceId: "t", ownerId: OWNER, schemaValid: true, evidenceRecorded: true, claimsOutcome: true, canonical: { ok: true, recordId: "r", ownerId: OTHER_OWNER, traceId: "t" } },
    { traceId: "t", ownerId: OWNER, schemaValid: false, evidenceRecorded: true, claimsOutcome: false },
    { traceId: "t", ownerId: OWNER, schemaValid: true, evidenceRecorded: false, claimsOutcome: false },
  ];
  const same = cases.every((c) => JSON.stringify(tc.gateResponse(c)) === JSON.stringify(tcDeno.gateResponse(c)));
  check("CP2 Node and Deno return identical gate decisions", same);

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.log("FAILED:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

void main();
