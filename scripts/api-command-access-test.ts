/**
 * api-command-access-test.ts — synthetic security tests for /api/v1/query and
 * /api/v1/spec command access. Pure logic only: no DB, no network, no real
 * tokens. Exit 1 on any FAIL.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decideCommandAccess, listAccessibleCommands, type CommandCaller } from "../core/auth/apiCommandAccess";
import commandRegistry from "../registry/command-registry.json";

const ROOT = process.cwd();
let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

const ANON: CommandCaller = { role: null, organizationVerified: false };
const ADMIN_SESSION: CommandCaller = { role: "admin", organizationVerified: true };
const ADMIN_TOKEN_READ: CommandCaller = { role: "admin", tokenScopes: ["read"], organizationVerified: true };
const ADMIN_TOKEN_NO_READ: CommandCaller = { role: "admin", tokenScopes: [], organizationVerified: true };
const PARTNER: CommandCaller = { role: "partner", organizationVerified: true };
const CUSTOMER: CommandCaller = { role: "customer", organizationVerified: true };
const ORG_A_ADMIN_NO_B: CommandCaller = { role: "admin", tokenScopes: ["read"], organizationVerified: false };
const TENANT_CMD = "debt.list";
const PUBLIC_CMD = "weather.forecast";
const INTERNAL_CMD = "material.list";

// 1. Anonymous DENY
const anon = decideCommandAccess(PUBLIC_CMD, ANON);
check("Anonymous DENY (public command)", !anon.allowed && anon.code === "AUTH_REQUIRED", anon.code);
check("Anonymous DENY (tenant command)", !decideCommandAccess(TENANT_CMD, ANON).allowed);

// 2. Invalid token DENY — an invalid/unknown token resolves to an anonymous caller in both routes.
check("Invalid token DENY (resolves to anonymous caller)", !decideCommandAccess(TENANT_CMD, ANON).allowed);

// 3. Read token cannot write
const writeAttempt = decideCommandAccess(TENANT_CMD, ADMIN_TOKEN_READ, { requiresConfirmation: true });
check("Read token cannot write (requires_confirmation)", !writeAttempt.allowed && writeAttempt.code === "WRITE_NOT_ALLOWED", writeAttempt.code);
const noReadScope = decideCommandAccess(TENANT_CMD, ADMIN_TOKEN_NO_READ);
check("Token without 'read' scope DENY", !noReadScope.allowed && noReadScope.code === "TOKEN_SCOPE_MISSING", noReadScope.code);
check("Token with 'read' scope ALLOW (admin, tenant, verified org)", decideCommandAccess(TENANT_CMD, ADMIN_TOKEN_READ).allowed);

// 4. Org A cannot read Org B private data
const crossOrg = decideCommandAccess(TENANT_CMD, ORG_A_ADMIN_NO_B);
check("Org A cannot read tenant data without verified scope", !crossOrg.allowed && crossOrg.code === "ORG_REQUIRED", crossOrg.code);
check("Org A cannot read internal data without verified scope", !decideCommandAccess(INTERNAL_CMD, ORG_A_ADMIN_NO_B).allowed);
check("Public command does not need org scope", decideCommandAccess(PUBLIC_CMD, { ...ORG_A_ADMIN_NO_B, role: "customer" }).allowed);

// 5. Non-admin cannot use admin tools
const partnerAdmin = decideCommandAccess(TENANT_CMD, PARTNER);
check("Partner DENY admin tool", !partnerAdmin.allowed && partnerAdmin.code === "ROLE_NOT_ALLOWED", partnerAdmin.code);
check("Customer DENY internal admin tool", !decideCommandAccess(INTERNAL_CMD, CUSTOMER).allowed);
check("Admin ALLOW admin tool", decideCommandAccess(INTERNAL_CMD, ADMIN_SESSION).allowed);
check("Customer ALLOW public command (any_authenticated)", decideCommandAccess(PUBLIC_CMD, CUSTOMER).allowed);

// 6. Unknown command DENY
const unknown = decideCommandAccess("does.not.exist", ADMIN_SESSION);
check("Unknown command DENY", !unknown.allowed && unknown.code === "UNKNOWN_COMMAND", unknown.code);
check("Prototype key DENY (constructor)", !decideCommandAccess("constructor", ADMIN_SESSION).allowed);

// 7. Missing permission DENY — registry command with no policy entry
const registeredNoPolicy = Object.keys(commandRegistry.commands).filter(
  (k) => !k.startsWith("_") && !decideCommandAccess(k, ADMIN_SESSION).allowed,
);
check(
  "Registry command without policy entry is DENIED (default DENY)",
  registeredNoPolicy.length > 0,
  `${registeredNoPolicy.length} registry commands denied for admin`,
);
const policyOnly = decideCommandAccess("business.calculate_tax", ADMIN_SESSION);
check("Policy entry present -> admin allowed", policyOnly.allowed);
check("Empty policy table DENY everything", !decideCommandAccess(PUBLIC_CMD, ADMIN_SESSION, {}, {}).allowed);

// 8. Revoked token DENY — revoked token -> validateApiToken null -> anonymous caller
check("Revoked token DENY (anonymous caller)", !decideCommandAccess(PUBLIC_CMD, ANON).allowed);

// 9. Spec/query consistency: listing and per-call decision agree for every candidate
const allNames = Object.keys(commandRegistry.commands).filter((k) => !k.startsWith("_"));
const callers: [string, CommandCaller][] = [
  ["anon", ANON], ["admin-session", ADMIN_SESSION], ["admin-token", ADMIN_TOKEN_READ],
  ["partner", PARTNER], ["customer", CUSTOMER], ["org-A-no-B", ORG_A_ADMIN_NO_B],
];
for (const [label, caller] of callers) {
  const listed = new Set(listAccessibleCommands(allNames, caller));
  const mismatches = allNames.filter((n) => listed.has(n) !== decideCommandAccess(n, caller).allowed);
  check(`spec list == query decision (${label})`, mismatches.length === 0, mismatches.slice(0, 3).join(","));
}
check("Anonymous spec lists zero commands", listAccessibleCommands(allNames, ANON).length === 0);

// 10. Wiring: both routes call the shared decision; query enforces before dispatch
const querySrc = readFileSync(join(ROOT, "app/api/v1/query/route.ts"), "utf8");
const specSrc = readFileSync(join(ROOT, "app/api/v1/spec/route.ts"), "utf8");
check("query imports shared decision", querySrc.includes("decideCommandAccess"));
check(
  "query enforces decision BEFORE dispatch",
  querySrc.indexOf("decideCommandAccess(") > 0 && querySrc.indexOf("decideCommandAccess(") < querySrc.indexOf("await dispatch("),
);
check("spec filters with shared decision", specSrc.includes("decideCommandAccess(key, caller)"));

console.log(`\n${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exit(1);
