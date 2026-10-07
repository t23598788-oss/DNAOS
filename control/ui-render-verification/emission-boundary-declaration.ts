import {
  computeBoundarySemanticDigest,
  TRUSTED_EMISSION_BOUNDARY_DECLARATION_SCHEMA_VERSION,
  type TrustedEmissionBoundaryDeclarationV1,
} from "../../contracts/verification/trusted-emission-boundary";

const UI_RENDER_BOUNDARY_BASE = {
  schema_version: TRUSTED_EMISSION_BOUNDARY_DECLARATION_SCHEMA_VERSION,
  boundary_id: "dna-os/ui-render-verification/trusted-emission-boundary",
  boundary_version: "1.0.0",
  composition_semantics: {
    ordered_stages: [
      "RECEIVE_EXACT_VERIFIER_RESULT",
      "FINGERPRINT_VERIFIER_RESULT",
      "CONSTRUCT_VERIFICATION_DECISION",
      "FINGERPRINT_VERIFICATION_DECISION",
      "CONSTRUCT_PRODUCER_PROVENANCE",
      "RETURN_IMMUTABLE_TRUSTED_PACKAGE",
    ],
    forbidden_stages: [
      "ACCEPT_VERIFICATION",
      "UPDATE_SYSTEM_TRUTH",
    ],
  },
  input_contract_identity: "dna-os/verification/trusted-verifier-result@1",
  output_contract_identity: "dna-os/verification/trusted-decision-provenance-package@1",
} as const;

export const UI_RENDER_TRUSTED_EMISSION_BOUNDARY_DECLARATION: TrustedEmissionBoundaryDeclarationV1 = {
  ...UI_RENDER_BOUNDARY_BASE,
  semantic_digest: computeBoundarySemanticDigest(UI_RENDER_BOUNDARY_BASE),
};

export const UI_RENDER_DECLARATION_ALONE_GRANTS_RUNTIME_TRUST = false as const;
