import { runHermeticSourceProfile } from "../integration-verification-closure/contract";

export function runCoupledSourceVerification(cwd: string): {
  readonly FULL_COUPLED_SOURCE_VERIFICATION: boolean;
  readonly FULL_HERMETIC_SOURCE_VERIFICATION: boolean;
  readonly CIRCULAR_DEPENDENCY_CHECK: boolean;
  readonly results: readonly { readonly name: string; readonly passed: boolean; readonly detail: string }[];
} {
  const row = runHermeticSourceProfile(cwd);
  return {
    FULL_COUPLED_SOURCE_VERIFICATION: row.FULL_HERMETIC_SOURCE_VERIFICATION,
    FULL_HERMETIC_SOURCE_VERIFICATION: row.FULL_HERMETIC_SOURCE_VERIFICATION,
    CIRCULAR_DEPENDENCY_CHECK: row.CIRCULAR_DEPENDENCY_CHECK,
    results: row.results.map((item) => ({
      name: item.gate_id,
      passed: item.state === "PASS",
      detail: `${item.classification}:${item.state} ${item.detail}`,
    })),
  };
}
