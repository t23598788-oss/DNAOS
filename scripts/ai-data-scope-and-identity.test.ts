/**
 * AI DATA SCOPE + VERIFIED IDENTITY TEST (STEP 1/2/4/5, 2026-10-25).
 *
 * Offline. Proves:
 *   A  scope resolution is fail-closed (role vs organization vs none)
 *   B  two organizations never see each other's companies; NULL-org rows are
 *      platform-only
 *   C  the dispatcher DENIES tenant reads when no verified scope is present
 *   D  discovery / price publication / transaction / internal read are four
 *      separate rights — none implies another
 *   E  the LINE identity match no longer falls back to a display name
 *   F  every AI read entry point attaches a verified scope
 *
 * Run: npx tsx scripts/ai-data-scope-and-identity.test.ts [--strict]
 */
import { readFileSync } from "fs";
import {
  NO_DATA_SCOPE,
  isTenantScopedRead,
  resolveDataScope,
  scopeCoversOrganization,
  type DataScope,
} from "@/core/authority/data-scope";
import { dispatch } from "@/engines/validation/dispatcher";
import {
  resolveDiscoveryRight,
  resolveInternalReadRight,
  resolvePricePublicationRight,
  resolveTransactionRight,
  type RightActor,
  type RightResource,
} from "@/core/authority/rights";

let checks = 0;
let failed = 0;
const pass = (m: string) => {
  checks += 1;
  console.log(`PASS  ${m}`);
};
const fail = (m: string, d?: string) => {
  checks += 1;
  failed += 1;
  console.log(`FAIL  ${m}${d ? `\n        ↳ ${d}` : ""}`);
};
const expect = (cond: boolean, m: string, d?: string) => (cond ? pass(m) : fail(m, d));
const read = (p: string) => readFileSync(p, "utf8");

const ORG_A = "org-a";
const ORG_B = "org-b";

async function main() {
/* ------------------------------------------------------------------ */
console.log("=== A — scope resolution is fail-closed ===");
{
  const legacyPlatformRole = resolveDataScope({ profileId: "p-owner", role: "legacy_platform_role", organizationIds: [] });
  expect(legacyPlatformRole.mode === "none", "A legacy global role without membership receives no scope");

  const orgA = resolveDataScope({ profileId: "p-a", role: "admin", organizationIds: [ORG_A] });
  expect(orgA.mode === "organization" && orgA.organizationIds.includes(ORG_A), "A org member resolves to that organization");

  const noOrg = resolveDataScope({ profileId: "p-admin", role: "admin", organizationIds: [] });
  expect(noOrg.mode === "none", "A admin without membership resolves to none (deny)");

  const noActor = resolveDataScope({ profileId: null, role: "admin", organizationIds: [ORG_A] });
  expect(noActor.mode === "none", "A missing profile resolves to none");

  const unknownRole = resolveDataScope({ profileId: "p-x", role: null, organizationIds: [ORG_A] });
  expect(unknownRole.mode === "organization", "A known membership still scopes an unknown role to its org (never platform)");

  expect(!scopeCoversOrganization(NO_DATA_SCOPE, ORG_A), "A none never covers an organization");
  expect(!scopeCoversOrganization(null, ORG_A), "A missing scope covers nothing");
}

/* ------------------------------------------------------------------ */
console.log("\n=== B — two organizations are isolated; NULL is denied ===");
{
  const scopeA: DataScope = resolveDataScope({ profileId: "p-a", role: "admin", organizationIds: [ORG_A] });
  const scopeB: DataScope = resolveDataScope({ profileId: "p-b", role: "admin", organizationIds: [ORG_B] });

  const companyA = { id: "c-a", organizationId: ORG_A };
  const companyB = { id: "c-b", organizationId: ORG_B };
  const unowned = { id: "c-null", organizationId: null };

  expect(scopeCoversOrganization(scopeA, companyA.organizationId), "B org A sees its own company");
  expect(!scopeCoversOrganization(scopeA, companyB.organizationId), "B org A cannot see org B's company");
  expect(!scopeCoversOrganization(scopeB, companyA.organizationId), "B org B cannot see org A's company");
  expect(!scopeCoversOrganization(scopeA, unowned.organizationId), "B NULL-org record is not implicitly claimed by org A");
  const noMembership = resolveDataScope({ profileId: "p-global", role: "admin", organizationIds: [] });
  expect(!scopeCoversOrganization(noMembership, companyA.organizationId), "B no membership cannot see org A");
  expect(!scopeCoversOrganization(noMembership, companyB.organizationId), "B no membership cannot see org B");
  expect(!scopeCoversOrganization(noMembership, unowned.organizationId), "B no business role sees unattributed records");
}

/* ------------------------------------------------------------------ */
console.log("\n=== C — dispatcher denies tenant reads without a verified scope ===");
{
  const reads = ["partner.list", "partner.find", "debt.list", "invoice.list", "document.list", "job.list"];
  expect(reads.every(isTenantScopedRead), "C directory/debt/document/job reads are classified as tenant-scoped");

  const noScope = await dispatch("partner.list", {}, false);
  expect(!noScope.ok && noScope.violations.join(" ").includes("DATA_SCOPE_REQUIRED"), "C partner.list without scope is DENIED", noScope.violations.join("; "));

  const none = await dispatch("debt.list", {}, false, NO_DATA_SCOPE);
  expect(!none.ok && none.violations.join(" ").includes("DATA_SCOPE_REQUIRED"), "C none scope is DENIED (never unfiltered)");

  const emptyOrg: DataScope = { mode: "organization", profileId: "p", role: "admin", organizationIds: [], reason: "TEST_EMPTY" };
  const empty = await dispatch("document.list", {}, false, emptyOrg);
  expect(!empty.ok && empty.violations.join(" ").includes("DATA_SCOPE_REQUIRED"), "C empty organization scope is DENIED");

  const unscoped = await dispatch("material.list", {}, false);
  expect(!unscoped.violations.join(" ").includes("DATA_SCOPE_REQUIRED"), "C central master-data read is not a tenant read");
}

/* ------------------------------------------------------------------ */
console.log("\n=== D — four rights stay separate ===");
{
  const legacyPlatformRole: RightActor = { profileId: "p-owner", role: "legacy_platform_role", organizationIds: [] };
  const orgA: RightActor = { profileId: "p-a", role: "admin", organizationIds: [ORG_A] };
  const owner: RightActor = { profileId: "owner-1", role: "partner", organizationIds: [] };
  const stranger: RightActor = { profileId: "p-z", role: "customer", organizationIds: [ORG_B] };

  const resource: RightResource = {
    kind: "material_price",
    id: "price-1",
    organizationId: ORG_A,
    ownerProfileId: "owner-1",
    ownerVerified: true,
    discoverable: false,
  };

  expect(!resolveInternalReadRight(legacyPlatformRole, resource).allowed, "D legacy global role cannot read internally");
  expect(resolveInternalReadRight(orgA, resource).allowed, "D org owner may read internally");
  expect(resolveInternalReadRight(owner, resource).allowed, "D resource owner may read internally");
  expect(!resolveInternalReadRight(stranger, resource).allowed, "D another org is denied internal read");

  expect(!resolveDiscoveryRight(legacyPlatformRole, resource).allowed, "D a role alone does not grant discovery");
  expect(!resolveDiscoveryRight(stranger, resource).allowed, "D undisclosed record is not discoverable");
  const disclosed = { ...resource, discoverable: true };
  const discovery = resolveDiscoveryRight(stranger, disclosed);
  expect(discovery.allowed && discovery.fields === "public", "D a disclosed record is discoverable with PUBLIC fields only");

  expect(resolvePricePublicationRight(owner, resource).allowed, "D price owner may publish their price");
  expect(resolvePricePublicationRight(orgA, resource).allowed, "D verified org owner may publish");
  expect(!resolvePricePublicationRight(legacyPlatformRole, resource).allowed, "D legacy role cannot publish another owner's price");
  expect(!resolvePricePublicationRight(legacyPlatformRole, { ...resource, ownerProfileId: null }).allowed, "D legacy role cannot publish an unattributed price row");

  expect(resolveTransactionRight(owner, resource).allowed, "D owner may transact");
  expect(resolveTransactionRight(orgA, resource).allowed, "D organization may transact");
  expect(!resolveTransactionRight(legacyPlatformRole, resource).allowed, "D legacy role cannot transact outside an organization");
  expect(!resolveTransactionRight(stranger, resource).allowed, "D another org cannot transact");

  expect(
    !resolveInternalReadRight(legacyPlatformRole, resource).allowed && !resolveTransactionRight(legacyPlatformRole, resource).allowed,
    "D legacy platform role receives no data authority",
  );
}

/* ------------------------------------------------------------------ */
console.log("\n=== E — LINE identity uses a verified relationship only ===");
{
  const qa = read("supabase/functions/line-webhook-v2/engines/relationship-qa.ts");
  expect(qa.includes("connect_external_identities"), "E debt Q&A reads the identity table");
  expect(qa.includes("trust_level") && qa.includes('"verified"'), "E only trust_level = verified is accepted");
  expect(!qa.includes('.eq("name", known.line_name)'), "E display-name fallback is removed from debt Q&A");

  const customerRoute = read("app/api/admin/line-customers/[lineUserId]/route.ts");
  expect(!customerRoute.includes('.eq("name", lineName)'), "E customer timeline has no name fallback");

  const buildEvent = read("app/api/admin/line-customers/[lineUserId]/build-event/route.ts");
  expect(!buildEvent.includes('.eq("name", lineName)'), "E event builder has no name fallback");

  const listRoute = read("app/api/admin/line-customers/route.ts");
  expect(!listRoute.includes('.in("name", names)'), "E contacts list has no name-matched company");
}

/* ------------------------------------------------------------------ */
console.log("\n=== F — every AI read entry point attaches a verified scope ===");
{
  const command = read("app/api/command/route.ts");
  expect(command.includes("requireAuth(ADMIN_TIER)"), "F /api/command requires the admin tier");
  expect(command.includes("runWithDataScope"), "F /api/command attaches a scope");
  expect(command.includes("resolveSessionDataScope"), "F /api/command resolves scope from the session");

  const chat = read("app/api/chat/route.ts");
  expect(chat.includes("runWithDataScope") && chat.includes("resolveSessionDataScope"), "F /api/chat attaches a scope");

  const v1 = read("app/api/v1/query/route.ts");
  expect(v1.includes("resolveTokenDataScope") && v1.includes("runWithDataScope"), "F /api/v1/query attaches the token's scope");
  expect(v1.includes("getApiTokenCallerProfile"), "F token scope comes from the current profile row, not the token alone");

  const capability = read("app/api/admin/capability-boxes/run/route.ts");
  expect(capability.includes("runWithDataScope"), "F capability-box Run attaches a scope");

  const dispatcher = read("engines/validation/dispatcher.ts");
  expect(dispatcher.includes("getPartners(scope)"), "F partner.find is organization-filtered");
  expect(dispatcher.includes("getOpenDebts(scope)"), "F debt.list is organization-filtered");
}

console.log("\n=== SUMMARY ===");
console.log(`checks=${checks} failed=${failed}`);
console.log(failed === 0 ? "GATE: PASS" : `GATE: FAIL (${failed})`);
if (process.argv.includes("--strict") && failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
