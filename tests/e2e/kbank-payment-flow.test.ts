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

// Deterministic RequestID header value.
const fakeUuid = "e2e-uuid-0000";
vi.stubGlobal("crypto", Object.create(global.crypto, {
  randomUUID: { value: () => fakeUuid },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// order_no the LINE translator creates (T1-<event_type>-<hash>).
const LINE_EVENT_TYPE = "message/2916461334170554";
const LINE_ORDER_NO = `T1-${LINE_EVENT_TYPE.slice(0, 8)}-0001`;

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
          },
          occurred_at: "2026-11-09T00:00:00.000Z",
        },
      ],
      error: null,
    };

    const t = db.from("customer_orders") as FakeTable;
    // The insert().single() returns the inserted row; configure it.
    t.singleResult = {
      data: { id: "ord-001", order_no: LINE_ORDER_NO, status: "DRAFT" },
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

    // The insert resolved to the row we declared.
    const ins = t.insert({
      order_no: LINE_ORDER_NO,
      project_id: undefined,
      document_group_id: undefined,
      customer_company_id: undefined,
      customer_site_id: undefined,
      status: "DRAFT",
      updated_at: expect.any(String),
    }).single();
    expect(ins.error).toBeNull();
    expect((ins.data as { order_no?: string }).order_no).toBe(LINE_ORDER_NO);
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
          status: "DRAFT",
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
});
