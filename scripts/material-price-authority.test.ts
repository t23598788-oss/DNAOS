/**
 * MATERIAL PRICE AUTHORITY TEST (WAVE 2, rewritten WAVE 3) — offline, in-memory
 * deps, no DB, no network.
 *
 * Proves the two commands in engines/canonical/material-price-write.ts:
 *   recordSellerOffer  — a channel reply is EVIDENCE/an offer; never the central price
 *   applyMaterialPrice — a central price change needs owner/delegated authority
 *
 * WAVE 3 change: the write + audit now happen inside ONE Postgres function, so
 * the old "revert the price if the audit fails" tests are gone. What is proven
 * instead:
 *   · the module can only write through the atomic RPC (no direct table method
 *     exists in its dependency seam → a partial write is structurally impossible)
 *   · a failed RPC leaves no changed business state and no audit
 *   · authority is still decided once, before the write
 *   · the admin route and the Connect boundary both delegate to this module
 */
import {
  recordSellerOffer,
  applyMaterialPrice,
  type PriceWriteDeps,
} from "@/engines/canonical/material-price-write";
import type { ScopeGrant } from "@/core/authority/resolve";
import { readFileSync } from "fs";

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

function makeDb(opts: { failAtomic?: boolean; pitOwner?: string | null; material?: { id: string; price: number } | null } = {}) {
  const state = {
    request: { status: "pending", reply_price: null as number | null },
    material: opts.material === undefined ? ({ id: "pm-1", price: 500 } as { id: string; price: number } | null) : opts.material,
    audits: [] as Array<{ action: string; evidence?: Record<string, unknown> }>,
    offerCalls: 0,
    priceCalls: 0,
  };

  const deps: PriceWriteDeps = {
    async getPit(id) {
      return id === "pit-1"
        ? { id: "pit-1", owner_profile_id: opts.pitOwner === undefined ? "owner-profile" : opts.pitOwner, organization_id: "org-1" }
        : null;
    },
    async recordSellerOfferAtomic(input) {
      state.offerCalls += 1;
      if (opts.failAtomic) throw new Error("PRICE_ATOMIC_RPC_FAILED: audit insert failed (transaction rolled back)");
      if (state.request.status !== "pending") {
        if (state.request.reply_price !== null && Math.round(state.request.reply_price * 100) === Math.round(input.price * 100)) {
          return { already_recorded: true, price: state.request.reply_price, audit_id: null };
        }
        throw new Error(`PRICE_REQUEST_NOT_PENDING: answered`);
      }
      state.request = { status: "answered", reply_price: input.price };
      state.audits.push({ action: "price.offer_recorded", evidence: input.evidence });
      return { already_recorded: false, price: input.price, audit_id: "audit-offer-1" };
    },
    async applyMaterialPriceAtomic(input) {
      state.priceCalls += 1;
      if (opts.failAtomic) throw new Error("PRICE_ATOMIC_RPC_FAILED: audit insert failed (transaction rolled back)");
      if (state.material && Math.round(state.material.price * 100) === Math.round(input.price * 100)) {
        return { changed: false, price_id: state.material.id, audit_id: null, previous_price: state.material.price };
      }
      const action = state.material ? "price.updated" : "price.created";
      const previous = state.material ? state.material.price : null;
      state.material = { id: state.material?.id ?? "pm-new", price: input.price };
      state.audits.push({ action, evidence: input.evidence });
      return { changed: true, price_id: state.material.id, audit_id: "audit-price-1", previous_price: previous };
    },
  };

  return { deps, state };
}

const AT = "2026-10-25T00:00:00.000Z";
const owner = { profileId: "owner-profile", organizationIds: ["org-1"], organizationRoles: [{ organizationId: "org-1", role: "owner" }] };
const stranger = { profileId: "someone-else" };
const admin = { profileId: "admin-profile", role: "super_admin" };
const grant: ScopeGrant = {
  id: "g-1",
  subjectProfileId: "someone-else",
  organizationId: "org-1",
  resourceKind: "pit",
  resourceId: "pit-1",
  actions: ["price.write"],
  validFrom: "2026-01-01T00:00:00.000Z",
  validTo: "2026-12-31T00:00:00.000Z",
  revokedAt: null,
};

(async () => {
  console.log("=== A — seller offer is evidence, never the central price ===");
  {
    const { deps, state } = makeDb();
    const r = await recordSellerOffer(
      { request_id: "req-1", price: 480, source_message_id: "msg-1", reply_text: "480", actor: "system:line" },
      deps,
    );
    expect(r.ok && r.status === "answered" && r.price === 480, "A offer recorded on the request");
    expect(r.price_changed === false, "A result explicitly says the central price did NOT change");
    expect(state.request.status === "answered" && state.request.reply_price === 480, "A request row updated with the offer");
    expect(state.material?.price === 500, "A central price untouched (the module has no pit_materials write at all)");
    expect(state.audits.length === 1 && state.audits[0].action === "price.offer_recorded", "A exactly one canonical audit row for the offer");
    expect(
      JSON.stringify(state.audits[0]?.evidence ?? {}).includes("seller offer only"),
      "A audit evidence states this is an offer only",
    );
    expect(state.offerCalls === 1, "A exactly one atomic RPC call carries row + audit");
  }

  console.log("\n=== B — offer idempotency / rejection ===");
  {
    const { deps, state } = makeDb();
    await recordSellerOffer({ request_id: "req-1", price: 480, actor: "system:line" }, deps);
    const again = await recordSellerOffer({ request_id: "req-1", price: 480, actor: "system:line" }, deps);
    expect(again.already_recorded === true && again.audit_id === null, "B same price on an answered request is a no-op (no second audit)");
    expect(state.audits.length === 1, "B no duplicate audit row was written");

    let different = "";
    try {
      await recordSellerOffer({ request_id: "req-1", price: 999, actor: "system:line" }, deps);
    } catch (e) {
      different = (e as Error).message;
    }
    expect(different.startsWith("PRICE_REQUEST_NOT_PENDING"), "B a different price cannot overwrite an answered request", different);

    let empty = "";
    try {
      await recordSellerOffer({ request_id: "  ", price: 480, actor: "system:line" }, deps);
    } catch (e) {
      empty = (e as Error).message;
    }
    expect(empty.startsWith("PRICE_REQUEST_REQUIRED"), "B a missing request id is refused before any write", empty);
  }

  console.log("\n=== C — offer validation ===");
  {
    const { deps } = makeDb();
    let msg = "";
    try {
      await recordSellerOffer({ request_id: "req-1", price: 0, actor: "system:line" }, deps);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg.startsWith("PRICE_INVALID"), "C zero/negative price is refused", msg);

    msg = "";
    try {
      await recordSellerOffer({ request_id: "req-1", price: 100, actor: "  " }, deps);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg.startsWith("AUDIT_ACTOR_REQUIRED"), "C missing actor is refused", msg);
  }

  console.log("\n=== D — failed atomic write leaves nothing half-applied ===");
  {
    const { deps, state } = makeDb({ failAtomic: true });
    let msg = "";
    try {
      await recordSellerOffer({ request_id: "req-1", price: 480, actor: "system:line" }, deps);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg.startsWith("PRICE_ATOMIC_RPC_FAILED"), "D offer throws when the atomic function fails", msg);
    expect(state.request.status === "pending" && state.request.reply_price === null, "D request is still pending (transaction rolled back)");
    expect(state.audits.length === 0, "D no audit row survived");
    expect(!("updatePitMaterial" in deps) && !("audit" in deps), "D dependency seam has no non-atomic row/audit method");
  }

  console.log("\n=== E — central price change requires authority ===");
  {
    const { deps, state } = makeDb();
    const ok = await applyMaterialPrice({ pit_id: "pit-1", material_type_id: "mat-1", price: 520, actor: owner, at: AT }, deps);
    expect(ok.changed && ok.authority.via === "owner", "E organization owner may change the organization's price");
    expect(state.material?.price === 520, "E price written once");
    expect(ok.audit_id !== null && state.audits.length === 1 && state.audits[0].action === "price.updated", "E audit committed with the price");
    expect(
      JSON.stringify(state.audits[0]?.evidence ?? {}).includes("authority_allowed"),
      "E authority decision is persisted with the audit",
    );

    const { deps: d2, state: s2 } = makeDb();
    let msg = "";
    try {
      await applyMaterialPrice({ pit_id: "pit-1", material_type_id: "mat-1", price: 520, actor: stranger, at: AT }, d2);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg.startsWith("PRICE_FORBIDDEN"), "E a stranger cannot change the central price", msg);
    expect(s2.priceCalls === 0 && s2.material?.price === 500, "E the atomic function is never called on denial");

    const { deps: d3 } = makeDb();
    msg = "";
    try {
      await applyMaterialPrice({ pit_id: "pit-1", material_type_id: "mat-1", price: 520, actor: admin, at: AT }, d3);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg === "PRICE_FORBIDDEN:ORGANIZATION_OWNER_REQUIRED", "E super_admin alone is refused", msg);

    const { deps: d4, state: s4 } = makeDb();
    let delegatedError = "";
    try {
      await applyMaterialPrice(
        { pit_id: "pit-1", material_type_id: "mat-1", price: 530, actor: { ...stranger, organizationIds: ["org-1"] }, grants: [grant], at: AT },
        d4,
      );
    } catch (e) {
      delegatedError = (e as Error).message;
    }
    expect(delegatedError === "PRICE_FORBIDDEN:ORGANIZATION_OWNER_REQUIRED" && s4.priceCalls === 0, "E a grant cannot replace the required organization owner");

    const { deps: d5 } = makeDb();
    msg = "";
    try {
      await applyMaterialPrice({ pit_id: "pit-1", material_type_id: "mat-1", price: 530, actor: { profileId: "" }, at: AT }, d5);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg === "PRICE_FORBIDDEN:ACTOR_REQUIRED", "E a missing profile id is refused", msg);
  }

  console.log("\n=== F — price idempotency + failed commit ===");
  {
    const { deps, state } = makeDb();
    const noop = await applyMaterialPrice({ pit_id: "pit-1", material_type_id: "mat-1", price: 500, actor: owner, at: AT }, deps);
    expect(noop.changed === false && state.audits.length === 0, "F writing the same price is a no-op (no audit churn)");
    expect(state.priceCalls === 1, "F the atomic function itself made the no-op decision");

    const { deps: d2, state: s2 } = makeDb({ failAtomic: true });
    let msg = "";
    try {
      await applyMaterialPrice({ pit_id: "pit-1", material_type_id: "mat-1", price: 610, actor: owner, at: AT }, d2);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg.startsWith("PRICE_ATOMIC_RPC_FAILED"), "F change throws when the atomic function fails", msg);
    expect(s2.material?.price === 500, "F the old price is intact (no compensation write was needed)");
    expect(s2.audits.length === 0, "F no audit row from the failed transaction");

    const { deps: d3, state: s3 } = makeDb({ material: null });
    const created = await applyMaterialPrice({ pit_id: "pit-1", material_type_id: "mat-1", price: 610, actor: owner, at: AT }, d3);
    expect(created.changed && s3.audits[0]?.action === "price.created", "F a new price row is a single atomic create");
  }

  console.log("\n=== G — unknown pit / invalid price ===");
  {
    const { deps } = makeDb();
    let msg = "";
    try {
      await applyMaterialPrice({ pit_id: "pit-x", material_type_id: "mat-1", price: 100, actor: owner, at: AT }, deps);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg.startsWith("PIT_NOT_FOUND"), "G unknown pit is refused", msg);

    msg = "";
    try {
      await applyMaterialPrice({ pit_id: "pit-1", material_type_id: "mat-1", price: -5, actor: owner, at: AT }, deps);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg.startsWith("PRICE_INVALID"), "G invalid price is refused", msg);
  }

  console.log("\n=== H — one price writer in the tree ===");
  {
    const writer = readFileSync("engines/canonical/material-price-write.ts", "utf8");
    expect(/\.rpc\("record_seller_offer_atomic"/.test(writer), "H offer writes only through record_seller_offer_atomic");
    expect(/\.rpc\("apply_material_price_atomic"/.test(writer), "H price writes only through apply_material_price_atomic");
    expect(!/\.from\("pit_materials"\)\s*\n?\s*\.(insert|update|delete)/.test(writer), "H the writer never writes pit_materials directly");
    expect(!/ROLLED_BACK/.test(writer), "H no compensation path remains (atomic or fail closed)");
    expect(/PRICE_ATOMIC_RPC_MISSING/.test(writer), "H a missing migration fails closed instead of downgrading");

    const route = readFileSync("app/api/admin/pits/[pitId]/materials/route.ts", "utf8");
    expect(/applyMaterialPrice\(/.test(route), "H the admin route delegates to the canonical command");
    expect(!/\.from\("pit_materials"\)/.test(route), "H the admin route no longer touches pit_materials");
    expect(!/\.from\("audit_logs"\)/.test(route), "H the admin route no longer writes its own audit row");
    expect(/loadAuthorityContext\(/.test(route), "H the route loads the real actor context (org + grants)");

    const connect = readFileSync("app/api/internal/connect/material-price/route.ts", "utf8");
    expect(!/applyMaterialPrice\(/.test(connect), "H the provider boundary cannot change a published price");
    expect(/recordSellerOffer\(/.test(connect), "H the provider boundary records an offer only");
  }

  console.log("\n=== SUMMARY ===");
  console.log(`checks=${checks} failed=${failed}`);
  console.log(failed === 0 ? "GATE: PASS" : `GATE: FAIL (${failed})`);
  if (process.argv.includes("--strict") && failed > 0) process.exit(1);
})();
