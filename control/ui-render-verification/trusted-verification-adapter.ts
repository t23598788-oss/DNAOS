/**
 * The sole UI_RENDER composition boundary.
 *
 * This module emits a verifier result + decision + producer provenance. It
 * does not accept a result, persist anything, update System Truth, or grant
 * completion/acceptance.
 */

import {
  validateVerifierContractDeclaration,
  type VerifierContractDeclarationV1,
} from "../../contracts/verification/verifier-contract-declaration";
import {
  computeVerifierResultFingerprint,
  freezeVerificationProducerProvenance,
  validateVerificationProducerProvenance,
  type VerificationProducerProvenanceV1,
} from "../../contracts/verification/producer-provenance";
import {
  createVerificationDecision,
  freezeVerificationDecision,
  validateVerificationDecision,
  type VerificationDecisionV1,
} from "../../contracts/verification/verification-decision";
import {
  validateTrustedEmissionBoundaryDeclaration,
  type TrustedEmissionBoundaryDeclarationV1,
} from "../../contracts/verification/trusted-emission-boundary";
import {
  resolveVerificationAuthorityBinding,
  validateUiRenderAuthorityBinding,
} from "./authority-binding";
import { validateBindingIdentity, type VerificationAuthorityBindingV1 } from "../../contracts/verification/verification-authority-binding";
import { UI_RENDER_VERIFIER_CONTRACT_DECLARATION } from "./declaration";
import { UI_RENDER_TRUSTED_EMISSION_BOUNDARY_DECLARATION } from "./emission-boundary-declaration";
import { UI_RENDER_AUTHORITY_ID, UI_RENDER_VERIFICATION_AUTHORITY_BINDING_V1 } from "./authority-binding";
import { verifyRender, type RenderVerificationRequest } from "./render-verify";
import type { RenderEvidence } from "./types";

export type UiRenderTrustedAdapterInput = Omit<RenderVerificationRequest, "capability_id">;

export interface TrustedUiRenderVerificationPackage {
  readonly verifier_result: Readonly<RenderEvidence>;
  readonly verification_decision: Readonly<VerificationDecisionV1>;
  readonly producer_provenance: Readonly<VerificationProducerProvenanceV1>;
}

export type TrustedUiRenderAdapterOutcome =
  | { readonly status: "RESOLVED"; readonly package: TrustedUiRenderVerificationPackage }
  | { readonly status: "FAIL_CLOSED"; readonly stage: string; readonly reason: string };

interface AdapterDependencies {
  readonly verifier: (request: RenderVerificationRequest) => RenderEvidence;
  readonly declaration: VerifierContractDeclarationV1;
  readonly binding: VerificationAuthorityBindingV1 | null;
  readonly boundary: TrustedEmissionBoundaryDeclarationV1;
}

const EXPECTED_BOUNDARY_STAGES = [
  "RECEIVE_EXACT_VERIFIER_RESULT",
  "FINGERPRINT_VERIFIER_RESULT",
  "CONSTRUCT_VERIFICATION_DECISION",
  "FINGERPRINT_VERIFICATION_DECISION",
  "CONSTRUCT_PRODUCER_PROVENANCE",
  "RETURN_IMMUTABLE_TRUSTED_PACKAGE",
] as const;

function fail(stage: string, reason: string): TrustedUiRenderAdapterOutcome {
  return { status: "FAIL_CLOSED", stage, reason };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasCallerSuppliedTrustedFields(input: Record<string, unknown>): string | null {
  const forbidden = [
    "capability_id", "producer_identity", "authority", "authority_binding_id",
    "binding_version", "verifier_contract_identity", "verifier_result",
    "verification_decision", "producer_provenance", "emission_boundary_identity",
  ];
  return forbidden.find((field) => Object.prototype.hasOwnProperty.call(input, field)) ?? null;
}

function validateComposition(deps: AdapterDependencies): TrustedUiRenderAdapterOutcome | null {
  const contract = validateVerifierContractDeclaration(deps.declaration);
  if (!contract.valid) return fail("C1", `verifier contract declaration invalid: ${contract.reason}`);
  if (deps.declaration.verifier_contract_id !== UI_RENDER_VERIFIER_CONTRACT_DECLARATION.verifier_contract_id || deps.declaration.contract_version !== UI_RENDER_VERIFIER_CONTRACT_DECLARATION.contract_version || deps.declaration.semantic_digest !== UI_RENDER_VERIFIER_CONTRACT_DECLARATION.semantic_digest) return fail("C1", "verifier contract identity is not the locked UI_RENDER C1 declaration");
  if (deps.declaration.decision_class !== "UI_RENDER" || deps.declaration.proposition_kind !== "REQUIRED_RENDERED_ELEMENTS_PRESENT_FOR_CHANGE") return fail("C1", "verifier contract proposition/class mismatch");

  const bindingResolution = deps.binding ? resolveVerificationAuthorityBinding({ decision_class: "UI_RENDER", proposition_kind: "REQUIRED_RENDERED_ELEMENTS_PRESENT_FOR_CHANGE", binding_version: "1.0.0" }) : null;
  if (!bindingResolution || bindingResolution.status !== "RESOLVED" || !bindingResolution.binding) return fail("B1", "exact UI_RENDER authority binding is unresolved or corrupt");
  const suppliedBindingValidation = deps.binding ? validateBindingIdentity(deps.binding) : null;
  if (!suppliedBindingValidation || suppliedBindingValidation.status !== "RESOLVED" || !validateUiRenderAuthorityBinding(deps.binding!).binding) return fail("B1", "supplied authority binding is corrupt or does not match UI_RENDER");
  if (bindingResolution.binding.binding_id !== deps.binding!.binding_id || deps.binding!.binding_id !== UI_RENDER_VERIFICATION_AUTHORITY_BINDING_V1.binding_id || deps.binding!.authority_id !== UI_RENDER_AUTHORITY_ID) return fail("B1", "authority binding override does not match the locked B1 identity");
  if (deps.binding!.verifier_contract_identity.semantic_digest !== deps.declaration.semantic_digest) return fail("B1", "authority binding does not point to the validated C1 declaration");

  const boundary = validateTrustedEmissionBoundaryDeclaration(deps.boundary);
  if (!boundary.valid) return fail("T1", `trusted emission boundary invalid: ${boundary.reason}`);
  if (deps.boundary.boundary_id !== UI_RENDER_TRUSTED_EMISSION_BOUNDARY_DECLARATION.boundary_id || deps.boundary.boundary_version !== UI_RENDER_TRUSTED_EMISSION_BOUNDARY_DECLARATION.boundary_version || deps.boundary.semantic_digest !== UI_RENDER_TRUSTED_EMISSION_BOUNDARY_DECLARATION.semantic_digest) return fail("T1", "trusted emission boundary is not the locked T1 identity");
  if (JSON.stringify(deps.boundary.composition_semantics.ordered_stages) !== JSON.stringify(EXPECTED_BOUNDARY_STAGES)) return fail("T1", "trusted emission boundary stage order mismatch");
  if (!deps.boundary.composition_semantics.forbidden_stages.includes("ACCEPT_VERIFICATION") || !deps.boundary.composition_semantics.forbidden_stages.includes("UPDATE_SYSTEM_TRUTH")) return fail("T1", "trusted emission boundary does not explicitly forbid acceptance/system-truth mutation");
  return null;
}

function isRenderEvidence(value: unknown): value is RenderEvidence {
  if (!isObject(value)) return false;
  return ["execution_id", "change_id", "route", "runtime_url", "source_digest", "data_source", "verdict", "reason"].every((field) => typeof value[field] === "string" && value[field].length > 0)
    && Array.isArray(value.resource_id) && Array.isArray(value.capability_id) && Array.isArray(value.expected_elements) && Array.isArray(value.found_elements) && Array.isArray(value.missing_elements)
    && typeof value.screenshot_path === "string" && typeof value.evidence_reference === "string";
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

function compose(input: UiRenderTrustedAdapterInput, deps: AdapterDependencies): TrustedUiRenderAdapterOutcome {
  if (!isObject(input)) return fail("INPUT", "domain input must be an object");
  const forbidden = hasCallerSuppliedTrustedFields(input);
  if (forbidden) return fail("INPUT", `caller cannot supply trusted field: ${forbidden}`);
  const compositionFailure = validateComposition(deps);
  if (compositionFailure) return compositionFailure;

  let result: RenderEvidence;
  try {
    result = deps.verifier({ ...input, capability_id: [UI_RENDER_AUTHORITY_ID] });
  } catch (error) {
    return fail("R1", `real UI_RENDER verifier failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRenderEvidence(result)) return fail("R1", "verifier did not return an exact RenderEvidence result");
  const evidenceRefs = [result.evidence_reference, result.screenshot_path].filter((ref, index, refs) => ref.length > 0 && refs.indexOf(ref) === index);
  if (evidenceRefs.length === 0) return fail("D1", "required evidence_refs cannot be derived from R1");
  if (!result.observed_at) return fail("D1", "freshness cannot be derived from R1: observed_at is missing");

  const decisionInput = {
    decision_class: "UI_RENDER",
    subject: { execution_id: result.execution_id, change_id: result.change_id, resource_id: result.resource_id, route: result.route },
    scope: { runtime_url: result.runtime_url, data_source: result.data_source, source_digest: result.source_digest },
    proposition: { kind: "REQUIRED_RENDERED_ELEMENTS_PRESENT_FOR_CHANGE", expected_elements: result.expected_elements },
    verdict: result.verdict,
    evidence_refs: evidenceRefs,
    freshness: { status: "NOT_ESTABLISHED", observed_at: result.observed_at, reason: "UI_RENDER R1 provides observation time only; post-change freshness is owned by the existing runtime freshness gate" },
    authority: { authority_identity_type: "REGISTERED_CAPABILITY", authority_id: UI_RENDER_AUTHORITY_ID, authority_binding_id: UI_RENDER_VERIFICATION_AUTHORITY_BINDING_V1.binding_id, binding_version: UI_RENDER_VERIFICATION_AUTHORITY_BINDING_V1.binding_version, verifier_contract_identity: UI_RENDER_VERIFIER_CONTRACT_DECLARATION.verifier_contract_id },
  } as const;
  const decision = freezeVerificationDecision(createVerificationDecision(decisionInput));
  const decisionValidation = validateVerificationDecision(decision);
  if (!decisionValidation.valid) return fail("D1", `constructed decision invalid: ${decisionValidation.reason}`);
  const provenance = freezeVerificationProducerProvenance({
    producer_identity: UI_RENDER_AUTHORITY_ID,
    authority_binding_id: UI_RENDER_VERIFICATION_AUTHORITY_BINDING_V1.binding_id,
    binding_version: UI_RENDER_VERIFICATION_AUTHORITY_BINDING_V1.binding_version,
    verifier_contract_identity: UI_RENDER_VERIFICATION_AUTHORITY_BINDING_V1.verifier_contract_identity,
    verifier_result_fingerprint: computeVerifierResultFingerprint(result as never),
    decision_fingerprint: decision.decision_fingerprint,
    emission_boundary_identity: { boundary_id: UI_RENDER_TRUSTED_EMISSION_BOUNDARY_DECLARATION.boundary_id, boundary_version: UI_RENDER_TRUSTED_EMISSION_BOUNDARY_DECLARATION.boundary_version, semantic_digest: UI_RENDER_TRUSTED_EMISSION_BOUNDARY_DECLARATION.semantic_digest },
  });
  const provenanceValidation = validateVerificationProducerProvenance(provenance);
  if (!provenanceValidation.valid) return fail("P1", `constructed provenance invalid: ${provenanceValidation.reason}`);
  return { status: "RESOLVED", package: deepFreeze({ verifier_result: result, verification_decision: decision, producer_provenance: provenance }) };
}

export function runUiRenderTrustedVerification(input: UiRenderTrustedAdapterInput): TrustedUiRenderAdapterOutcome {
  return compose(input, { verifier: verifyRender, declaration: UI_RENDER_VERIFIER_CONTRACT_DECLARATION, binding: UI_RENDER_VERIFICATION_AUTHORITY_BINDING_V1, boundary: UI_RENDER_TRUSTED_EMISSION_BOUNDARY_DECLARATION });
}

/** Test seam only; deliberately not exported by the public UI_RENDER contract. */
export function runUiRenderTrustedVerificationForTest(input: UiRenderTrustedAdapterInput, overrides: Partial<AdapterDependencies>): TrustedUiRenderAdapterOutcome {
  return compose(input, { verifier: overrides.verifier ?? verifyRender, declaration: overrides.declaration ?? UI_RENDER_VERIFIER_CONTRACT_DECLARATION, binding: overrides.binding === undefined ? UI_RENDER_VERIFICATION_AUTHORITY_BINDING_V1 : overrides.binding, boundary: overrides.boundary ?? UI_RENDER_TRUSTED_EMISSION_BOUNDARY_DECLARATION });
}
