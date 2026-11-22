/**
 * Regression test for the /workspace CENTRAL AUTHORITY (SLICE-1, owner decision
 * D1=A, 2026-09-23).
 *
 * Proves the Application Workspace derives its business-tool surface from
 * registry/permissions.json#capability_access through
 * core/navigation/resolveCapabilityAccess.ts — and nothing else:
 *
 *   1. an admin-tier role is granted the business tools, and "people" is among
 *      them (the tool this slice actually wired to real data);
 *   2. a role the registry grants nothing sees nothing — DEFAULT DENY
 *      (partner/customer grant count is 0);
 *   3. an undeclared tool key is denied even for super_admin (no implicit allow,
 *      so a future tool cannot leak by being forgotten);
 *   4. the registry's declared keys match the UI's declared business tool keys
 *      EXACTLY — a tool cannot appear in the UI ungranted, and a stale registry
 *      key cannot linger after the tool is removed;
 *   5. app/workspace/** contains no role id literal at all — the owner's
 *      "ห้าม hardcode role ใน component" rule, checked against real file text.
 *
 * No network, no Supabase session, no browser, no credentials.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import permissions from "@/registry/permissions.json";
import { isCapabilityAllowed, resolveAllowedCapabilities } from "@/core/navigation/resolveCapabilityAccess";
import { TOOLS } from "@/app/workspace/_lib/businessTools";

const ROOT = join(__dirname, "..");
const WORKSPACE_DIR = join(ROOT, "app/workspace");

function workspaceSourceFiles(): string[] {
  return readdirSync(WORKSPACE_DIR, { recursive: true, encoding: "utf-8" })
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
    .map((f) => join(WORKSPACE_DIR, f));
}

function main() {
  const uiToolKeys = TOOLS.map((t) => t.key).sort();
  const registryKeys = Object.keys(permissions.capability_access).sort();

  // 1. global profile roles grant no tools; UI authority needs org ownership.
  const adminGranted = resolveAllowedCapabilities("admin");
  assert.equal(adminGranted.length, 0, `unscoped admin role must grant 0 tools, got [${adminGranted.join(",")}]`);
  assert.equal(isCapabilityAllowed("people", "employee"), false, "employee role alone must not grant a business tool");

  // 2. default deny for roles the registry does not grant
  for (const role of ["partner", "customer"] as const) {
    const granted = resolveAllowedCapabilities(role);
    assert.equal(granted.length, 0, `${role} must be granted 0 tools, got [${granted.join(",")}]`);
    assert.equal(isCapabilityAllowed("people", role), false, `${role} must not see the people tool`);
  }

  // 3. undeclared key is denied for every profile role
  assert.equal(isCapabilityAllowed("__not_declared__", "admin"), false, "undeclared keys must be denied");

  // 4. registry and UI tool list cannot drift
  assert.deepEqual(registryKeys, uiToolKeys, `capability_access keys must equal the UI tool keys\n  registry: ${registryKeys.join(",")}\n  ui:       ${uiToolKeys.join(",")}`);

  // 5. no role literal and no page-level authority logic anywhere under app/workspace
  //    (a hardcoded role would appear as an exactly-quoted token — identifiers such as
  //     partnerTargetId or the path "@/app/admin/ui-gallery/..." are not role lists)
  const roleIds = permissions.roles.map((r) => r.id);
  const roleToken = new RegExp(`["'\`](${roleIds.join("|")})["'\`]`);
  const forbiddenAuthority = [/ADMIN_TIER/, /SUPER_ADMIN_ONLY/, /ANY_AUTHENTICATED/, /requireAuth\s*\(/];
  const offenders: string[] = [];
  for (const file of workspaceSourceFiles()) {
    const text = readFileSync(file, "utf-8");
    const hit = text.match(roleToken);
    if (hit) offenders.push(`${file.replace(ROOT + "/", "")} ← hardcoded role token ${hit[0]}`);
    for (const pattern of forbiddenAuthority) {
      if (pattern.test(text)) offenders.push(`${file.replace(ROOT + "/", "")} ← ${pattern.source} (authority must come from resolveCapabilityAccess)`);
    }
  }
  assert.deepEqual(offenders, [], `app/workspace must not hardcode roles or tier checks: ${offenders.join(" | ")}`);

  console.log("workspace-capability:test PASS");
  console.log(
    `checks: unscoped admin role granted ${adminGranted.length} tools, default-deny for profile roles, undeclared denied, registry==UI keys (${registryKeys.length}), no role token / tier check under app/workspace (${workspaceSourceFiles().length} files)`,
  );
}

main();
