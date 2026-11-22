/**
 * ADMIN READ SCOPE TEST (STEP 1b, 2026-10-25) — offline only.
 *
 * The /api/admin/* control room reads companies, debts and documents. These
 * checks pin the two things that make that safe and that are easy to lose in a
 * later edit:
 *
 *   LOGIC  platform = unrestricted, organization = exact company set,
 *          none = deny; unattributed (NULL company) rows are platform-only.
 *   WIRING every route that reads those records actually calls the shared guard,
 *          and the whole-platform aggregates refuse organization scope instead
 *          of returning a partial number as if it were the company total.
 */
import { existsSync, readFileSync } from "fs";
import {
  denyUnscoped,
  filterRowsByCompany,
  isCompanyVisible,
  notFound,
  type AdminReadScope,
} from "@/app/api/admin/_lib/read-scope";
import { organizationDataScope, NO_DATA_SCOPE } from "@/core/authority/data-scope";

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

const org: AdminReadScope = {
  scope: organizationDataScope({ profileId: "profile-1", organizationIds: ["org-1"] }),
  companyIds: new Set(["company-1", "company-2"]),
};
const emptyOrg: AdminReadScope = {
  scope: organizationDataScope({ profileId: "profile-1", organizationIds: ["org-1"] }),
  companyIds: new Set(),
};
const none: AdminReadScope = { scope: NO_DATA_SCOPE, companyIds: new Set() };

console.log("=== A — visibility rules ===");
{
  expect(isCompanyVisible(org, "company-1") && !isCompanyVisible(org, "company-3"), "A organization scope sees exactly its own companies");
  expect(!isCompanyVisible(org, null), "A an organization scope never claims an unattributed (NULL) row");
  expect(!isCompanyVisible(emptyOrg, "company-1"), "A an organization with zero companies sees nothing");
  expect(!isCompanyVisible(none, "company-1"), "A no scope sees nothing");
}

console.log("=== B — row filtering ===");
{
  const rows = [
    { id: "a", company_id: "company-1" },
    { id: "b", company_id: "company-3" },
    { id: "c", company_id: null },
  ];
  const o = filterRowsByCompany(org, rows, (r) => r.company_id).map((r) => r.id);
  const e = filterRowsByCompany(emptyOrg, rows, (r) => r.company_id).map((r) => r.id);
  expect(o.join(",") === "a", "B organization keeps only in-scope rows, drops unattributed", o.join(","));
  expect(e.length === 0, "B empty organization keeps nothing");
  expect(rows.length === 3, "B the input array is not mutated");
}

console.log("=== C — denial responses ===");
{
  const d = denyUnscoped(none);
  expect(d !== null && d.status === 403, "C mode=organization/none without evidence is 403, not an empty-but-allowed list");
  expect(denyUnscoped(org) === null, "C a real organization scope is not denied");
  expect(notFound().status === 404, "C detail outside scope reads as not found, never as forbidden-with-existence");
}

console.log("=== D — route wiring (static) ===");
{
  const scopedDetail = [
    "app/api/admin/partners/[id]/chain/route.ts",
    "app/api/admin/partners/[id]/credit/route.ts",
    "app/api/admin/partners/[id]/timeline/route.ts",
    "app/api/admin/documents/[id]/route.ts",
    "app/api/admin/relationships/[relationshipId]/route.ts",
    "app/api/admin/transactions/[id]/route.ts",
    "app/api/admin/line-customers/[lineUserId]/route.ts",
    "app/api/admin/debt-trackings/[id]/route.ts",
    "app/api/admin/sites/route.ts",
  ];
  for (const file of scopedDetail) {
    const src = read(file);
    expect(src.includes("resolveAdminReadScope") && src.includes("notFound()"), `D ${file} refuses an out-of-scope id`);
  }

  const scopedList = [
    "app/api/admin/partners/route.ts",
    "app/api/admin/relationships/route.ts",
    "app/api/admin/documents/route.ts",
    "app/api/admin/transactions/route.ts",
    "app/api/admin/receipt-documents/route.ts",
    "app/api/admin/line-customers/route.ts",
    "app/api/admin/pulse/route.ts",
    "app/api/admin/debt-trackings/route.ts",
  ];
  for (const file of scopedList) {
    const src = read(file);
    expect(src.includes("resolveAdminReadScope") && src.includes("denyUnscoped"), `D ${file} scopes its list read`);
  }

  // Aggregates have no company dimension of their own — they must refuse a
  // scoped caller rather than present a partial figure as the company total.
  const financeSummary = read("app/api/admin/finance-summary/route.ts");
  expect(financeSummary.includes("status: 403"), "D global finance summary stays disabled until company owner mapping exists");
  expect(!existsSync("app/api/admin/backup/route.ts"), "D full platform backup route is removed");

  // The partner/relationship aggregates must pass the scope down to the query
  // layer, not fetch everything and filter nothing.
  expect(
    read("app/api/admin/partners/route.ts").includes("getDebtorPartners(ctx.scope)") &&
      read("app/api/admin/partners/route.ts").includes("getPartnersWithDocumentSummary(ctx.scope)"),
    "D partner aggregates receive the resolved scope",
  );
  expect(read("app/api/admin/relationships/route.ts").includes("getPartners(ctx.scope)"), "D relationships list queries with the scope");
}

console.log(`\n${checks - failed}/${checks} checks passed`);
if (failed > 0) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
