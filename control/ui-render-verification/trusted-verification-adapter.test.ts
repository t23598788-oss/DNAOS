import {
  runUiRenderTrustedVerificationForTest,
  type UiRenderTrustedAdapterInput,
} from "./trusted-verification-adapter";
import { UI_RENDER_VERIFIER_CONTRACT_DECLARATION } from "./declaration";
import { UI_RENDER_VERIFICATION_AUTHORITY_BINDING_V1, UI_RENDER_AUTHORITY_ID } from "./authority-binding";
import { UI_RENDER_TRUSTED_EMISSION_BOUNDARY_DECLARATION } from "./emission-boundary-declaration";
import type { RenderEvidence } from "./types";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };
let passed = 0; let failed = 0;
const assert = (condition: boolean, message: string): void => { if (!condition) throw new Error(message); };
function check(name: string, body: () => void): void { try { body(); passed++; console.log(`PASS ${name}`); } catch (error) { failed++; console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); } }

const input: UiRenderTrustedAdapterInput = {
  execution_id: "exec-adapter-1", change_id: "change-1", resource_id: ["resource-1"], route: "/system", runtime_url: "http://127.0.0.1:5177", source_paths: ["control/ui-render-verification/contract.ts"], data_source: "live-runtime", expected_elements: ["h1:System Graph"], previously_required: [],
};
const result: RenderEvidence = {
  execution_id: input.execution_id, change_id: input.change_id, resource_id: input.resource_id, capability_id: ["caller-choice"], route: input.route, runtime_url: input.runtime_url, source_digest: "a".repeat(64), data_source: input.data_source, screenshot_path: "/tmp/real.png", evidence_reference: "render-evidence:exec-adapter-1", observed_at: "2026-08-29T00:00:00.000Z", expected_elements: input.expected_elements, found_elements: input.expected_elements, missing_elements: [], visual_regression: "NONE", verdict: "VERIFIED", reason: "real browser evidence",
};

const run = (overrides: Parameters<typeof runUiRenderTrustedVerificationForTest>[1] = {}) => runUiRenderTrustedVerificationForTest(input, { verifier: () => result, ...overrides });

check("A. invokes verifier and preserves exact R1 object", () => { let calls = 0; const outcome = runUiRenderTrustedVerificationForTest(input, { verifier: (request) => { calls++; assert(request.capability_id[0] === UI_RENDER_AUTHORITY_ID, "adapter did not bind capability A"); return result; } }); assert(calls === 1 && outcome.status === "RESOLVED" && outcome.package.verifier_result === result, "R1 was not preserved exactly"); });
check("B. emits D1 and P1 with locked identities", () => { const outcome = run(); assert(outcome.status === "RESOLVED", "valid composition did not resolve"); if (outcome.status !== "RESOLVED") return; const { verification_decision: d, producer_provenance: p } = outcome.package; assert(d.decision_class === "UI_RENDER" && d.verdict === "VERIFIED" && d.evidence_refs.includes(result.evidence_reference), "D1 did not preserve R1"); assert(p.producer_identity === UI_RENDER_AUTHORITY_ID && p.authority_binding_id === UI_RENDER_VERIFICATION_AUTHORITY_BINDING_V1.binding_id && p.binding_version === "1.0.0" && p.verifier_contract_identity.semantic_digest === UI_RENDER_VERIFIER_CONTRACT_DECLARATION.semantic_digest && p.emission_boundary_identity.semantic_digest === UI_RENDER_TRUSTED_EMISSION_BOUNDARY_DECLARATION.semantic_digest, "P1 identity mismatch"); });
check("C. package is deeply immutable", () => { const outcome = run(); assert(outcome.status === "RESOLVED" && Object.isFrozen(outcome.package) && Object.isFrozen(outcome.package.verification_decision) && Object.isFrozen(outcome.package.producer_provenance), "package was mutable"); });
check("D. caller cannot override producer capability", () => { const outcome = runUiRenderTrustedVerificationForTest({ ...input, capability_id: ["caller-choice"] } as UiRenderTrustedAdapterInput, { verifier: () => result }); assert(outcome.status === "FAIL_CLOSED" && outcome.stage === "INPUT", "caller capability override was accepted"); });
check("E. caller cannot supply a prebuilt result, decision, provenance, or boundary", () => { const outcome = runUiRenderTrustedVerificationForTest({ ...input, verifier_result: result, verification_decision: {}, producer_provenance: {}, emission_boundary_identity: {} } as UiRenderTrustedAdapterInput, { verifier: () => result }); assert(outcome.status === "FAIL_CLOSED" && outcome.stage === "INPUT", "prebuilt trusted fields were accepted"); });
check("F. C1 digest mismatch stops before verifier", () => { let calls = 0; const outcome = runUiRenderTrustedVerificationForTest(input, { declaration: { ...UI_RENDER_VERIFIER_CONTRACT_DECLARATION, semantic_digest: "0".repeat(64) }, verifier: () => { calls++; return result; } }); assert(outcome.status === "FAIL_CLOSED" && outcome.stage === "C1" && calls === 0, "corrupt C1 was invoked"); });
check("G. B1 missing/corrupt stops before verifier", () => { let calls = 0; const outcome = runUiRenderTrustedVerificationForTest(input, { binding: null, verifier: () => { calls++; return result; } }); assert(outcome.status === "FAIL_CLOSED" && outcome.stage === "B1" && calls === 0, "missing B1 was invoked"); });
check("H. T1 stage mismatch stops before verifier", () => { let calls = 0; const outcome = runUiRenderTrustedVerificationForTest(input, { boundary: { ...UI_RENDER_TRUSTED_EMISSION_BOUNDARY_DECLARATION, composition_semantics: { ...UI_RENDER_TRUSTED_EMISSION_BOUNDARY_DECLARATION.composition_semantics, ordered_stages: ["WRONG_STAGE"] } }, verifier: () => { calls++; return result; } }); assert(outcome.status === "FAIL_CLOSED" && outcome.stage === "T1" && calls === 0, "corrupt T1 was invoked"); });
check("I. FAILED and UNPROVEN remain non-accepting verdicts", () => { for (const verdict of ["FAILED", "UNPROVEN"] as const) { const outcome = runUiRenderTrustedVerificationForTest(input, { verifier: () => ({ ...result, verdict }) }); assert(outcome.status === "RESOLVED" && outcome.package.verification_decision.verdict === verdict, `${verdict} was changed`); } });
check("J. missing required evidence fails closed", () => { const outcome = runUiRenderTrustedVerificationForTest(input, { verifier: () => ({ ...result, evidence_reference: "", screenshot_path: "" }) }); assert(outcome.status === "FAIL_CLOSED" && outcome.stage === "D1", "missing evidence was accepted"); });
check("K. missing freshness input fails closed without fabrication", () => { const outcome = runUiRenderTrustedVerificationForTest(input, { verifier: () => ({ ...result, observed_at: "" }) }); assert(outcome.status === "FAIL_CLOSED" && outcome.stage === "D1" && outcome.reason.includes("freshness"), "missing freshness result was accepted"); });
check("L. semantic decision changes alter identity", () => { const first = run(); const a = first.status === "RESOLVED" ? first.package.verification_decision.decision_fingerprint : ""; const b = runUiRenderTrustedVerificationForTest({ ...input, expected_elements: ["h1:Other"] }, { verifier: () => ({ ...result, expected_elements: ["h1:Other"] }) }); assert(b.status === "RESOLVED" && a !== b.package.verification_decision.decision_fingerprint, "decision fingerprint ignored semantic change"); });

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
