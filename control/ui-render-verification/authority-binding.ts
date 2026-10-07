import {
  computeBindingId,
  classifyImmutableBindingCandidates,
  validateBindingIdentity,
  VERIFICATION_AUTHORITY_BINDING_SCHEMA_VERSION,
  type AuthorityBindingResolution,
  type VerificationAuthorityBindingV1,
} from "../../contracts/verification/verification-authority-binding";
import { UI_RENDER_VERIFIER_CONTRACT_DECLARATION } from "./declaration";
import { computeSemanticDigest, validateVerifierContractDeclaration } from "../../contracts/verification/verifier-contract-declaration";

const UI_RENDER_AUTHORITY_ID = "capability-d7fa7ab2-b683-430a-b1a9-66e63ed91fdf" as const;

const UI_RENDER_BINDING_BASE = {
  schema_version: VERIFICATION_AUTHORITY_BINDING_SCHEMA_VERSION,
  decision_class: "UI_RENDER",
  proposition_kind: "REQUIRED_RENDERED_ELEMENTS_PRESENT_FOR_CHANGE",
  authority_identity_type: "REGISTERED_CAPABILITY",
  authority_id: UI_RENDER_AUTHORITY_ID,
  verifier_contract_identity: {
    verifier_contract_id: "dna-os/ui-render-verification/required-rendered-elements",
    contract_version: "1.0.0",
    semantic_digest: "c2e9016bccb59eda6bb9b3b9b27f1eae5f74586d826fd847f644d4e773ded5e0",
  },
  binding_version: "1.0.0",
  binding_evidence_refs: [
    "software/registry-database/data/canonical/capabilities.jsonl:87",
    "software/registry-database/data/canonical/resources.jsonl:287",
    "software/registry-database/data/canonical/resource_capabilities.jsonl:93",
    "software/registry-database/data/canonical/relationships.jsonl:147",
    "control/ui-render-verification/contract.ts:11-14",
    "software/registry-database/data/canonical/evidence.jsonl:763",
  ],
} as const;

export const UI_RENDER_VERIFICATION_AUTHORITY_BINDING_V1: VerificationAuthorityBindingV1 = {
  ...UI_RENDER_BINDING_BASE,
  binding_id: computeBindingId(UI_RENDER_BINDING_BASE),
};

const IMMUTABLE_UI_RENDER_BINDINGS: readonly VerificationAuthorityBindingV1[] = [UI_RENDER_VERIFICATION_AUTHORITY_BINDING_V1];

export function validateUiRenderAuthorityBinding(binding: VerificationAuthorityBindingV1): AuthorityBindingResolution {
  const declarationValidation = validateVerifierContractDeclaration(UI_RENDER_VERIFIER_CONTRACT_DECLARATION);
  if (!declarationValidation.valid) return { status: "CORRUPT", binding: null, reason: `UI_RENDER declaration invalid: ${declarationValidation.reason}` };
  const declarationDigest = computeSemanticDigest((({ semantic_digest, ...material }) => material)(UI_RENDER_VERIFIER_CONTRACT_DECLARATION));
  const identity = binding.verifier_contract_identity;
  if (identity.verifier_contract_id !== UI_RENDER_VERIFIER_CONTRACT_DECLARATION.verifier_contract_id || identity.contract_version !== UI_RENDER_VERIFIER_CONTRACT_DECLARATION.contract_version || identity.semantic_digest !== declarationDigest) return { status: "CORRUPT", binding: null, reason: "binding contract identity does not match the validated UI_RENDER declaration" };
  if (binding.decision_class !== UI_RENDER_VERIFIER_CONTRACT_DECLARATION.decision_class || binding.proposition_kind !== UI_RENDER_VERIFIER_CONTRACT_DECLARATION.proposition_kind) return { status: "CORRUPT", binding: null, reason: "binding class/proposition does not match the UI_RENDER declaration" };
  if (binding.authority_id !== UI_RENDER_AUTHORITY_ID || binding.authority_identity_type !== "REGISTERED_CAPABILITY") return { status: "UNRESOLVED", binding: null, reason: "exact registered UI_RENDER authority identity could not be validated" };
  return { status: "RESOLVED", binding, reason: "binding matches the validated UI_RENDER declaration and exact registered capability identity" };
}

/** Query-only resolver over the one immutable UI_RENDER binding. */
export function resolveVerificationAuthorityBinding(query: { decision_class: string; proposition_kind: string; binding_version?: string }): AuthorityBindingResolution {
  const classified = classifyImmutableBindingCandidates(IMMUTABLE_UI_RENDER_BINDINGS, query);
  if (classified.status !== "RESOLVED" || !classified.binding) return classified;
  return validateUiRenderAuthorityBinding(classified.binding);
}

export { UI_RENDER_AUTHORITY_ID };
