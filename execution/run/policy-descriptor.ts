/**
 * หน้าที่: the real `CommandPolicyDescriptor` source — a deterministic
 * PROJECTION of `./registry.ts`'s real `COMMAND_REGISTRY` (the single
 * allowlist source of truth for what may ever be spawned) into the
 * shape `permissions/execution-policy/` needs to evaluate a permission
 * request. This is the "home" `../../permissions/execution-policy/
 * types.ts`'s own header already pointed at: "once
 * `../../execution/run/registry.ts` exists, its caller is expected to
 * project a `CommandPolicyDescriptor` from the real allowlist entry,
 * never the reverse."
 *
 * NOT a second registry, NOT a JSON fixture, NOT a duplicate hand-written
 * list — every field here is read live from `COMMAND_REGISTRY`. A command
 * added to/removed from `./registry.ts` is immediately reflected here
 * with no second place to update, closing the duplication risk flagged
 * in `../../reports/OLD_CONTROL_PLANE_DEEP_AUDIT.md` and
 * `../../reports/EXECUTION_MIGRATION_PLAN.md`.
 *
 * Input: a `command_id`.
 * Output: `projectCommandPolicyDescriptor`, `listCommandPolicyDescriptors`.
 * Dependency ที่อนุญาต: ./registry.ts,
 * ../../permissions/execution-policy/contract.ts (type only — this file
 * never calls anything in that module, only borrows its type so the
 * shape this file builds is verifiably the same one
 * `evaluateExecutionPermission()` consumes).
 * สิ่งที่ห้ามแตะ: never hand-write a `CommandPolicyDescriptor` literal
 * anywhere in this repo outside a test fixture — every real one must
 * come from this file. Never let this projection silently succeed for a
 * `command_id` `./registry.ts` doesn't know — `undefined` on lookup miss
 * is the correct, fail-closed answer (the caller's own `command_known`
 * rule in `../../permissions/execution-policy/rules.ts` then denies).
 *
 * NOT_YET_BUILT: no runtime caller yet — see
 * ./tests/policy-descriptor.test.ts and ./tests/policy-integration.test.ts
 * for the only current callers, which drive this module directly by hand.
 */

import { getCommandDescriptor, listCommandDescriptors, WORKSPACE_ROOT_CWD_SCOPE } from "./registry";

import type { CommandPolicyDescriptor } from "../../permissions/execution-policy/contract";

export function projectCommandPolicyDescriptor(commandId: string): CommandPolicyDescriptor | undefined {
  const descriptor = getCommandDescriptor(commandId);
  if (!descriptor) return undefined;
  return {
    command_id: descriptor.command_id,
    required_capability: descriptor.requiredCapability,
    allowed_actions: [descriptor.requiredAction],
    allowed_cwd_scope_prefixes: [WORKSPACE_ROOT_CWD_SCOPE],
  };
}

export function listCommandPolicyDescriptors(): readonly CommandPolicyDescriptor[] {
  return listCommandDescriptors()
    .map((descriptor) => projectCommandPolicyDescriptor(descriptor.command_id))
    .filter((descriptor): descriptor is CommandPolicyDescriptor => descriptor !== undefined);
}
