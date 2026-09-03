import {
  computeDecisionFingerprint,
  computeVerifierResultFingerprint,
  freezeVerificationProducerProvenance,
  validateVerificationProducerProvenance,
  type VerificationProducerProvenanceV1,
} from "./producer-provenance";
import { UI_RENDER_AUTHORITY_ID, UI_RENDER_VERIFICATION_AUTHORITY_BINDING_V1 } from "../../control/ui-render-verification/authority-binding";
import { UI_RENDER_VERIFIER_CONTRACT_DECLARATION } from "../../control/ui-render-verification/declaration";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };
let passed = 0; let failed = 0;
const assert = (condition: boolean, message: string): void => { if (!condition) throw new Error(message); };
function check(name: string, body: () => void): void { try { body(); passed++; console.log(`PASS ${name}`); } catch (error) { failed++; console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); } }

const result = { verdict: "VERIFIED", found_elements: ["h1:System Graph"], missing_elements: [], source_digest: "implementation-evidence-not-identity" } as const;
const provenance = (): VerificationProducerProvenanceV1 => ({
  producer_identity: UI_RENDER_AUTHORITY_ID,
  authority_binding_id: UI_RENDER_VERIFICATION_AUTHORITY_BINDING_V1.binding_id,
  binding_version: UI_RENDER_VERIFICATION_AUTHORITY_BINDING_V1.binding_version,
  verifier_contract_identity: { verifier_contract_id: UI_RENDER_VERIFIER_CONTRACT_DECLARATION.verifier_contract_id, contract_version: UI_RENDER_VERIFIER_CONTRACT_DECLARATION.contract_version, semantic_digest: UI_RENDER_VERIFIER_CONTRACT_DECLARATION.semantic_digest },
  verifier_result_fingerprint: computeVerifierResultFingerprint(result),
  decision_fingerprint: computeDecisionFingerprint({ decision_class: "UI_RENDER", proposition_kind: "REQUIRED_RENDERED_ELEMENTS_PRESENT_FOR_CHANGE", result_fingerprint: computeVerifierResultFingerprint(result) }),
  emission_boundary_identity: { boundary_id: "TEST_ONLY:future-ui-render-trusted-adapter", boundary_version: "1.0.0", semantic_digest: "1".repeat(64) },
});

check("A. same semantic result has same fingerprint", () => assert(computeVerifierResultFingerprint(result) === computeVerifierResultFingerprint({ ...result }), "result fingerprint is not deterministic"));
check("B. result property reorder preserves fingerprint", () => assert(computeVerifierResultFingerprint(result) === computeVerifierResultFingerprint({ source_digest: result.source_digest, missing_elements: result.missing_elements, found_elements: result.found_elements, verdict: result.verdict }), "property order changed fingerprint"));
check("C. semantic result change changes fingerprint", () => assert(computeVerifierResultFingerprint(result) !== computeVerifierResultFingerprint({ ...result, verdict: "FAILED" }), "semantic result change did not change fingerprint"));
check("D. missing producer identity is invalid", () => assert(!validateVerificationProducerProvenance({ ...provenance(), producer_identity: "" }).valid, "missing producer passed"));
check("E. missing authority binding is invalid", () => assert(!validateVerificationProducerProvenance({ ...provenance(), authority_binding_id: "" }).valid, "missing binding passed"));
check("F. missing contract identity is invalid", () => assert(!validateVerificationProducerProvenance({ ...provenance(), verifier_contract_identity: null }).valid, "missing contract passed"));
check("G. missing result fingerprint is invalid", () => assert(!validateVerificationProducerProvenance({ ...provenance(), verifier_result_fingerprint: "" }).valid, "missing result fingerprint passed"));
check("H. missing decision fingerprint is invalid", () => assert(!validateVerificationProducerProvenance({ ...provenance(), decision_fingerprint: "" }).valid, "missing decision fingerprint passed"));
check("I. missing emission boundary is invalid", () => assert(!validateVerificationProducerProvenance({ ...provenance(), emission_boundary_identity: null }).valid, "missing emission boundary passed"));
check("J. producer and authority are distinct concepts", () => assert(provenance().producer_identity !== provenance().authority_binding_id, "producer collapsed into authority binding"));
check("K. producer and emission boundary are distinct concepts", () => assert(provenance().producer_identity !== provenance().emission_boundary_identity.boundary_id, "producer collapsed into emission boundary"));
check("L. provenance is immutable after freezing", () => { const frozen = freezeVerificationProducerProvenance(provenance()); assert(Object.isFrozen(frozen) && Object.isFrozen(frozen.verifier_contract_identity), "provenance was not deeply frozen"); });
check("M. caller producer identity alone does not establish trust", () => assert(!validateVerificationProducerProvenance({ producer_identity: "caller-choice" }).valid, "partial caller record became valid provenance"));
check("N. V1 has no crypto/signature field or dependency", () => { const p = provenance(); assert(!("signature" in p) && !("key_id" in p) && !("hmac" in p), "crypto field present"); });
check("O. UI_RENDER B1/C1/V1 is representable without changing identities", () => { const p = provenance(); assert(p.producer_identity === UI_RENDER_AUTHORITY_ID && p.authority_binding_id === UI_RENDER_VERIFICATION_AUTHORITY_BINDING_V1.binding_id && p.binding_version === "1.0.0" && p.verifier_contract_identity.verifier_contract_id === UI_RENDER_VERIFIER_CONTRACT_DECLARATION.verifier_contract_id && p.verifier_contract_identity.contract_version === "1.0.0" && p.verifier_contract_identity.semantic_digest === UI_RENDER_VERIFIER_CONTRACT_DECLARATION.semantic_digest && p.emission_boundary_identity.boundary_id.startsWith("TEST_ONLY:"), "UI_RENDER provenance compatibility failed"); });

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
