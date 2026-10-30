// M015 scope-probe (T1–T4) — pure module probes of core/authority/data-scope.ts
// No DB writes, no HTTP, no engine calls: only the authority layer that routes
// "who may read/write which tenant's data". This IS the existing boundary code.
import {
  organizationDataScope,
  NO_DATA_SCOPE,
  platformDataScope,
  scopeCanReadTenantData,
  scopeCoversOrganization,
  isTenantScopedRead,
} from "@/core/authority/data-scope";

function out(tag: string, payload: Record<string, unknown>) {
  console.log("M015_SCOPE " + JSON.stringify({ tag, ...payload }));
}

const ORG_A = "c1000000-0000-4000-8000-000000000001"; // RPC Co A
const ORG_B = "c1000000-0000-4000-8000-000000000002"; // RPC Co B
const INV_A = "eead9672-2cb4-46bf-9b4b-f589a451e908"; // M015-INV-A-001 (tenant A resource)

// T1 — A (member of org A) is a tenant-scoped reader and covers only org A.
const scopeA = organizationDataScope({ profileId: "11111111-1111-4000-8000-00000000000a", organizationIds: [ORG_A] });
out("T1_A_scope", {
  mode: scopeA.mode,
  canReadTenant: scopeCanReadTenantData(scopeA),
  coversOrgA: scopeCoversOrganization(scopeA, ORG_A),
  coversOrgB: scopeCoversOrganization(scopeA, ORG_B),
  coversResourceA: scopeCoversOrganization(scopeA, ORG_A),
});

// T2 — B (member of org B) cannot cover org A's resource.
const scopeB = organizationDataScope({ profileId: "11111111-1111-4000-8000-00000000000b", organizationIds: [ORG_B] });
out("T2_B_vs_A", {
  coversOrgA: scopeCoversOrganization(scopeB, ORG_A),
  coversOrgB: scopeCoversOrganization(scopeB, ORG_B),
  readA_allowed: scopeCoversOrganization(scopeB, ORG_A) && scopeCoversOrganization(scopeB, ORG_A),
});

// T3 — no verified actor ⇒ NO scope ⇒ tenant reads denied (never default-allow).
out("T3_no_scope", {
  scope: NO_DATA_SCOPE.mode,
  reason: NO_DATA_SCOPE.reason,
  canReadTenant: scopeCanReadTenantData(NO_DATA_SCOPE),
  invoiceListDenied: isTenantScopedRead("invoice.list") && !scopeCanReadTenantData(NO_DATA_SCOPE),
});

// T3b — resolveDataScope defaults: missing membership ⇒ deny.
const denied = (() => {
  const s = organizationDataScope({ profileId: "11111111-1111-4000-8000-00000000000c", organizationIds: [] });
  return s;
})();
out("T3b_empty_membership", { mode: denied.mode, reason: (denied as { reason?: string }).reason });

// T4 — platform scope (service-role backend path) covers both orgs BY DESIGN,
// and tenant-scoped commands are the ones that get filtered.
out("T4_platform", {
  coversOrgA: scopeCoversOrganization(platformDataScope(), ORG_A),
  coversOrgB: scopeCoversOrganization(platformDataScope(), ORG_B),
  invoiceListIsTenantScoped: isTenantScopedRead("invoice.list"),
  calculateTaxIsNotTenantScoped: !isTenantScopedRead("business.calculate_tax"),
});

console.log("M015_SCOPE_DONE");
