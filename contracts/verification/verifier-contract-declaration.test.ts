import {
  canonicalSemanticBytes,
  compareVerifierContractDeclarations,
  computeSemanticDigest,
  validateVerifierContractDeclaration,
  type VerifierContractDeclarationV1,
} from "./verifier-contract-declaration";
import { UI_RENDER_VERIFIER_CONTRACT_DECLARATION } from "../../control/ui-render-verification/declaration";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;
function check(name: string, body: () => void): void {
  try { body(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
function assert(condition: boolean, message: string): void { if (!condition) throw new Error(message); }

type Base = Omit<VerifierContractDeclarationV1, "semantic_digest">;
const base: Base = {
  schema_version: "VERIFIER_CONTRACT_DECLARATION_V1",
  verifier_contract_id: "id-a",
  contract_version: "1.0.0",
  decision_class: "UI_RENDER",
  proposition_kind: "REQUIRED_RENDERED_ELEMENTS_PRESENT_FOR_CHANGE",
  proposition_schema_or_parameters: { b: ["x", "y"], a: { z: true, q: 1 } },
  input_contract_identity: "input@1",
  output_contract_identity: "output@1",
  verdict_semantics: { VERIFIED: "all", FAILED: "missing" },
  required_evidence_identity: { components: ["dom", "screenshot"] },
};
const declared = (input: Base = base): VerifierContractDeclarationV1 => ({ ...input, semantic_digest: computeSemanticDigest(input) });

check("A. reordered object properties preserve digest", () => {
  const reordered: Base = { ...base, proposition_schema_or_parameters: { a: { q: 1, z: true }, b: ["x", "y"] } };
  assert(computeSemanticDigest(base) === computeSemanticDigest(reordered), "digest changed with object insertion order");
});
check("B. semantic field change changes digest", () => {
  assert(computeSemanticDigest(base) !== computeSemanticDigest({ ...base, proposition_kind: "OTHER" }), "semantic change did not change digest");
});
check("C. contract ID does not affect digest", () => {
  assert(computeSemanticDigest(base) === computeSemanticDigest({ ...base, verifier_contract_id: "id-b" }), "contract ID affected digest");
});
check("D. source/resource path is not semantic material", () => {
  const oldProvenance = { declaration: base, source_reference: "old/path.ts" };
  const newProvenance = { declaration: base, source_reference: "new/path.ts" };
  assert(computeSemanticDigest(oldProvenance.declaration) === computeSemanticDigest(newProvenance.declaration), "source path affected digest");
  assert(!canonicalSemanticBytes(base).includes("source_reference"), "source reference entered base semantic material");
});
check("E. same ID/version/digest is REPLAY", () => assert(compareVerifierContractDeclarations(declared(), declared()) === "REPLAY", "not REPLAY"));
check("F. same ID/version/different digest is CORRUPT_VERSION", () => assert(compareVerifierContractDeclarations(declared(), declared({ ...base, verdict_semantics: { VERIFIED: "changed" } })) === "CORRUPT_VERSION", "not CORRUPT_VERSION"));
check("G. different ID/same digest is DUPLICATE_CONTRACT_CANDIDATE", () => assert(compareVerifierContractDeclarations(declared(), declared({ ...base, verifier_contract_id: "id-b" })) === "DUPLICATE_CONTRACT_CANDIDATE", "not duplicate candidate"));
check("H. new version/changed digest is VALID_NEW_VERSION", () => assert(compareVerifierContractDeclarations(declared(), declared({ ...base, contract_version: "2.0.0", verdict_semantics: { VERIFIED: "changed" } })) === "VALID_NEW_VERSION", "not VALID_NEW_VERSION"));
check("I. tampered digest fails validation", () => assert(!validateVerifierContractDeclaration({ ...declared(), semantic_digest: "0".repeat(64) }).valid, "tampered digest passed"));
check("J. missing required identity fails validation", () => assert(!validateVerifierContractDeclaration({ ...declared(), input_contract_identity: "" }).valid, "missing identity passed"));
check("K. authority fields are absent from contract shape", () => assert(!("authority_id" in UI_RENDER_VERIFIER_CONTRACT_DECLARATION) && !("authority_identity_type" in UI_RENDER_VERIFIER_CONTRACT_DECLARATION), "authority field present"));
check("L. capability ID is absent from semantic digest", () => assert(!canonicalSemanticBytes(UI_RENDER_VERIFIER_CONTRACT_DECLARATION).includes("capability_id"), "capability ID entered digest"));
check("M. UI_RENDER declaration matches existing verifier semantics", () => {
  const d = UI_RENDER_VERIFIER_CONTRACT_DECLARATION;
  assert(d.decision_class === "UI_RENDER", "wrong decision class");
  assert(d.proposition_kind === "REQUIRED_RENDERED_ELEMENTS_PRESENT_FOR_CHANGE", "wrong proposition kind");
  assert(d.output_contract_identity === "dna-os/ui-render-verification/RenderEvidence@1", "wrong output identity");
  assert(validateVerifierContractDeclaration(d).valid, "UI declaration is invalid");
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
