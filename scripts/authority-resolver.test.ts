/**
 * AUTHORITY RESOLVER TEST (WAVE 2) — offline, pure, no DB.
 *
 * Proves the rule the owner asked for:
 *   Actor → Organization → Resource → Granted Scope → Allowed Action
 * with fail-closed behaviour and these explicit prohibitions:
 *   · ADMIN_TIER / super_admin alone is NOT authority over someone else's resource
 *   · first-link / display-name / company-name matching is structurally impossible
 *   · expired / revoked / cross-organization grants are refused
 *   · missing data = deny (never "allow because unknown")
 */
import { readFileSync } from "fs";
import { resolveAuthority, authorityEvidence, type ScopeGrant } from "@/core/authority/resolve";

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

const owner = { profileId: "profile-owner" };
const other = { profileId: "profile-other" };
const admin = { profileId: "profile-admin", role: "admin" };
const pit = { kind: "pit" as const, id: "pit-1", ownerProfileId: "profile-owner" };

const grant = (over: Partial<ScopeGrant> = {}): ScopeGrant => ({
  id: "grant-1",
  subjectProfileId: "profile-other",
  resourceKind: "pit",
  resourceId: "pit-1",
  actions: ["price.write"],
  validFrom: "2026-01-01T00:00:00.000Z",
  validTo: "2026-12-31T23:59:59.000Z",
  revokedAt: null,
  ...over,
});

const AT = "2026-10-25T00:00:00.000Z";

console.log("=== A — owner path ===");
{
  const d = resolveAuthority({ actor: owner, action: "price.write", resource: pit, at: AT });
  expect(d.allowed && d.via === "owner", "A owner may change their own pit price");
  const d2 = resolveAuthority({ actor: other, action: "price.write", resource: pit, at: AT });
  expect(!d2.allowed, "A a non-owner without a grant is denied", d2.reason);
}

console.log("\n=== B — role is never authority (R1) ===");
{
  const d = resolveAuthority({ actor: admin, action: "price.write", resource: pit, at: AT });
  expect(!d.allowed && d.reason === "ROLE_IS_NOT_AUTHORITY", "B admin without grant/ownership is denied", d.reason);
  const d2 = resolveAuthority({ actor: admin, action: "price.write", resource: { ...pit, ownerProfileId: null }, at: AT });
  expect(!d2.allowed, "B unknown owner + admin = deny (fail-closed)", d2.reason);
}

console.log("\n=== C — delegation scope ===");
{
  const d = resolveAuthority({ actor: other, action: "price.write", resource: pit, grants: [grant()], at: AT });
  expect(d.allowed && d.via === "grant" && d.grantId === "grant-1", "C valid grant allows the action");
  const wrongAction = resolveAuthority({ actor: other, action: "site.create", resource: pit, grants: [grant()], at: AT });
  expect(!wrongAction.allowed, "C grant for another action does not leak", wrongAction.reason);
  const wrongResource = resolveAuthority({ actor: other, action: "price.write", resource: { ...pit, id: "pit-2" }, grants: [grant()], at: AT });
  expect(!wrongResource.allowed, "C grant for another pit does not leak", wrongResource.reason);
  const wrongSubject = resolveAuthority({ actor: { profileId: "profile-third" }, action: "price.write", resource: pit, grants: [grant()], at: AT });
  expect(!wrongSubject.allowed, "C grant for another person does not leak", wrongSubject.reason);
}

console.log("\n=== D — time window ===");
{
  const expired = resolveAuthority({ actor: other, action: "price.write", resource: pit, grants: [grant({ validTo: "2026-06-30T00:00:00.000Z" })], at: AT });
  expect(!expired.allowed, "D expired grant is refused", expired.reason);
  const future = resolveAuthority({ actor: other, action: "price.write", resource: pit, grants: [grant({ validFrom: "2026-12-01T00:00:00.000Z" })], at: AT });
  expect(!future.allowed, "D not-yet-valid grant is refused", future.reason);
  const revoked = resolveAuthority({ actor: other, action: "price.write", resource: pit, grants: [grant({ revokedAt: "2026-10-01T00:00:00.000Z" })], at: AT });
  expect(!revoked.allowed, "D revoked grant is refused", revoked.reason);
  const noExpiry = resolveAuthority({ actor: other, action: "price.write", resource: pit, grants: [grant({ validTo: null })], at: AT });
  expect(noExpiry.allowed, "D a grant with no end date is still usable (explicit choice)");
  const badDate = resolveAuthority({ actor: other, action: "price.write", resource: pit, grants: [grant({ validTo: "not-a-date" })], at: AT });
  expect(!badDate.allowed, "D an unparseable end date denies (never accidental infinity)", badDate.reason);
}

console.log("\n=== E — organization boundary ===");
{
  const orgPit = { ...pit, organizationId: "org-a" };
  const d = resolveAuthority({
    actor: { profileId: "profile-other", organizationIds: ["org-a"] },
    action: "price.write",
    resource: orgPit,
    grants: [grant({ organizationId: "org-a" })],
    at: AT,
  });
  expect(d.allowed, "E same-organization grant is allowed");
  const crossOrg = resolveAuthority({
    actor: { profileId: "profile-other", organizationIds: ["org-b"] },
    action: "price.write",
    resource: orgPit,
    grants: [grant({ organizationId: "org-a" })],
    at: AT,
  });
  expect(!crossOrg.allowed, "E cross-organization grant is refused", crossOrg.reason);
  const missingOrgOnResource = resolveAuthority({
    actor: { profileId: "profile-other", organizationIds: ["org-a"] },
    action: "price.write",
    resource: { ...pit, organizationId: null },
    grants: [grant({ organizationId: "org-a" })],
    at: AT,
  });
  expect(!missingOrgOnResource.allowed, "E unknown resource org + org grant = deny (fail-closed)", missingOrgOnResource.reason);
}

console.log("\n=== F — malformed input / closed vocabulary ===");
{
  expect(!resolveAuthority({ actor: null, action: "price.write", resource: pit, at: AT }).allowed, "F missing actor denies");
  expect(!resolveAuthority({ actor: { profileId: "" }, action: "price.write", resource: pit, at: AT }).allowed, "F empty profile id denies");
  expect(!resolveAuthority({ actor: owner, action: "price.delete_everything", resource: pit, at: AT }).allowed, "F unknown action denies");
  expect(!resolveAuthority({ actor: owner, action: "price.write", resource: null, at: AT }).allowed, "F resource-required action without resource denies");
  expect(!resolveAuthority({ actor: owner, action: "price.write", resource: pit, at: "bad-date" }).allowed, "F invalid clock denies");
}

console.log("\n=== G — no identity-provider inputs exist (R2) ===");
{
  // Structural proof: the resolver has no parameter for LINE link order, display
  // name or company name. A caller CANNOT pass them, so "first link wins" and
  // "name matches" are unimplementable here.
  const src = readFileSync("core/authority/resolve.ts", "utf8");
  const forbidden = ["line_user_id", "display_name", "line_name", "first_link", "company_name"];
  const found = forbidden.filter((t) => src.includes(t));
  expect(found.length === 0, "G resolver contains no provider-identity / name-matching input", found.join(","));
  expect(src.includes("ROLE_IS_NOT_AUTHORITY"), "G role-bypass denial is implemented, not just documented");
}

console.log("\n=== H — evidence shape ===");
{
  const d = resolveAuthority({ actor: owner, action: "price.write", resource: pit, at: AT });
  const ev = authorityEvidence(d);
  expect(
    ev.authority_allowed === true && typeof ev.authority_reason === "string" && ev.authority_via === "owner",
    "H decision can be persisted as audit evidence",
    JSON.stringify(ev),
  );
}

console.log("\n=== SUMMARY ===");
console.log(`checks=${checks} failed=${failed}`);
console.log(failed === 0 ? "GATE: PASS" : `GATE: FAIL (${failed})`);
if (process.argv.includes("--strict") && failed > 0) process.exit(1);
