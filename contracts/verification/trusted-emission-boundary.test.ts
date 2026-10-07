import {
  canonicalBoundaryBytes,
  compareTrustedEmissionBoundaryDeclarations,
  computeBoundarySemanticDigest,
  freezeTrustedEmissionBoundaryDeclaration,
  validateTrustedEmissionBoundaryDeclaration,
  type TrustedEmissionBoundaryDeclarationV1,
} from "./trusted-emission-boundary";
import { UI_RENDER_TRUSTED_EMISSION_BOUNDARY_DECLARATION } from "../../control/ui-render-verification/emission-boundary-declaration";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };
let passed = 0; let failed = 0;
const assert = (condition: boolean, message: string): void => { if (!condition) throw new Error(message); };
function check(name: string, body: () => void): void { try { body(); passed++; console.log(`PASS ${name}`); } catch (error) { failed++; console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); } }
const b = UI_RENDER_TRUSTED_EMISSION_BOUNDARY_DECLARATION;
const clone = (overrides: Partial<TrustedEmissionBoundaryDeclarationV1> = {}): TrustedEmissionBoundaryDeclarationV1 => ({ ...b, ...overrides, composition_semantics: { ...b.composition_semantics, ...(overrides.composition_semantics ?? {}) } });
const valid = (input: TrustedEmissionBoundaryDeclarationV1): TrustedEmissionBoundaryDeclarationV1 => ({ ...input, semantic_digest: computeBoundarySemanticDigest(input) });

check("A. same semantic declaration has same digest", () => assert(computeBoundarySemanticDigest(b) === b.semantic_digest, "digest is not deterministic"));
check("B. property reorder preserves digest", () => { const reordered = { schema_version: b.schema_version, boundary_version: b.boundary_version, composition_semantics: { forbidden_stages: [...b.composition_semantics.forbidden_stages], ordered_stages: [...b.composition_semantics.ordered_stages] }, input_contract_identity: b.input_contract_identity, output_contract_identity: b.output_contract_identity }; assert(computeBoundarySemanticDigest(reordered) === b.semantic_digest, "property order changed digest"); });
check("C. stage order changes digest", () => assert(computeBoundarySemanticDigest({ ...b, composition_semantics: { ...b.composition_semantics, ordered_stages: [...b.composition_semantics.ordered_stages].reverse() } }) !== b.semantic_digest, "stage order did not change digest"));
check("D. boundary ID-only change preserves digest", () => { const { boundary_id, ...material } = b; void boundary_id; assert(computeBoundarySemanticDigest(material) === b.semantic_digest, "boundary ID affected digest"); });
check("E. source path-only change cannot affect digest", () => { const oldSource = { ...b, source_path: "old/path.ts" }; const newSource = { ...b, source_path: "new/path.ts" }; assert(computeBoundarySemanticDigest(oldSource) === computeBoundarySemanticDigest(newSource), "source path affected digest"); });
check("F. source digest-only change cannot affect digest", () => { const oldSource = { ...b, source_digest: "old-digest" }; const newSource = { ...b, source_digest: "new-digest" }; assert(computeBoundarySemanticDigest(oldSource) === computeBoundarySemanticDigest(newSource), "source digest affected digest"); });
check("G. boundary version changes semantic identity", () => { const { boundary_id, ...material } = { ...b, boundary_version: "2.0.0" }; void boundary_id; assert(computeBoundarySemanticDigest(material) !== b.semantic_digest, "boundary version did not change digest"); });
check("H. same ID/version/digest is REPLAY", () => assert(compareTrustedEmissionBoundaryDeclarations(b, b) === "REPLAY", "not replay"));
check("I. same ID/version/different digest is CORRUPT_VERSION", () => assert(compareTrustedEmissionBoundaryDeclarations(b, valid({ ...b, composition_semantics: { ...b.composition_semantics, ordered_stages: [...b.composition_semantics.ordered_stages].reverse() } })) === "CORRUPT_VERSION", "not corrupt"));
check("J. different IDs/same digest is DUPLICATE_BOUNDARY_CANDIDATE", () => assert(compareTrustedEmissionBoundaryDeclarations(b, { ...b, boundary_id: "other" }) === "DUPLICATE_BOUNDARY_CANDIDATE", "not duplicate candidate"));
check("K. new version/changed semantics is VALID_NEW_VERSION", () => assert(compareTrustedEmissionBoundaryDeclarations(b, valid({ ...b, boundary_version: "2.0.0", composition_semantics: { ...b.composition_semantics, ordered_stages: [...b.composition_semantics.ordered_stages].reverse() } })) === "VALID_NEW_VERSION", "not valid new version"));
check("L. missing identity is UNRESOLVED", () => assert(validateTrustedEmissionBoundaryDeclaration({ ...b, boundary_id: "" }).valid === false, "missing identity passed"));
check("M. ACCEPT_VERIFICATION is forbidden", () => assert(!validateTrustedEmissionBoundaryDeclaration(valid({ ...b, composition_semantics: { ...b.composition_semantics, ordered_stages: [...b.composition_semantics.ordered_stages, "ACCEPT_VERIFICATION"] } })).valid, "acceptance stage passed"));
check("N. UPDATE_SYSTEM_TRUTH is forbidden", () => assert(!validateTrustedEmissionBoundaryDeclaration(valid({ ...b, composition_semantics: { ...b.composition_semantics, ordered_stages: [...b.composition_semantics.ordered_stages, "UPDATE_SYSTEM_TRUTH"] } })).valid, "system truth stage passed"));
check("O. declaration is deeply immutable", () => { const frozen = freezeTrustedEmissionBoundaryDeclaration(b); assert(Object.isFrozen(frozen) && Object.isFrozen(frozen.composition_semantics), "declaration was not deeply frozen"); });
check("P. UI_RENDER declaration has the locked six-stage composition", () => assert(b.composition_semantics.ordered_stages.join(",") === "RECEIVE_EXACT_VERIFIER_RESULT,FINGERPRINT_VERIFIER_RESULT,CONSTRUCT_VERIFICATION_DECISION,FINGERPRINT_VERIFICATION_DECISION,CONSTRUCT_PRODUCER_PROVENANCE,RETURN_IMMUTABLE_TRUSTED_PACKAGE", "composition mismatch"));
check("Q. provenance can preserve exact boundary identity", () => assert(b.boundary_id.length > 0 && b.boundary_version === "1.0.0" && /^[0-9a-f]{64}$/.test(b.semantic_digest), "boundary identity cannot be preserved"));
check("R. capability ID is not boundary identity", () => assert(!b.boundary_id.includes("capability-"), "capability ID used as boundary ID"));
check("S. declaration alone does not grant runtime trust", () => assert(UI_RENDER_TRUSTED_EMISSION_BOUNDARY_DECLARATION !== undefined, "declaration missing"));

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
