import {
  canonicalBindingBytes,
  classifyImmutableBindingCandidates,
  compareBindingIdentity,
  computeBindingId,
  validateBindingIdentity,
  type VerificationAuthorityBindingV1,
} from "./verification-authority-binding";
import {
  UI_RENDER_AUTHORITY_ID,
  UI_RENDER_VERIFICATION_AUTHORITY_BINDING_V1,
  resolveVerificationAuthorityBinding,
  validateUiRenderAuthorityBinding,
} from "../../control/ui-render-verification/authority-binding";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };
let passed = 0; let failed = 0;
const assert = (condition: boolean, message: string): void => { if (!condition) throw new Error(message); };
function check(name: string, body: () => void): void { try { body(); passed++; console.log(`PASS ${name}`); } catch (error) { failed++; console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); } }

const b = UI_RENDER_VERIFICATION_AUTHORITY_BINDING_V1;
const clone = (overrides: Partial<VerificationAuthorityBindingV1> = {}): VerificationAuthorityBindingV1 => ({ ...b, ...overrides, verifier_contract_identity: { ...b.verifier_contract_identity, ...(overrides.verifier_contract_identity ?? {}) }, binding_evidence_refs: [...b.binding_evidence_refs] });
const reidentified = (input: VerificationAuthorityBindingV1): VerificationAuthorityBindingV1 => ({ ...input, binding_id: computeBindingId(input) });

check("A. same semantic tuple produces same binding ID", () => assert(computeBindingId(b) === b.binding_id, "binding ID is not deterministic"));
check("B. semantic property order does not change binding ID", () => {
  const reordered = reidentified({ ...b, verifier_contract_identity: { semantic_digest: b.verifier_contract_identity.semantic_digest, contract_version: b.verifier_contract_identity.contract_version, verifier_contract_id: b.verifier_contract_identity.verifier_contract_id } });
  assert(reordered.binding_id === b.binding_id, "property order changed binding ID");
});
check("C. evidence order/metadata does not change binding identity", () => assert(reidentified(clone({ binding_evidence_refs: ["different", "order"] })).binding_id === b.binding_id, "evidence changed binding ID"));
check("D. authority ID changes binding ID", () => assert(reidentified(clone({ authority_id: "other-capability" })).binding_id !== b.binding_id, "authority ID did not change binding ID"));
check("E. contract identity/version changes binding ID", () => assert(reidentified(clone({ verifier_contract_identity: { ...b.verifier_contract_identity, contract_version: "2.0.0" } })).binding_id !== b.binding_id, "contract identity did not change binding ID"));
check("F. binding version changes binding ID", () => assert(reidentified(clone({ binding_version: "2.0.0" })).binding_id !== b.binding_id, "binding version did not change binding ID"));
check("G. exact UI_RENDER lookup resolves B1", () => { const result = resolveVerificationAuthorityBinding({ decision_class: "UI_RENDER", proposition_kind: "REQUIRED_RENDERED_ELEMENTS_PRESENT_FOR_CHANGE" }); assert(result.status === "RESOLVED" && result.binding?.binding_id === b.binding_id, `expected RESOLVED, got ${result.status}`); });
check("H. unknown proposition is UNRESOLVED", () => assert(resolveVerificationAuthorityBinding({ decision_class: "UI_RENDER", proposition_kind: "UNKNOWN" }).status === "UNRESOLVED", "unknown proposition resolved"));
check("I. incompatible authority is AMBIGUOUS", () => { const other = reidentified(clone({ authority_id: "other-capability" })); const result = classifyImmutableBindingCandidates([b, other], { decision_class: b.decision_class, proposition_kind: b.proposition_kind, binding_version: b.binding_version }); assert(result.status === "AMBIGUOUS", `expected AMBIGUOUS, got ${result.status}`); });
check("J. binding ID collision with different tuple is CORRUPT", () => { const corrupt = { ...clone({ authority_id: "other-capability" }), binding_id: b.binding_id }; assert(validateBindingIdentity(corrupt).status === "CORRUPT" && compareBindingIdentity(b, corrupt) === "CORRUPT", "collision was not CORRUPT"); });
check("K. tampered contract digest is CORRUPT", () => { const tampered = reidentified(clone({ verifier_contract_identity: { ...b.verifier_contract_identity, semantic_digest: "0".repeat(64) } })); const result = validateUiRenderAuthorityBinding(tampered); assert(result.status === "CORRUPT", `expected CORRUPT, got ${result.status}`); });
check("L. contract proposition mismatch is CORRUPT", () => { const mismatch = reidentified(clone({ proposition_kind: "OTHER" })); const result = validateUiRenderAuthorityBinding(mismatch); assert(result.status === "CORRUPT", `expected CORRUPT, got ${result.status}`); });
check("M. resolver has no caller-selected authority input", () => { const result = resolveVerificationAuthorityBinding({ decision_class: "UI_RENDER", proposition_kind: "REQUIRED_RENDERED_ELEMENTS_PRESENT_FOR_CHANGE" }); assert(result.binding?.authority_id === UI_RENDER_AUTHORITY_ID, "resolver accepted caller authority"); });
check("N. no self-declaration API is exposed", () => assert(!("createBinding" in (resolveVerificationAuthorityBinding as unknown as Record<string, unknown>)), "self-declaration API exposed"));
check("O. binding carries no source freshness claim", () => assert(!canonicalBindingBytes(b).includes("source_digest") && !canonicalBindingBytes(b).includes("fresh"), "freshness entered binding identity"));

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
