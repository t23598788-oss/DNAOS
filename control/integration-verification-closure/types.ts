export const INTEGRATION_VERIFICATION_CLOSURE = "INTEGRATION_VERIFICATION_CLOSURE_V1" as const;
export const HERMETIC_SOURCE_VERIFICATION_PROFILE = "HERMETIC_SOURCE_VERIFICATION_PROFILE_V1" as const;
export const VERIFICATION_GATE_CLASSIFICATION = "VERIFICATION_GATE_CLASSIFICATION_V1" as const;
export const SOURCE_ADMISSION_VERIFICATION_PROFILE = "SOURCE_ADMISSION_VERIFICATION_PROFILE_V1" as const;
export const DNA_OS_TEST_FIXTURE_CONTRACT = "DNA_OS_TEST_FIXTURE_CONTRACT_V1" as const;

export const GATE_CLASSES = [
  "SOURCE_REQUIRED",
  "HERMETIC_INTEGRATION_REQUIRED",
  "ENVIRONMENT_REQUIRED",
  "PROVIDER_REQUIRED",
  "PRODUCTION_REQUIRED",
] as const;
export type GateClass = typeof GATE_CLASSES[number];

export const GATE_STATES = ["PASS", "FAIL", "NOT_AVAILABLE", "AUTH_REQUIRED", "NOT_APPLICABLE"] as const;
export type GateState = typeof GATE_STATES[number];

export interface VerificationGateV1 {
  readonly gate_id: string;
  readonly command: readonly string[];
  readonly classification: GateClass;
  readonly required_for_source_admission: boolean;
}

export interface GateRunV1 {
  readonly gate_id: string;
  readonly classification: GateClass;
  readonly state: GateState;
  readonly detail: string;
}

export const NOT_AVAILABLE_EQUALS_PASS = false;
export const AUTH_REQUIRED_EQUALS_PASS = false;
