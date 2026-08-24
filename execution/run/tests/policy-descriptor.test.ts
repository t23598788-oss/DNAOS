/**
 * หน้าที่: the real test for `../policy-descriptor.ts` — proves the
 * `CommandPolicyDescriptor` projection is a real, deterministic function
 * of `../registry.ts`'s actual `COMMAND_REGISTRY`, not a hand-maintained
 * duplicate.
 *
 * How to run: npx tsx execution/run/tests/policy-descriptor.test.ts
 *
 * Input: none.
 * Output: PASS/FAIL lines and a non-zero exit code on any failure.
 * Dependency ที่อนุญาต: ../contract.ts.
 * สิ่งที่ห้ามแตะ: never hardcode an expected `CommandDescriptor` field
 * value here that isn't first read from `listCommandDescriptors()` itself
 * — this test's whole point is proving the projection tracks the real
 * registry, not proving a second copy of it matches by coincidence.
 */

import { getCommandDescriptor, listCommandDescriptors, listCommandPolicyDescriptors, projectCommandPolicyDescriptor, WORKSPACE_ROOT_CWD_SCOPE } from "../contract";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function check(name: string, body: () => void): void {
  try {
    body();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`);
  }
}

check("projecting a real registered command mirrors its real descriptor fields exactly", () => {
  const realDescriptors = listCommandDescriptors();
  assert(realDescriptors.length > 0, "expected at least one real registered command to test against");
  for (const real of realDescriptors) {
    const projected = projectCommandPolicyDescriptor(real.command_id);
    assert(projected !== undefined, `expected a policy descriptor to be projected for real command "${real.command_id}"`);
    assert(projected!.command_id === real.command_id, "expected command_id to match exactly");
    assert(projected!.required_capability === real.requiredCapability, `expected required_capability "${real.requiredCapability}", got "${projected!.required_capability}"`);
    assert(projected!.allowed_actions.length === 1 && projected!.allowed_actions[0] === real.requiredAction, `expected allowed_actions to be exactly ["${real.requiredAction}"], got ${JSON.stringify(projected!.allowed_actions)}`);
    assert(projected!.allowed_cwd_scope_prefixes.includes(WORKSPACE_ROOT_CWD_SCOPE), `expected allowed_cwd_scope_prefixes to include the real WORKSPACE_ROOT_CWD_SCOPE, got ${JSON.stringify(projected!.allowed_cwd_scope_prefixes)}`);
  }
});

check("projecting an unknown command_id fails closed (returns undefined, never a fabricated descriptor)", () => {
  const projected = projectCommandPolicyDescriptor("command.that.was.never.registered");
  assert(projected === undefined, `expected undefined for an unregistered command_id, got ${JSON.stringify(projected)}`);
});

check("listCommandPolicyDescriptors returns exactly one projected descriptor per real registered command", () => {
  const real = listCommandDescriptors();
  const projected = listCommandPolicyDescriptors();
  assert(projected.length === real.length, `expected ${real.length} projected descriptors, got ${projected.length}`);
  for (const real1 of real) {
    assert(projected.some((p) => p.command_id === real1.command_id), `expected a projected descriptor for real command "${real1.command_id}"`);
  }
});

check("the projection is a pure function of the real registry — same command_id, same result, every call", () => {
  const first = projectCommandPolicyDescriptor("workspace.pwd");
  const second = projectCommandPolicyDescriptor("workspace.pwd");
  assert(JSON.stringify(first) === JSON.stringify(second), "expected projecting the same command_id twice to produce identical results");
});

check("getCommandDescriptor and projectCommandPolicyDescriptor agree on which commands exist", () => {
  assert(getCommandDescriptor("workspace.pwd") !== undefined, "expected workspace.pwd to be a real registered command");
  assert(projectCommandPolicyDescriptor("workspace.pwd") !== undefined, "expected workspace.pwd to be projectable");
  assert(getCommandDescriptor("not.a.real.command") === undefined, "expected an unregistered command_id to be absent from the real registry");
  assert(projectCommandPolicyDescriptor("not.a.real.command") === undefined, "expected the same unregistered command_id to be unprojectable");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
