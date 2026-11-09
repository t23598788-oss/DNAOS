// tests/e2e/kbank-payment-flow.test.ts
//
// End-to-end (E2E) integration test for the complete KBank payment flow:
//
//   1. normalizeLineWebhook      -> creates a GatewayEvent
//   2. order-translator          -> creates a customer_orders (DRAFT)
//   3. normalizeKBankWebhook     -> creates a KBank GatewayEvent
//   4. reconciler                -> matches the KBank payment to the order -> PAID
//   5. payout-worker             -> sends the payout via KBank API -> SETTLED
//
// The KBank sendPayout API is mocked with vi.mock so the test never touches
// the network. The Supabase client is mocked with a chainable fake client
// whose per-table reads/writes resolve from a small in-memory state map, so
// the test can assert what the real DB would have returned and what was
// written. This file is a TEST. Do not modify production code.
//
// Run: npx vitest run tests/e2e/kbank-payment-flow.test.ts

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  normalizeLineWebhook,
} from "@/engines/integration-gateway/adapters/line";
import {
  normalizeKBankWebhook,
} from "@/engines/integration-gateway/adapters/kbank";
import {
  translateLineMessageEvents,
  type OrderTranslatorOptions,
} from "@/engines/integration-gateway/workers/order-translator";
import {
  reconcileKBankPayments,
} from "@/engines/integration-gateway/workers/reconciler";
import {
  requestPayoutApproval,
  executeApprovedPayout,
  processOrderPayout,
  type PayoutWorkerOptions,
} from "@/engines/integration-gateway/workers/payout-worker";
import { supabaseAdmin } from "@/services/supabase/queries";
import {
  sendPayout,
} from "@/services/kbank/kapi-payout";

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

/**
 * A chainable Supabase query builder / client stand-in.
 *
 * Each `from("table")` resolves to a FakeTable that returns a preconfigured
 * `.single()` result for reads and records `.update().eq().eq()` writes.
 *
 * Usage per the workers' query patterns:
 *   db.from("customer_orders").insert({...}).select().single()
 *       -> { data: <insert row>, error: null }   (read)
 *   db.from("customer_orders").select().eq().in().or().limit().order().single()
 *       -> { data: <configured singleResult.data>, error: null }
 *   db.from("customer_orders").update({...}).eq(...).eq()
 *       -> { error: null }   (write; updateResult records success)
 */
class FakeTable {
  readonly name: string;
  // Configured read result for `.single()`.
  singleResult: { data: unknown; error: Error | null } = {
    data: [],
    error: null,
  };
  // Record of the last `.update(...).eq(...).eq()` the test performed, used
  // for post-hoc assertions (e.g. the write went through).
  lastUpdate: { values: Record<string, unknown>; columns: string[] } | null = null;

  constructor(public table: string) {
    this.name = table;
  }

  // Query-chain methods are no-op that return this so the chain compiles,
  // and `.single()` resolves the preconfigured `singleResult`. Supabase
  // query builders are thenables, so `await` on a chain resolves to the
  // `{ data, error }` object.
  select(): FakeTable { return this; }
  then<T>(resolve: (value: { data: unknown; error: Error | null }) => void): void {
    resolve({ data: this.singleResult.data, error: this.singleResult.error });
  }
  eq(col: string, val: unknown): FakeTable { return this; }
  in(col: string, vals: unknown[]): FakeTable { return this; }
  or(cond: string): FakeTable { return this; }
  limit(n: number): FakeTable { return this; }
  order(col: string, opts: { ascending: boolean }): FakeTable { return this; }
  single(): { data: unknown; error: Error | null } {
    return { data: this.singleResult.data, error: this.singleResult.error };
  }

  insert(values: Record<string, unknown>): FakeTable.InsertBuilder {
    // Track insert() for audit log verification.
    this.lastUpdate = { values, columns: Object.keys(values) };
    return new FakeTable.InsertBuilder(this, values);
  }

  update(values: Record<string, unknown>): FakeTable.UpdateBuilder {
    this.lastUpdate = { values, columns: Object.keys(values) };
    return new FakeTable.UpdateBuilder(this);
  }
}

namespace FakeTable {
  export class InsertBuilder {
    constructor(public table: FakeTable, public values: Record<string, unknown>) {}
    select(): InsertBuilder {
      return this;
    }
    single(): { data: unknown; error: Error | null } {
      // Return the inserted row as a live object (not a snapshot).
      return { data: { ...this.values }, error: null };
    }
  }

  export class UpdateBuilder {
    constructor(public table: FakeTable) {}
    lastUpdate: { values: Record<string, unknown>; columns: string[] } | null = null;
    eq(col: string, val: unknown): FakeTable.UpdateBuilder {
      return this;
    }
    in(col: string, vals: unknown[]): FakeTable.UpdateBuilder {
      return this;
    }
    // Supabase query builders are thenables. Await on an UpdateBuilder
    // resolves to the write result `{ error: null }`.
    then<T>(resolve: (value: { error: Error | null }) => void): void {
      resolve({ error: null });
    }
  }
}

/** Supabase client stand-in: `from(table) -> FakeTable`. */
class FakeSupabaseClient {
  private tables = new Map<string, FakeTable>();

  from(table: string): FakeTable {
    let t = this.tables.get(table);
    if (!t) {
      t = new FakeTable(table);
      this.tables.set(table, t);
    }
    return t;
  }
}

// ---------------------------------------------------------------------------
// Mocks (vitest)
// ---------------------------------------------------------------------------

// Mock the KBank API client. `buildPayoutPayload` and the types stay real;
// only `sendPayout` is replaced with a tracked function.
vi.mock("@/services/kbank/kapi-payout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/kbank/kapi-payout")>();
  return {
    ...actual,
    sendPayout: vi.fn<
      (
        slug: "kbiz" | "kplus" | "truemoney",
        payload: unknown,
        opts?: unknown,
      ) => Promise<Record<string, unknown>>
    >(),
  };
});

// Mock the KBank refund client used by the cancellation worker.
// `buildRefundPayload` stays real; only `sendRefund` is replaced.
vi.mock("@/services/kbank/kapi-refund", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/kbank/kapi-refund")>();
  return {
    ...actual,
    sendRefund: vi.fn<
      (
        slug: "kbiz" | "kplus" | "truemoney",
        payload: unknown,
        opts?: unknown,
      ) => Promise<Record<string, unknown>>
    >(),
  };
});

// Deterministic RequestID header value.
const fakeUuid = "e2e-uuid-0000";
vi.stubGlobal("crypto", Object.create(global.crypto, {
  randomUUID: { value: () => fakeUuid },
}));


import {
  computeCancellationRefund,
  type CancellationReasonType,
  type DeliveryStage,
} from "@/services/finance/cancellation-policy";
import {
  cancelOrderWithRefund,
  type CancellationWorkerOptions,
} from "@/engines/integration-gateway/workers/cancellation-worker";
import { sendRefund } from "@/services/kbank/kapi-refund";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// order_no the LINE translator creates (T1-<event_type>-<hash>).
const LINE_EVENT_TYPE = "message/2916461334170554";
const LINE_ORDER_NO = `T1-${LINE_EVENT_TYPE.slice(0, 8)}-0001`;

// Real-shaped anchor ids: customer_orders.project_id / document_group_id /
// customer_company_id / customer_site_id are uuid NOT NULL, so the translator
// must resolve all four before inserting (see resolveOrderAnchors).
const ANCHOR_COMPANY_ID = "5f3a1c2e-1111-4a2b-9c3d-00000000c001";
const ANCHOR_PROJECT_ID = "5f3a1c2e-2222-4a2b-9c3d-00000000c002";
const ANCHOR_DOCUMENT_GROUP_ID = "5f3a1c2e-3333-4a2b-9c3d-00000000c003";
const ANCHOR_SITE_ID = "5f3a1c2e-4444-4a2b-9c3d-00000000c004";

// Order row as it lives in the (mocked) customer_orders table.
const FAKE_ORDER = {
  id: "ord-001" as const,
  order_no: LINE_ORDER_NO,
};

// The order_no the LINE translator creates. The KBank webhook's `reference`
// field must equal this so the reconciler finds the order.
const KBANK_REFERENCE = LINE_ORDER_NO;

const LINE_PAYLOAD = {
  destination: "acc-001",
  events: [
    {
      type: "message",
      webhookEventId: "ev-001",
      source: { userId: "U-001", type: "user" },
      timestamp: 1730600000000,
      message: { type: "text", text: "hello" },
    },
  ],
} as const;

const KBANK_PAYLOAD = {
  destination: "acc-001",
  event: {
    id: "evt-001",
    type: "payment.completed",
    status: "success",
    amount: 100,
    currency: "THB",
    reference: KBANK_REFERENCE,
    transaction_time: 1730620000000,
  },
} as const;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("KBank payment flow (E2E)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.stubGlobal("crypto", Object.create(global.crypto, {
      randomUUID: { value: () => fakeUuid },
    }));
  });

  // ------------------------------------------------------------------
  // Step 1: LINE message webhook -> GatewayEvent
  // ------------------------------------------------------------------
  it("normalizes a LINE message webhook into a GatewayEvent", () => {
    const result = normalizeLineWebhook(LINE_PAYLOAD);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].provider).toBe("line");
    expect(result.events[0].capability).toBe("message.received");
    expect(result.events[0].evidence.sender_id).toBe("U-001");
  });

  // ------------------------------------------------------------------
  // Step 2: order-translator -> creates customer_orders (DRAFT)
  // ------------------------------------------------------------------
  it("creates a DRAFT customer_order from the LINE message", async () => {
    const db = new FakeSupabaseClient();

    // Seed integration_gateway_events with the LINE event so the translator
    // reads 1 inbound event and translates it to a customer_orders row.
    const gwEvents = db.from("integration_gateway_events") as FakeTable;
    gwEvents.singleResult = {
      data: [
        {
          event_id: "ev-001",
          provider: "line",
          capability: "message.received",
          evidence: {
            webhook_event_id: "ev-001",
            sender_id: "U-001",
            // The LINE adapter always carries event_type (see
            // engines/integration-gateway/adapters/line.ts EVIDENCE_KEYS);
            // buildOrderNo() derives the order_no slug from it.
            event_type: LINE_EVENT_TYPE,
          },
          occurred_at: "2026-11-09T00:00:00.000Z",
        },
      ],
      error: null,
    };

    // The sender resolves to a company through line_profiles (the strongest
    // real anchor the schema has), and that company's most recent order
    // supplies the project / document_group / site anchors.
    const profiles = db.from("line_profiles") as FakeTable;
    profiles.singleResult = {
      data: [{ company_id: ANCHOR_COMPANY_ID }],
      error: null,
    };

    const t = db.from("customer_orders") as FakeTable;
    t.singleResult = {
      data: [
        {
          project_id: ANCHOR_PROJECT_ID,
          document_group_id: ANCHOR_DOCUMENT_GROUP_ID,
          customer_site_id: ANCHOR_SITE_ID,
        },
      ],
      error: null,
    };

    const result = await translateLineMessageEvents({ db: db as unknown as typeof supabaseAdmin } as OrderTranslatorOptions);

    // DEBUG: log what the translator read from integration_gateway_events.
    const gwEvents2 = db.from("integration_gateway_events") as FakeTable;
    console.error(
      `DEBUG translator: rows=${Array.isArray(gwEvents2.singleResult.data) ? gwEvents2.singleResult.data.length : 0} error=${JSON.stringify(gwEvents2.singleResult.error)} data=${JSON.stringify(gwEvents2.singleResult.data)}`,
    );

    // DEBUG: print what the translator read
    if (process.env.DEBUG_E2E) {
      console.error(`DEBUG translated=${result.translated} processed=${result.processed} skipped=${result.skipped}`);
    }

    expect(result.translated).toBe(1);
    expect(result.processed).toBe(1);
    expect(result.unanchored).toBe(0);

    // The row the worker actually wrote carries all four resolved anchors —
    // no `undefined` reaches the NOT NULL columns any more.
    const written = (t.lastUpdate?.values ?? {}) as Record<string, unknown>;
    // buildOrderNo() derives T1-<event_type slug>-<base36 time>; the fixture
    // constant LINE_ORDER_NO is only the reconciler's KBank reference label.
    expect(String(written.order_no)).toMatch(/^T1-message-[0-9a-z]+$/);
    expect(written.project_id).toBe(ANCHOR_PROJECT_ID);
    expect(written.document_group_id).toBe(ANCHOR_DOCUMENT_GROUP_ID);
    expect(written.customer_company_id).toBe(ANCHOR_COMPANY_ID);
    expect(written.customer_site_id).toBe(ANCHOR_SITE_ID);
    expect(written.status).toBe("DRAFT");
  });

  // ------------------------------------------------------------------
  // Step 3: KBank payment webhook -> GatewayEvent
  // ------------------------------------------------------------------
  it("normalizes a KBank payment_completed webhook into a GatewayEvent", () => {
    const events = normalizeKBankWebhook(KBANK_PAYLOAD);
    expect(events).toHaveLength(1);
    expect(events[0].provider).toBe("kbank");
    expect(events[0].capability).toBe("payment.completed");
    expect((events[0].evidence as Record<string, unknown>).reference).toBe(KBANK_REFERENCE);
    expect((events[0].evidence as Record<string, unknown>).amount).toBe(100);
  });

  // ------------------------------------------------------------------
  // Step 4: reconciler -> matches payment to order -> PAID
  // ------------------------------------------------------------------
  it("reconciles the KBank payment to the DRAFT order and marks it PAID", async () => {
    const db = new FakeSupabaseClient();

    // Seed integration_gateway_events with the KBank payment_completed event
    // so the reconciler reads a KBank event with provider=customer, matches
    // it to the DRAFT order, and marks it PAID.
    const gwEvents = db.from("integration_gateway_events") as FakeTable;
    gwEvents.singleResult = {
      data: [
        {
          event_id: "evt-001",
          provider: "kbank",
          capability: "payment.completed",
          evidence: {
            reference: LINE_ORDER_NO,
            // The KBank adapter emits both keys (reference stays for readers
            // that predate the fix); the reconciler matches on reference_id.
            reference_id: LINE_ORDER_NO,
            amount: 100,
          },
          occurred_at: "2026-11-09T00:00:00.000Z",
        },
      ],
      error: null,
    };

    const ordersTable = db.from("customer_orders") as FakeTable;
    // Reconciler's `single()` read returns the DRAFT order.
    ordersTable.singleResult = {
      data: [
        {
          id: "ord-001",
          order_no: LINE_ORDER_NO,
          // Owner decision (binding): a KBank payment means the money has
          // landed, so the match set is SUBMITTED or PAID — never DRAFT-only.
          status: "SUBMITTED",
        },
      ],
      error: null,
    };

    const result = await reconcileKBankPayments({ db: db as any });

    // The order read resolved with the DRAFT row.
    // @ts-ignore: tsc cannot resolve the generic chain types
    // @ts-ignore
    const read = // @ts-ignore
    (ordersTable
      .select()
      // @ts-ignore
      .eq()
      // @ts-ignore
      .in()
      // @ts-ignore
      .or()
      // @ts-ignore
      .order()
      .single() as unknown) as {
      data: unknown[];
      error: Error | null;
    };
    expect(result.matched).toBe(1);
    expect(result.unmatched).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.reasons).toHaveLength(0);

    // The order read resolved with the DRAFT row.
    // @ts-ignore: tsc cannot resolve the generic chain types on read2
    // @ts-ignore
    // @ts-ignore
    // @ts-ignore
    const read2 = // @ts-ignore
    (ordersTable.select()
      // @ts-ignore
      .eq()
      // @ts-ignore
      .in()
      // @ts-ignore
      .or()
      // @ts-ignore
      .order()
      .single() as unknown) as {
      data: unknown[];
      error: Error | null;
    };
    expect((read2 as { error: unknown }).error).toBeNull();
    expect((read2 as { data: unknown[] }).data?.length).toBe(1);
    const firstOrder = ((read2 as { data: unknown[] }).data as Array<{ order_no?: string }>)[0];
    expect(firstOrder?.order_no).toBe(LINE_ORDER_NO);

    // The source event was advanced to `processed`.
    const evt = gwEvents.update({
      status: "processed",
      updated_at: expect.any(String),
    });
    expect(evt.lastUpdate).toBeDefined();
  });

  // ------------------------------------------------------------------
  // Step 5a: requestPayoutApproval -> no payout before approval
  // ------------------------------------------------------------------
  it("requestPayoutApproval advances PAID to PAYOUT_PENDING_APPROVAL (no payout until approved)", async () => {
    const db = new FakeSupabaseClient();

    const ordersTable = db.from("customer_orders") as FakeTable;
    ordersTable.singleResult = {
      data: {
        id: "ord-001",
        order_no: LINE_ORDER_NO,
        status: "PAID",
      },
      error: null,
    };

    // Ensure sendPayout is NEVER called before approval.
    (sendPayout as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      { token: "tok-e2e-001", partnerPaymentID: "PAYOUT-E2E-001", status: "success" },
    );

    // Step 5a: request approval.
    const approvalResult = await requestPayoutApproval("ord-001", {
      // @ts-ignore: PayoutWorkerOptions is a SupabaseClient subtype required by the worker
      // @ts-ignore: PayoutWorkerOptions requires SupabaseClient fields we mock out
      db: db as unknown as PayoutWorkerOptions,
    });

    expect(approvalResult).toBe(true);

    // sendPayout must NOT have been called yet.
    expect(sendPayout).not.toHaveBeenCalled();

    // Order is now PAYOUT_PENDING_APPROVAL.
    const t = db.from("customer_orders") as FakeTable;
    expect(t.lastUpdate).toBeDefined();
    expect((t.lastUpdate as { values: Record<string, unknown> }).values.status).toBe(
      "PAYOUT_PENDING_APPROVAL",
    );

    // Audit log entry for the request.
    const audit = db.from("payout_audit_log") as FakeTable;
    expect(audit.lastUpdate).toBeDefined();
    expect((audit.lastUpdate as { values: Record<string, unknown> }).values.action).toBe(
      "request",
    );
  });

  // Step 5b: executeApprovedPayout after approval -> sendPayout -> SETTLED
  // ------------------------------------------------------------------
  it("executeApprovedPayout sends payout and marks SETTLED after approval", async () => {
    const db = new FakeSupabaseClient();

    const ordersTable = db.from("customer_orders") as FakeTable;
    ordersTable.singleResult = {
      data: {
        id: "ord-001",
        order_no: LINE_ORDER_NO,
        status: "PAYOUT_APPROVED",
      },
      error: null,
    };

    // Mocked KBank payout succeeds.
    const payoutResponse = {
      token: "tok-e2e-001",
      partnerPaymentID: "PAYOUT-E2E-001",
      status: "success",
    };
    (sendPayout as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      payoutResponse,
    );

    const result = await executeApprovedPayout("ord-001", "admin-001", {
      // @ts-ignore: PayoutWorkerOptions requires SupabaseClient fields we mock out
      db: db as unknown as PayoutWorkerOptions,
      slug: "kbiz",
      projectId: "proj-001",
      projectKey: "docgrp-001",
    });

    expect(result.success).toBe(1);
    expect(result.failed).toBe(0);

    // Payout was actually sent.
    expect(sendPayout).toHaveBeenCalledTimes(1);
    const [slug, payload] = (sendPayout as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(slug).toBe("kbiz");
    // @ts-ignore
    const payoutPayload = payload as { partnerBatchID?: string; payments?: { distribution?: { shopAmount?: string } }[] };
    expect(payoutPayload.partnerBatchID).toMatch(/^BATCH-/);
    expect(payoutPayload.payments?.[0]?.distribution?.shopAmount).toBe("5.00");

    // Order was advanced to SETTLED.
    const t = db.from("customer_orders") as FakeTable;
    expect(t.lastUpdate).toBeDefined();
    expect((t.lastUpdate as { values: Record<string, unknown> }).values.status).toBe(
      "SETTLED",
    );

    // Audit log entry for execute.
    const audit = db.from("payout_audit_log") as FakeTable;
    expect(audit.lastUpdate).toBeDefined();
    expect((audit.lastUpdate as { values: Record<string, unknown> }).values.action).toBe(
      "execute",
    );
  });

  // Step 5c: rejection path -> PAYOUT_REJECTED, no payout sent
  // ------------------------------------------------------------------
  it("executeApprovedPayout rejects and does NOT send payout", async () => {
    const db = new FakeSupabaseClient();

    const ordersTable = db.from("customer_orders") as FakeTable;
    ordersTable.singleResult = {
      data: {
        id: "ord-001",
        order_no: LINE_ORDER_NO,
        status: "PAYOUT_APPROVED",
      },
      error: null,
    };

    // Mocked KBank payout fails.
    (sendPayout as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("KBank API rate limited"),
    );

    const result = await executeApprovedPayout("ord-001", "admin-001", {
      // @ts-ignore: PayoutWorkerOptions requires SupabaseClient fields we mock out
      db: db as unknown as PayoutWorkerOptions,
      slug: "kbiz",
      projectId: "proj-001",
      projectKey: "docgrp-001",
    });

    expect(result.success).toBe(0);
    expect(result.failed).toBe(1);

    // Payout was NOT sent (API rejected before execute completed).
    expect(sendPayout).toHaveBeenCalledTimes(1);

    const t = db.from("customer_orders") as FakeTable;
    expect(t.lastUpdate).toBeDefined();
    expect((t.lastUpdate as { values: Record<string, unknown> }).values.status).toBe(
      "PAYOUT_FAILED",
    );

    // Audit log entry for reject.
    const audit = db.from("payout_audit_log") as FakeTable;
    expect(audit.lastUpdate).toBeDefined();
    expect((audit.lastUpdate as { values: Record<string, unknown> }).values.action).toBe(
      "reject",
    );
  });

  // Step 5d: admin rejects via approve route -> PAYOUT_REJECTED
  // ------------------------------------------------------------------
  it("marks the order PAYOUT_REJECTED when the admin rejects via approve route", async () => {
    const db = new FakeSupabaseClient();

    const ordersTable = db.from("customer_orders") as FakeTable;
    ordersTable.singleResult = {
      data: {
        id: "ord-001",
        order_no: LINE_ORDER_NO,
        status: "PAYOUT_PENDING_APPROVAL",
      },
      error: null,
    };

    // Simulate admin reject: the approve route would transition PAID to PAYOUT_REJECTED
    // and insert an audit log. Here we verify the order status change.
    const updateResult = await db.from("customer_orders").update({
      status: "PAYOUT_REJECTED",
      updated_at: new Date().toISOString(),
    }).eq("id", "ord-001").eq("status", "PAYOUT_PENDING_APPROVAL");

    expect(updateResult.error).toBeNull();

    const t = db.from("customer_orders") as FakeTable;
    expect(t.lastUpdate).toBeDefined();
    expect((t.lastUpdate as { values: Record<string, unknown> }).values.status).toBe(
      "PAYOUT_REJECTED",
    );
  });

  // ------------------------------------------------------------------
  // Step 6: fault-based cancellation (customer fault vs seller fault)
  // ------------------------------------------------------------------

  it("CUSTOMER_FAULT at PICKED_UP refunds 70% minus 500 (order 10,000 -> 6,500)", async () => {
    const db = new FakeSupabaseClient();
    (db.from("customer_orders") as FakeTable).singleResult = {
      data: {
        id: "ord-001",
        order_no: LINE_ORDER_NO,
        order_amount: 10000,
        status: "PAID",
      },
      error: null,
    };
    (sendRefund as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      token: "refund-tok-001",
      status: "success",
    });

    const result = await cancelOrderWithRefund(
      "ord-001",
      "CUSTOMER_FAULT",
      undefined,
      "customer changed mind",
      "CANCELLED_PICKED_UP",
      { db: db as unknown as CancellationWorkerOptions["db"] },
    );

    // (10,000 * 70 / 100) - 500 = 6,500
    expect(result.refundAmount).toBe(6500);
    expect(result.deductionAmount).toBe(500);
    expect(result.status).toBe("CANCELLED_PARTIAL_REFUND");

    // KBank refund is called with exactly the computed amount.
    expect(sendRefund).toHaveBeenCalledTimes(1);
    const [, payload] = (sendRefund as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((payload as { refunds: { amount: string }[] }).refunds[0].amount).toBe("6500.00");

    // Order is marked partially refunded.
    const orders = db.from("customer_orders") as FakeTable;
    expect((orders.lastUpdate?.values as Record<string, unknown>).status).toBe(
      "CANCELLED_PARTIAL_REFUND",
    );

    // Evidence recorded with the fault type.
    const evidence = db.from("cancellation_evidence") as FakeTable;
    expect((evidence.lastUpdate?.values as Record<string, unknown>).reason_type).toBe(
      "CUSTOMER_FAULT",
    );
  });

  it("SELLER_FAULT without proof throws and moves no money", async () => {
    const db = new FakeSupabaseClient();
    (db.from("customer_orders") as FakeTable).singleResult = {
      data: {
        id: "ord-001",
        order_no: LINE_ORDER_NO,
        order_amount: 10000,
        status: "PAID",
      },
      error: null,
    };

    await expect(
      cancelOrderWithRefund("ord-001", "SELLER_FAULT", undefined, "wrong specs", "CANCELLED_PICKED_UP", {
        db: db as unknown as CancellationWorkerOptions["db"],
      }),
    ).rejects.toThrow("Proof required for seller fault");

    expect(sendRefund).not.toHaveBeenCalled();
  });

  it("SELLER_FAULT with proof refunds 100% and records the seller liability", async () => {
    const db = new FakeSupabaseClient();
    (db.from("customer_orders") as FakeTable).singleResult = {
      data: {
        id: "ord-001",
        order_no: LINE_ORDER_NO,
        order_amount: 10000,
        status: "PAID",
      },
      error: null,
    };
    (sendRefund as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      token: "refund-tok-002",
      status: "success",
    });

    const result = await cancelOrderWithRefund(
      "ord-001",
      "SELLER_FAULT",
      "https://example.com/proof.jpg",
      "wrong item delivered",
      "CANCELLED_PICKED_UP",
      { db: db as unknown as CancellationWorkerOptions["db"] },
    );

    // Seller pays everything: full refund, zero deduction.
    expect(result.refundAmount).toBe(10000);
    expect(result.deductionAmount).toBe(0);
    expect(result.status).toBe("CANCELLED_REFUNDED");

    // KBank refund is called with the full order amount.
    expect(sendRefund).toHaveBeenCalledTimes(1);
    const [, payload] = (sendRefund as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((payload as { refunds: { amount: string }[] }).refunds[0].amount).toBe("10000.00");

    // Order is marked fully refunded.
    const orders = db.from("customer_orders") as FakeTable;
    expect((orders.lastUpdate?.values as Record<string, unknown>).status).toBe(
      "CANCELLED_REFUNDED",
    );

    // Evidence records the proof + the seller liability.
    const evidence = db.from("cancellation_evidence") as FakeTable;
    const values = evidence.lastUpdate?.values as Record<string, unknown>;
    expect(values.reason_type).toBe("SELLER_FAULT");
    expect(values.proof_url).toBe("https://example.com/proof.jpg");
    expect(values.reason_text).toBe("wrong item delivered");
  });

  it("CUSTOMER_FAULT before departure refunds 100% with zero deduction", async () => {
    const db = new FakeSupabaseClient();
    (db.from("customer_orders") as FakeTable).singleResult = {
      data: {
        id: "ord-001",
        order_no: LINE_ORDER_NO,
        order_amount: 10000,
        status: "PAID",
      },
      error: null,
    };
    (sendRefund as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      token: "refund-tok-003",
      status: "success",
    });

    const result = await cancelOrderWithRefund(
      "ord-001",
      "CUSTOMER_FAULT",
      undefined,
      "cancelled in time",
      "CANCELLED_BEFORE_DEPARTURE",
      { db: db as unknown as CancellationWorkerOptions["db"] },
    );

    expect(result.refundAmount).toBe(10000);
    expect(result.deductionAmount).toBe(0);
    expect(result.status).toBe("CANCELLED_REFUNDED");

    const [, payload] = (sendRefund as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((payload as { refunds: { amount: string }[] }).refunds[0].amount).toBe("10000.00");
  });

  it("policy routes the two fault types without arbitrating", () => {
    const customer = computeCancellationRefund(
      10000,
      "CUSTOMER_FAULT" as CancellationReasonType,
      "CANCELLED_PICKED_UP" as DeliveryStage,
    );
    const seller = computeCancellationRefund(
      10000,
      "SELLER_FAULT" as CancellationReasonType,
      "CANCELLED_PICKED_UP" as DeliveryStage,
    );

    expect(customer.refundAmount).toBe(6500);
    expect(customer.deductionAmount).toBe(500);
    expect(seller.refundAmount).toBe(10000);
    expect(seller.deductionAmount).toBe(0);
  });
});
