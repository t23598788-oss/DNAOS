/**
 * Active organization resolution tests (2026-10-20). Pure unit tests, no database.
 */
import { resolveActiveOrganization, ORGANIZATION_SELECTION_REQUIRED, TENANT_NO_MEMBERSHIP, TENANT_NOT_A_MEMBER } from "../core/auth/tenantScope";

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) { passed += 1; console.log(`  ok   ${name}`); }
  else { failures.push(name); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

const ORG_A = "aaaaaaaa-0000-0000-0000-000000000001";
const ORG_B = "bbbbbbbb-0000-0000-0000-000000000002";
const ORG_C = "cccccccc-0000-0000-0000-000000000003";

console.log("Active organization resolution");

// 1. Single organization: resolved without a selection.
{
  const d = resolveActiveOrganization({ memberships: [{ organizationId: ORG_A, role: "member" }], selectedOrganizationId: null });
  check("SO1 single organization resolves without selection", d.ok && d.organizationId === ORG_A && d.reason === "single_membership", JSON.stringify(d));
}

// 2. Multiple organizations, none selected: must ask, never guess.
{
  const d = resolveActiveOrganization({
    memberships: [{ organizationId: ORG_A, role: "owner" }, { organizationId: ORG_B, role: "member" }],
    selectedOrganizationId: null,
  });
  check("MO1 several organizations, none selected: ORGANIZATION_SELECTION_REQUIRED", !d.ok && d.code === ORGANIZATION_SELECTION_REQUIRED, JSON.stringify(d));
  check("MO1b no organization id is returned when selection is required", !("organizationId" in d));
}

// 3. Multiple organizations, one selected that the user belongs to.
{
  const d = resolveActiveOrganization({
    memberships: [{ organizationId: ORG_A, role: "owner" }, { organizationId: ORG_B, role: "member" }],
    selectedOrganizationId: ORG_B,
  });
  check("MO2 selected membership is honoured", d.ok && d.organizationId === ORG_B && d.role === "member" && d.reason === "selected", JSON.stringify(d));
}

// 4. Selected organization the user does NOT belong to (cross-tenant attempt).
{
  const d = resolveActiveOrganization({
    memberships: [{ organizationId: ORG_A, role: "owner" }],
    selectedOrganizationId: ORG_C,
  });
  check("NM1 non-member selection is refused (cross-tenant)", !d.ok && d.code === TENANT_NOT_A_MEMBER, JSON.stringify(d));
}

// 5. No memberships at all.
{
  const d = resolveActiveOrganization({ memberships: [], selectedOrganizationId: null });
  check("NM2 user with no organization is refused", !d.ok && d.code === TENANT_NO_MEMBERSHIP);
  const d2 = resolveActiveOrganization({ memberships: [], selectedOrganizationId: ORG_A });
  check("NM3 selection without any membership is refused", !d2.ok && d2.code === TENANT_NO_MEMBERSHIP);
}

// 6. Malformed organization ids are never a scope.
{
  const d = resolveActiveOrganization({ memberships: [{ organizationId: "not-a-uuid", role: "owner" }], selectedOrganizationId: null });
  check("MF1 malformed membership id is ignored (fail-closed)", !d.ok && d.code === TENANT_NO_MEMBERSHIP, JSON.stringify(d));
  const d2 = resolveActiveOrganization({ memberships: [{ organizationId: ORG_A, role: "owner" }], selectedOrganizationId: "'; DROP TABLE x;--" });
  check("MF2 malformed selection is refused as non-member", !d2.ok && d2.code === TENANT_NOT_A_MEMBER);
}

// 7. Duplicate rows for one organization collapse; the highest role wins.
{
  const d = resolveActiveOrganization({
    memberships: [{ organizationId: ORG_A, role: "member" }, { organizationId: ORG_A, role: "admin" }],
    selectedOrganizationId: null,
  });
  check("DU1 duplicate rows collapse to one organization with the highest role", d.ok && d.organizationId === ORG_A && d.role === "admin", JSON.stringify(d));
}

// 8. Tampering: a selection cannot widen access beyond memberships (order and extra ids do not matter).
{
  const d = resolveActiveOrganization({
    memberships: [{ organizationId: ORG_B, role: "member" }],
    selectedOrganizationId: ORG_A,
  });
  check("TM1 a selected id outside memberships never resolves", !d.ok, JSON.stringify(d));
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log("FAILED:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
