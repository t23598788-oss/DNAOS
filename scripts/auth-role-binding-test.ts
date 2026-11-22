/** DNA OS MODULE: Regression checks that elevated roles require an exact Auth user to profile ID match. */
import assert from "node:assert/strict";
import permissions from "../registry/permissions.json";
import { effectiveSessionRole } from "../core/auth/role-binding";

const adminTier = permissions.role_tiers.admin_tier;

for (const role of adminTier) {
  assert.equal(effectiveSessionRole({ role, resolvedBy: "id" }), role);
}

for (const role of ["super_admin", "admin", "employee"] as const) {
  assert.equal(effectiveSessionRole({ role, resolvedBy: "email" }), "customer");
}

assert.equal(effectiveSessionRole({ role: "partner", resolvedBy: "id" }), "partner");
assert.equal(effectiveSessionRole(null), null);
console.log("PASS: only an exact auth.users.id → profiles.id match carries role privileges");
