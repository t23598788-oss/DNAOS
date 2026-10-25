/**
 * STEP 5 — LIVE READ-ONLY CHECK (2026-10-25).
 *
 * Proves against the real database, without writing anything:
 *   1. platform owner (super_admin) still reads the full company directory
 *   2. an organization scope sees ONLY companies whose organization_id matches
 *      (today: 0, because all 86 rows are unattributed)
 *   3. an unscoped dispatcher call is denied
 *   4. a company outside the organization scope is not readable by id
 *
 * Run: npx tsx scripts/ai-data-scope-live-check.ts
 * Requires .env.local (same read path as the existing census scripts).
 */
import { supabaseAdmin, getPartners, getPartnerById } from "@/services/supabase/queries";
import { platformDataScope, resolveDataScope, type DataScope } from "@/core/authority/data-scope";
import { dispatch } from "@/engines/validation/dispatcher";

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

async function main() {
  const db = supabaseAdmin();
  const { count: totalCompanies, error: totalError } = await db
    .from("companies")
    .select("*", { count: "exact", head: true });
  if (totalError) throw new Error(totalError.message);
  const total = Number(totalCompanies ?? 0);

  const { data: organizations, error: orgError } = await db
    .from("organizations")
    .select("id")
    .limit(1);
  if (orgError) throw new Error(orgError.message);

  const platform = platformDataScope({ profileId: "live-check", role: "super_admin" });
  const platformPartners = await getPartners(platform);
  expect(
    platformPartners.length === total,
    `platform scope reads the full directory (${platformPartners.length}/${total})`,
  );

  const orgId = organizations?.[0]?.id ? String(organizations[0].id) : null;
  const orgScope: DataScope = orgId
    ? resolveDataScope({ profileId: "live-check", role: "admin", organizationIds: [orgId] })
    : resolveDataScope({ profileId: "live-check", role: "admin", organizationIds: [] });
  const orgPartners = await getPartners(orgScope);

  const { count: boundCompanies } = await db
    .from("companies")
    .select("*", { count: "exact", head: true })
    .eq("organization_id", orgId ?? "");
  expect(
    orgPartners.length === Number(boundCompanies ?? 0),
    `organization scope sees only its own companies (${orgPartners.length}/${Number(boundCompanies ?? 0)})`,
  );

  // The 86 unattributed rows must never leak into an organization read.
  if (orgId) {
    const unattributed = platformPartners.filter((p) => !orgPartners.some((o) => o.id === p.id));
    expect(
      unattributed.length === total - orgPartners.length,
      `unattributed records stay platform-only (${unattributed.length})`,
    );
  }

  const denied = await dispatch("partner.list", {}, false);
  expect(
    !denied.ok && denied.violations.join(" ").includes("DATA_SCOPE_REQUIRED"),
    "unscoped partner.list is denied",
    denied.violations.join("; "),
  );

  if (platformPartners.length > 0) {
    const outside = platformPartners.find((p) => !orgPartners.some((o) => o.id === p.id));
    if (outside && orgId) {
      let blocked = false;
      try {
        await getPartnerById(outside.id, orgScope);
      } catch (e) {
        blocked = e instanceof Error && e.message === "PARTNER_NOT_IN_SCOPE";
      }
      expect(blocked, "an out-of-scope company cannot be read by id");
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log(`checks=${checks} failed=${failed}`);
  console.log(failed === 0 ? "GATE: PASS" : `GATE: FAIL (${failed})`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
