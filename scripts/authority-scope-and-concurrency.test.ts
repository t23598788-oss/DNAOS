/**
 * AUTHORITY SCOPE + CONCURRENCY TEST (WAVE 3 §02/§04/§07) — offline only.
 *
 * No DB, no network, no credentials. Two kinds of evidence:
 *
 *   MOCK   the loader treats a missing/erroring source as EMPTY (never "allow"),
 *          and two concurrent identical commands produce at most one write and
 *          one audit row when the atomic function serialises them.
 *
 *   STATIC the SQL functions really contain the locking + idempotency + audit
 *          statements being claimed; the rollback files exist; and the commands
 *          WAVE 3 could not implement (processing fee, resource booking) have no
 *          model in this repository — reported, not mocked into existence.
 */
import { readFileSync, existsSync } from "fs";
import { loadScopeGrants, loadOrganizationIds, loadAuthorityContext } from "@/engines/authority/load";
import { resolveAuthority, type ScopeGrant } from "@/core/authority/resolve";
import { applyMaterialPrice, recordSellerOffer, type PriceWriteDeps } from "@/engines/canonical/material-price-write";

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

/** Fake client whose every query fails — models "table not applied yet". */
const brokenDb = {
  from: () => ({
    select: () => ({
      eq: () => ({
        is: async () => ({ data: null, error: { message: "42P01 relation does not exist" } }),
      }),
    }),
  }),
} as never;

function rowsDb(rows: Record<string, unknown[]>) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          is: async (_column: string, _value: null) => {
            void _column;
            void _value;
            return { data: rows[table] ?? [], error: null };
          },
        }),
      }),
    }),
  } as never;
}

(async () => {
  console.log("=== A — authority loader fails closed ===");
  {
    const grants = await loadScopeGrants("profile-1", brokenDb);
    expect(Array.isArray(grants) && grants.length === 0, "A missing authority_grants ⇒ zero grants (not allow)");

    const orgs = await loadOrganizationIds("profile-1", brokenDb);
    expect(Array.isArray(orgs) && orgs.length === 0, "A missing org_members ⇒ zero organizations");

    const ctx = await loadAuthorityContext({ profileId: "profile-1", role: "super_admin" }, brokenDb);
    expect(ctx.actor.profileId === "profile-1" && ctx.actor.role === "super_admin", "A actor id/role are passed through as evidence");
    expect((ctx.actor.organizationIds ?? []).length === 0 && ctx.grants.length === 0, "A no orgs, no grants on a broken schema");

    const denied = resolveAuthority({
      actor: ctx.actor,
      action: "price.write",
      resource: { kind: "pit", id: "pit-1", ownerProfileId: "someone-else" },
      grants: ctx.grants,
      at: "2026-10-25T00:00:00.000Z",
    });
    expect(!denied.allowed, "A an admin with no evidence is still denied", denied.reason);

    const unknownAction = await loadScopeGrants("profile-1", rowsDb({
      authority_grants: [
        {
          id: "g-bad",
          subject_profile_id: "profile-1",
          organization_id: null,
          resource_kind: "pit",
          resource_id: "pit-1",
          actions: ["price.delete_everything"],
          valid_from: "2026-01-01T00:00:00Z",
          valid_to: null,
          revoked_at: null,
        },
      ],
    }));
    expect(unknownAction.length === 0, "A a grant with only unknown actions is dropped");

    const good = await loadScopeGrants("profile-1", rowsDb({
      authority_grants: [
        {
          id: "g-1",
          subject_profile_id: "profile-1",
          organization_id: null,
          resource_kind: "pit",
          resource_id: "pit-1",
          actions: ["price.write", "nonsense"],
          valid_from: "2026-01-01T00:00:00Z",
          valid_to: null,
          revoked_at: null,
        },
      ],
    }));
    expect(good.length === 1 && good[0].actions.length === 1 && good[0].actions[0] === "price.write", "A a valid grant is mapped to the resolver shape");
    expect(good[0].organizationId === null && good[0].resourceId === "pit-1", "A resource scope is preserved (no org invented)");

    const orgScoped = await loadScopeGrants("profile-1", rowsDb({
      authority_grants: [
        {
          id: "g-org",
          subject_profile_id: "profile-1",
          organization_id: "org-1",
          resource_kind: "pit",
          resource_id: "pit-1",
          actions: ["price.write"],
          valid_from: "2026-01-01T00:00:00Z",
          valid_to: null,
          revoked_at: null,
        },
      ],
    }));
    const orgDenied = resolveAuthority({
      actor: { profileId: "profile-1", organizationIds: [] },
      action: "price.write",
      resource: { kind: "pit", id: "pit-1", ownerProfileId: "someone-else" },
      grants: orgScoped as ScopeGrant[],
      at: "2026-10-25T00:00:00.000Z",
    });
    expect(!orgDenied.allowed, "A an org-scoped grant without a loaded membership is denied", orgDenied.reason);
  }

  console.log("\n=== B — concurrent identical price writes ===");
  {
    const audits: string[] = [];
    let price: number | null = 500;
    let lock: Promise<unknown> = Promise.resolve();
    let calls = 0;

    // Serialised like the SQL function's `select ... for update` on the pit row.
    const withLock = <T>(fn: () => Promise<T>): Promise<T> => {
      const run = lock.then(fn, fn);
      lock = run.catch(() => undefined);
      return run;
    };

    const deps: PriceWriteDeps = {
      async getPit() {
        return { id: "pit-1", owner_profile_id: "owner-profile", organization_id: "org-1" };
      },
      async recordSellerOfferAtomic() {
        throw new Error("not used");
      },
      async applyMaterialPriceAtomic(input) {
        calls += 1;
        return withLock(async () => {
          if (price !== null && Math.round(price * 100) === Math.round(input.price * 100)) {
            return { changed: false, price_id: "pm-1", audit_id: null, previous_price: price };
          }
          price = input.price;
          audits.push("price.updated");
          return { changed: true, price_id: "pm-1", audit_id: "a-1", previous_price: 500 };
        });
      },
    };

    const input = { pit_id: "pit-1", material_type_id: "mat-1", price: 520, actor: { profileId: "owner-profile", organizationIds: ["org-1"], organizationRoles: [{ organizationId: "org-1", role: "owner" }] }, at: "2026-10-25T00:00:00.000Z" };
    const [r1, r2] = await Promise.all([applyMaterialPrice(input, deps), applyMaterialPrice(input, deps)]);
    expect(calls === 2, "B both concurrent commands reached the atomic boundary");
    expect([r1.changed, r2.changed].filter(Boolean).length === 1, "B exactly one command changed the price");
    expect(audits.length === 1 && price === 520, "B exactly one audit row and one final price (no duplicate)");
  }

  console.log("\n=== C — concurrent identical seller offers ===");
  {
    const audits: string[] = [];
    let status = "pending";
    let price: number | null = null;
    let lock: Promise<unknown> = Promise.resolve();
    const withLock = <T>(fn: () => Promise<T>): Promise<T> => {
      const run = lock.then(fn, fn);
      lock = run.catch(() => undefined);
      return run;
    };

    const deps: PriceWriteDeps = {
      async getPit() {
        return null;
      },
      async recordSellerOfferAtomic(input) {
        return withLock(async () => {
          if (status !== "pending") {
            if (price !== null && Math.round(price * 100) === Math.round(input.price * 100)) {
              return { already_recorded: true, price, audit_id: null };
            }
            throw new Error("PRICE_REQUEST_NOT_PENDING: answered");
          }
          status = "answered";
          price = input.price;
          audits.push("price.offer_recorded");
          return { already_recorded: false, price, audit_id: "a-offer" };
        });
      },
      async applyMaterialPriceAtomic() {
        throw new Error("not used");
      },
    };

    const [r1, r2] = await Promise.all([
      recordSellerOffer({ request_id: "req-1", price: 480, actor: "system:line" }, deps),
      recordSellerOffer({ request_id: "req-1", price: 480, actor: "system:line" }, deps),
    ]);
    expect([r1.already_recorded, r2.already_recorded].filter((v) => v === false).length === 1, "C one offer recorded, one replay");
    expect(audits.length === 1, "C one offer audit row (no duplicate evidence)");
  }

  console.log("\n=== D — the SQL functions actually implement the guarantees ===");
  {
    const migrationPath = "supabase/migrations/20261025000001_material_price_atomic_v1.sql";
    const rollbackPath = "supabase/migrations/20261025000001_material_price_atomic_v1_rollback.sql";
    expect(existsSync(migrationPath), "D atomic migration proposal exists (not applied)");
    expect(existsSync(rollbackPath), "D rollback file exists");
    const sql = read(migrationPath).toLowerCase();
    const rollback = read(rollbackPath).toLowerCase();

    expect(sql.includes("record_seller_offer_atomic") && sql.includes("apply_material_price_atomic"), "D both commands have a transactional implementation");
    expect((sql.match(/for update/g) ?? []).length >= 2, "D request and pit rows are locked in the transaction");
    expect(/if v_request\.status <> 'pending'/.test(sql), "D offer replay is decided inside the lock (not a read-then-write race)");
    expect(/if v_exists and round\(v_material\.price, 2\) = round\(p_price, 2\)/.test(sql), "D same-price write is a no-op inside the transaction");
    expect(/insert into public\.audit_logs/.test(sql), "D audit rows are written in the same function");
    expect(/raise exception 'price_forbidden/.test(sql), "D the function refuses to persist without an ALLOW decision");
    expect(/security definer/.test(sql) && /set search_path = public/.test(sql), "D functions use the repo's security-definer convention");
    expect(/revoke all on function public\.apply_material_price_atomic/.test(sql), "D anon/authenticated cannot call the price function");
    expect(/drop function if exists public\.apply_material_price_atomic/.test(rollback), "D rollback drops the atomic functions");
    expect(!/insert into public\.pit_materials/.test(rollback), "D rollback never touches price data");

    const grantsPath = "supabase/migrations/20261025000002_authority_grants_proposal.sql";
    expect(existsSync(grantsPath), "D authority_grants proposal exists (not applied)");
    const grantsSql = read(grantsPath).toLowerCase();
    expect(/create table if not exists public\.authority_grants/.test(grantsSql), "D explicit grants table is proposed");
    expect(/actions <@ array\['price\.write'/.test(grantsSql), "D grant actions are a closed vocabulary");
    expect(/no rls policy is proposed/i.test(grantsSql), "D grants table does not pretend RLS is protection");
  }

  console.log("\n=== E — other idempotency boundaries (source evidence) ===");
  {
    const schema = read("supabase/local-migration/full_schema.sql");
    expect(/CREATE UNIQUE INDEX "customer_orders_order_no_key"[^;]*\("order_no"\)/.test(schema.replace(/\n/g, " ")), "E customer_orders.order_no is UNIQUE in the schema");
    const tx = read("engines/canonical/transaction-write.ts");
    expect(/23505/.test(tx) && /idempotent_replay/.test(tx), "E a concurrent transaction unique-race returns the winner");

    const payment = read("supabase/migrations/20260923000001_canonical_payment_allocation_atomic_v1_1.sql");
    expect(/receipt_already_allocated/.test(payment), "E payment allocation refuses a second allocation for the same receipt");
    expect(/for update/.test(payment), "E payment allocation locks the receipt row");

    const doc = read("app/api/admin/ide/_lib/canonicalJobTransportRuntime.ts");
    expect(/idempotency_key/.test(doc), "E document job envelope carries an idempotency key");

    const feeModel = /\b(fee_contract|fee_contracts|processing_fee)\b/i.test(schema);
    expect(!feeModel, "E BLOCKED evidence: no processing-fee contract/charge model exists in the schema");
    const booking = /\b(vehicle_bookings|resource_assignments|vehicle_assignments)\b/i.test(schema);
    expect(!booking, "E BLOCKED evidence: no resource/vehicle booking model exists in the schema");
  }

  console.log("\n=== F — cross-tenant isolation at the price boundary ===");
  {
    const orgGrant: ScopeGrant = {
      id: "g-org-2",
      subjectProfileId: "operator",
      organizationId: "org-A",
      resourceKind: "pit",
      resourceId: "*",
      actions: ["price.write"],
      validFrom: "2026-01-01T00:00:00Z",
      validTo: null,
      revokedAt: null,
    };
    const cross = resolveAuthority({
      actor: { profileId: "operator", organizationIds: ["org-A"] },
      action: "price.write",
      resource: { kind: "pit", id: "pit-B", ownerProfileId: "owner-B", organizationId: "org-B" },
      grants: [orgGrant],
      at: "2026-10-25T00:00:00Z",
    });
    expect(!cross.allowed, "F an org-A grant cannot write an org-B resource", cross.reason);

    const same = resolveAuthority({
      actor: { profileId: "operator", organizationIds: ["org-A"], organizationRoles: [{ organizationId: "org-A", role: "member" }] },
      action: "price.write",
      resource: { kind: "pit", id: "pit-A", ownerProfileId: "owner-A", organizationId: "org-A" },
      grants: [orgGrant],
      at: "2026-10-25T00:00:00Z",
    });
    expect(!same.allowed && same.reason === "ORGANIZATION_OWNER_REQUIRED", "F a price grant cannot replace the organization owner's approval", same.reason);

    const owner = resolveAuthority({
      actor: { profileId: "owner-A", organizationIds: ["org-A"], organizationRoles: [{ organizationId: "org-A", role: "owner" }] },
      action: "price.write",
      resource: { kind: "pit", id: "pit-A", ownerProfileId: "owner-A", organizationId: "org-A" },
      at: "2026-10-25T00:00:00Z",
    });
    expect(owner.allowed && owner.via === "owner", "F the organization owner may set price within their organization", owner.reason);

    const spoofed = resolveAuthority({
      actor: { profileId: "operator", organizationIds: [] },
      action: "price.write",
      resource: { kind: "pit", id: "pit-A", ownerProfileId: "owner-A", organizationId: "org-A" },
      grants: [orgGrant],
      at: "2026-10-25T00:00:00Z",
    });
    expect(!spoofed.allowed, "F membership is re-checked, not taken from the grant row", spoofed.reason);
  }

  console.log("\n=== SUMMARY ===");
  console.log(`checks=${checks} failed=${failed}`);
  console.log(failed === 0 ? "GATE: PASS" : `GATE: FAIL (${failed})`);
  if (process.argv.includes("--strict") && failed > 0) process.exit(1);
})();
