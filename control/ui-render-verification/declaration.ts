import {
  computeSemanticDigest,
  VERIFIER_CONTRACT_DECLARATION_SCHEMA_VERSION,
  type VerifierContractDeclarationV1,
} from "../../contracts/verification/verifier-contract-declaration";

const UI_RENDER_PROPOSITION_SCHEMA = {
  required_input_fields: [
    "execution_id", "change_id", "resource_id", "route", "runtime_url",
    "source_paths", "data_source", "expected_elements", "previously_required",
  ],
  element_assertion: "plain string means DOM containment; tag:text means text inside matching tag",
  success_predicate: "every expected element is present and every previously required element remains present",
} as const;

const UI_RENDER_VERDICT_SEMANTICS = {
  VERIFIED: "real route answered, real browser produced screenshot and DOM, all expected elements present, no regression",
  FAILED: "real route and browser evidence exist, but an expected or previously required element is missing",
  UNPROVEN: "route/browser/screenshot/DOM evidence could not be produced; not equivalent to FAILED",
} as const;

const UI_RENDER_REQUIRED_EVIDENCE = {
  components: [
    "runtime_url_responded",
    "real_browser_screenshot",
    "same_browser_run_dom",
    "render_evidence_lineage",
  ].sort(),
  lineage_fields: ["execution_id", "change_id", "resource_id", "route", "source_digest", "data_source"].sort(),
  screenshot_required_for_verified: true,
  fixture_or_mock_accepted: false,
} as const;

const UI_RENDER_DECLARATION_BASE = {
  schema_version: VERIFIER_CONTRACT_DECLARATION_SCHEMA_VERSION,
  verifier_contract_id: "dna-os/ui-render-verification/required-rendered-elements",
  contract_version: "1.0.0",
  decision_class: "UI_RENDER",
  proposition_kind: "REQUIRED_RENDERED_ELEMENTS_PRESENT_FOR_CHANGE",
  proposition_schema_or_parameters: UI_RENDER_PROPOSITION_SCHEMA,
  input_contract_identity: "dna-os/ui-render-verification/RenderVerificationRequest@1",
  output_contract_identity: "dna-os/ui-render-verification/RenderEvidence@1",
  verdict_semantics: UI_RENDER_VERDICT_SEMANTICS,
  required_evidence_identity: UI_RENDER_REQUIRED_EVIDENCE,
} as const;

export const UI_RENDER_VERIFIER_CONTRACT_DECLARATION: VerifierContractDeclarationV1 = {
  ...UI_RENDER_DECLARATION_BASE,
  semantic_digest: computeSemanticDigest(UI_RENDER_DECLARATION_BASE),
};

export const UI_RENDER_CONTRACT_CAN_SELF_AUTHORIZE = false as const;
