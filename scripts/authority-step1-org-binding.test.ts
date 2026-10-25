/**
 * AUTHORITY STEP 1 — ORGANIZATION BINDING TEST (2026-10-25) — offline only.
 *
 * Proves the four STEP 1 requirements without touching any database:
 *
 *   A  the loader reads org_members by its REAL column (`user_id`) and fails
 *      closed on any error/missing row.
 *   B  organization scope is granted only for a VERIFIED session identity:
 *      profileId === auth account, resolved by id, confirmed email.
 *   C  a caller cannot widen scope by sending organization_id/company_id in a
 *      body, query string or header; resources resolve their organization from
 *      the database, never from the request.
 *   D  nothing new became an authority source: core/authority/resolve.ts still
 *      denies a role-only actor (ROLE_IS_NOT_AUTHORITY) and no canonical writer
 *      was touched by this step.
 *
 * No DB, no network, no credentials, no user data.
 */
import { readFileSync } from "fs";
import {
  loadAuthorityContext,
  loadOrganizationIds,
  loadOrganizationMembership,
  assertRequestedOrganizationAllowed,
  loadResourceOrganizationId,
  type AuthorityLoaderDb,
} from "@/engines/authority/load";
import { resolveAuthority } from "@/core/authority/resolve";

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

type Row = Record<string, unknown>;
type TableData = Record<string, Row[]>;

/**
 * Faithful PostgREST double: `.eq()` is awaitable AND exposes .is/.maybeSingle,
 * so it models both the real client chain and both call shapes in the loader.
 */
function dbWith(tables: TableData): AuthorityLoaderDb {
  return {
    from(table: string) {
      return {
        select() {
          return {
            eq(column: string, value: string) {
              const rows = () => (tables[table] ?? []).filter((r) => String(r[column] ?? "") === String(value));
              const chain = Promise.resolve({ data: rows(), error: null }) as unknown as {
                is(column: string, value: null): PromiseLike<{ data: unknown; error: null }>;
                maybeSingle(): PromiseLike<{ data: unknown; error: null }>;
              } & PromiseLike<{ data: unknown; error: null }>;
              chain.is = async () => ({ data: rows(), error: null });
              chain.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null });
              return chain;
            },
          };
        },
      };
    },
  } as unknown as AuthorityLoaderDb;
}

const brokenDb = {
  from: () => ({
    select: () => ({
      eq: () => {
        const chain = Promise.resolve({ data: null, error: { message: "42P01 relation does not exist" } }) as never as {
          is(column: string, value: null): PromiseLike<{ data: unknown; error: { message: string } }>;
          maybeSingle(): PromiseLike<{ data: unknown; error: { message: string } }>;
        };
        chain.is = async () => ({ data: null, error: { message: "42P01 relation does not exist" } });
        chain.maybeSingle = async () => ({ data: null, error: { message: "42P01 relation does not exist" } });
        return chain;
      },
    }),
  }),
} as never;

const ACCOUNT_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const ACCOUNT_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const ORG_A = "org-aaaaaaaa";
const ORG_B = "org-bbbbbbbb";

const liveOrgSchema = (): TableData => ({
  org_members: [
    { organization_id: ORG_A, user_id: ACCOUNT_A, role: "owner", created_at: "2026-10-18T05:17:21Z" },
  ],
  companies: [
    { id: "company-a", organization_id: ORG_A },
    { id: "company-b", organization_id: ORG_B },
    { id: "company-no-org", organization_id: null },
  ],
  customer_sites: [
    { id: "site-a", customer_company_id: "company-a" },
    { id: "site-b", customer_company_id: "company-b" },
  ],
  customer_orders: [
    { id: "order-a", customer_company_id: "company-a" },
    { id: "order-b", customer_company_id: "company-b" },
  ],
});

const verifiedA = {
  profileId: ACCOUNT_A,
  role: "admin",
  sessionAccountId: ACCOUNT_A,
  resolvedBy: "id" as const,
  emailConfirmed: true,
};

(async () => {
  console.log("=== A — real column + fail-closed ===");
  {
    const membership = await loadOrganizationMembership(ACCOUNT_A, dbWith(liveOrgSchema()));
    expect(
      membership.error === null && membership.organizations.length === 1 && membership.organizations[0] === ORG_A,
      "A1 verified account with one membership ⇒ exactly that organization",
      JSON.stringify(membership),
    );

    const empty = await loadOrganizationMembership(ACCOUNT_B, dbWith(liveOrgSchema()));
    expect(empty.error === null && empty.organizations.length === 0, "A2 account with no membership ⇒ zero organizations");

    const broken = await loadOrganizationMembership(ACCOUNT_A, brokenDb);
    expect(broken.organizations.length === 0 && Boolean(broken.error), "A3 missing table/query error ⇒ zero organizations (not allow)", JSON.stringify(broken));

    const ids = await loadOrganizationIds(ACCOUNT_A, dbWith(liveOrgSchema()));
    expect(ids.length === 1 && ids[0] === ORG_A, "A4 legacy helper returns the same memberships");

    const loadTs = read("engines/authority/load.ts");
    expect(/\.eq\("user_id", accountId\)/.test(loadTs), "A5 loader queries org_members.user_id (real column)");
    expect(!/\.eq\("profile_id"/.test(loadTs), "A6 loader no longer queries the non-existent profile_id column");
    expect(!/\.is\("deleted_at"/.test(loadTs), "A7 loader no longer filters on a non-existent deleted_at column");
  }

  console.log("=== B — organization scope requires the verified session identity ===");
  {
    const ok = await loadAuthorityContext(verifiedA, dbWith(liveOrgSchema()));
    expect(
      ok.organizationScope.eligible && ok.organizationScope.reason === "MEMBERSHIP_LOADED",
      "B1 verified session + membership ⇒ organization scope granted",
      JSON.stringify(ok.organizationScope),
    );
    expect(ok.actor.organizationIds?.length === 1 && ok.actor.organizationIds[0] === ORG_A, "B2 actor carries exactly the membership organizations");

    const emailFallback = await loadAuthorityContext(
      { ...verifiedA, resolvedBy: "email" as const },
      dbWith(liveOrgSchema()),
    );
    expect(
      (emailFallback.actor.organizationIds ?? []).length === 0 &&
        emailFallback.organizationScope.reason === "EMAIL_FALLBACK_IS_NOT_AUTHORITY",
      "B3 email-matched profile ⇒ NO organization scope",
      JSON.stringify(emailFallback.organizationScope),
    );

    const mismatch = await loadAuthorityContext(
      { ...verifiedA, profileId: ACCOUNT_B },
      dbWith(liveOrgSchema()),
    );
    expect(
      (mismatch.actor.organizationIds ?? []).length === 0 && mismatch.organizationScope.reason === "SESSION_ACCOUNT_MISMATCH",
      "B4 canonical profile ≠ authenticated account ⇒ NO organization scope",
      JSON.stringify(mismatch.organizationScope),
    );

    const unconfirmed = await loadAuthorityContext({ ...verifiedA, emailConfirmed: false }, dbWith(liveOrgSchema()));
    expect(
      (unconfirmed.actor.organizationIds ?? []).length === 0 && unconfirmed.organizationScope.reason === "EMAIL_NOT_CONFIRMED",
      "B5 unconfirmed email ⇒ NO organization scope",
      JSON.stringify(unconfirmed.organizationScope),
    );

    const legacyCaller = await loadAuthorityContext({ profileId: ACCOUNT_A, role: "super_admin" }, dbWith(liveOrgSchema()));
    expect(
      (legacyCaller.actor.organizationIds ?? []).length === 0 &&
        legacyCaller.organizationScope.reason === "SESSION_ACCOUNT_REQUIRED",
      "B6 caller that omits the session account cannot opt into scope by omission",
      JSON.stringify(legacyCaller.organizationScope),
    );

    const lookupFailure = await loadAuthorityContext(verifiedA, brokenDb);
    expect(
      (lookupFailure.actor.organizationIds ?? []).length === 0 &&
        lookupFailure.organizationScope.reason === "MEMBERSHIP_LOOKUP_FAILED",
      "B7 membership lookup failure ⇒ zero organizations, reason recorded",
      JSON.stringify(lookupFailure.organizationScope),
    );
  }

  console.log("=== C — client-supplied organization ids cannot widen scope ===");
  {
    const { actor } = await loadAuthorityContext(verifiedA, dbWith(liveOrgSchema()));

    // Same claim arriving through three different transports — the helper is
    // transport-agnostic, so all three must produce the identical denial.
    const fromBody = { organization_id: ORG_B };
    const fromQuery = new URLSearchParams("organization_id=" + encodeURIComponent(ORG_B)).get("organization_id");
    const fromHeader = new Headers({ "x-organization-id": ORG_B }).get("x-organization-id");

    const bodyDecision = assertRequestedOrganizationAllowed(actor, fromBody.organization_id);
    const queryDecision = assertRequestedOrganizationAllowed(actor, fromQuery);
    const headerDecision = assertRequestedOrganizationAllowed(actor, fromHeader);

    expect(bodyDecision.allowed === false && bodyDecision.reason === "ORGANIZATION_NOT_MEMBER", "C1 body organization_id of another org ⇒ denied", bodyDecision.reason);
    expect(queryDecision.allowed === false && queryDecision.reason === "ORGANIZATION_NOT_MEMBER", "C2 query organization_id of another org ⇒ denied", queryDecision.reason);
    expect(headerDecision.allowed === false && headerDecision.reason === "ORGANIZATION_NOT_MEMBER", "C3 header organization_id of another org ⇒ denied", headerDecision.reason);

    const ownOrg = assertRequestedOrganizationAllowed(actor, ORG_A);
    expect(ownOrg.allowed === true, "C4 the actor's own organization is still allowed");

    const noOrg = assertRequestedOrganizationAllowed(actor, "");
    expect(noOrg.allowed === false && noOrg.reason === "ORGANIZATION_REQUIRED", "C5 an unspecified organization is not a wildcard");

    const stranger = assertRequestedOrganizationAllowed({ profileId: ACCOUNT_B, organizationIds: [] }, ORG_A);
    expect(stranger.allowed === false && stranger.reason === "ORGANIZATION_MEMBERSHIP_REQUIRED", "C6 no membership ⇒ nothing is allowed", stranger.reason);

    const resourceA = await loadResourceOrganizationId("site", "site-a", dbWith(liveOrgSchema()));
    expect(resourceA.organizationId === ORG_A && resourceA.reason === "RESOURCE_OWNER_ORGANIZATION", "C7 resource organization comes from the database (site → company → organization)", JSON.stringify(resourceA));

    const resourceB = await loadResourceOrganizationId("site", "site-b", dbWith(liveOrgSchema()));
    expect(resourceB.organizationId === ORG_B, "C8 another tenant's resource reports ITS organization (not the caller's)");

    const deniedByResource = assertRequestedOrganizationAllowed(actor, resourceB.organizationId);
    expect(deniedByResource.allowed === false, "C9 accessing that resource is denied by the same membership check");

    const order = await loadResourceOrganizationId("transaction", "order-b", dbWith(liveOrgSchema()));
    expect(order.organizationId === ORG_B, "C10 transaction resources resolve their owning organization from the DB");

    const company = await loadResourceOrganizationId("company", "company-a", dbWith(liveOrgSchema()));
    expect(company.organizationId === ORG_A, "C11 company resources resolve organization_id directly");

    const pit = await loadResourceOrganizationId("pit", "pit-1", dbWith(liveOrgSchema()));
    expect(pit.organizationId === null && pit.reason === "PIT_HAS_NO_ORGANIZATION_COLUMN", "C12 an unmapped resource kind yields UNKNOWN organization (deny), never a guess", JSON.stringify(pit));

    const noOwner = await loadResourceOrganizationId("site", "site-x", dbWith(liveOrgSchema()));
    expect(noOwner.organizationId === null, "C13 a resource that does not exist yields no organization");

    const brokenResource = await loadResourceOrganizationId("site", "site-a", brokenDb);
    expect(brokenResource.organizationId === null, "C14 resource lookup failure ⇒ no organization (fail-closed)");

    const loadTs = read("engines/authority/load.ts");
    expect(!/searchParams|headers\.get|body\./.test(loadTs), "C15 the authority loader never reads request body/query/header");
  }

  console.log("=== D — removed membership + role alone ===");
  {
    const afterRevoke: TableData = { ...liveOrgSchema(), org_members: [] };
    const revoked = await loadAuthorityContext(verifiedA, dbWith(afterRevoke));
    expect(
      (revoked.actor.organizationIds ?? []).length === 0 && revoked.organizationScope.reason === "MEMBERSHIP_EMPTY",
      "D1 revoked membership takes effect on the very next request (no cache)",
      JSON.stringify(revoked.organizationScope),
    );

    const superAdminNoOrg = await loadAuthorityContext(
      { profileId: ACCOUNT_B, role: "super_admin", sessionAccountId: ACCOUNT_B, resolvedBy: "id", emailConfirmed: true },
      dbWith(afterRevoke),
    );
    expect((superAdminNoOrg.actor.organizationIds ?? []).length === 0, "D2 super_admin without membership gets no organization scope");

    const crossOrg = resolveAuthority({
      actor: superAdminNoOrg.actor,
      action: "price.write",
      resource: { kind: "site", id: "site-a", organizationId: ORG_A },
      grants: superAdminNoOrg.grants,
      at: "2026-10-25T00:00:00.000Z",
    });
    expect(!crossOrg.allowed && crossOrg.reason === "ROLE_IS_NOT_AUTHORITY", "D3 role name never authorises a resource (resolver unchanged)", crossOrg.reason);

    const ownResource = resolveAuthority({
      actor: superAdminNoOrg.actor,
      action: "price.write",
      resource: { kind: "pit", id: "pit-1", ownerProfileId: ACCOUNT_B },
      grants: [],
      at: "2026-10-25T00:00:00.000Z",
    });
    expect(ownResource.allowed && ownResource.via === "owner", "D4 explicit ownership still works (no regression)", ownResource.reason);

    const resolveTs = read("core/authority/resolve.ts");
    expect(/ROLE_IS_NOT_AUTHORITY/.test(resolveTs), "D5 resolver still denies role-only authority (unchanged)");
    expect(/const PLATFORM_ACTIONS: readonly AuthorityAction\[\] = \[\];/.test(resolveTs), "D6 no platform action can be satisfied by a role");
  }

  console.log("=== E — session carries the verification facts ===");
  {
    const sessionTs = read("core/auth/session.ts");
    expect(/resolvedBy\?: "id" \| "email"/.test(sessionTs), "E1 AuthedUser exposes how the profile was resolved");
    expect(/emailConfirmed\?: boolean/.test(sessionTs), "E2 AuthedUser exposes the confirmed-email fact");
    expect(/resolvedBy: ctx\.canonical\.resolvedBy/.test(sessionTs), "E3 session fills resolvedBy from the identity layer");
    expect(/emailConfirmed: Boolean\(confirmedAt\)/.test(sessionTs), "E4 session fills emailConfirmed from GoTrue data");

    const routeTs = read("app/api/admin/pits/[pitId]/materials/route.ts");
    expect(
      /sessionAccountId: auth\.id/.test(routeTs) && /resolvedBy: auth\.resolvedBy/.test(routeTs) && /emailConfirmed: auth\.emailConfirmed === true/.test(routeTs),
      "E5 the one existing authority caller passes the verified session facts",
    );
  }

  console.log("");
  console.log(`=== RESULT: ${checks - failed}/${checks} passed, ${failed} failed ===`);
  if (failed > 0) process.exitCode = 1;
})();
