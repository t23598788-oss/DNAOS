export const DNA_OS_TEST_FIXTURE_CONTRACT = "DNA_OS_TEST_FIXTURE_CONTRACT_V1" as const;

export function isSourceSafeFixture(input: {
  readonly marked_fixture: boolean;
  readonly contains_secret: boolean;
  readonly production_revision: boolean;
  readonly runtime_jsonl: boolean;
}): boolean {
  return input.marked_fixture && !input.contains_secret && !input.production_revision && !input.runtime_jsonl;
}
