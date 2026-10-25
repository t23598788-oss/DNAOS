/**
 * Pre-write safety + canonical readback tests (2026-10-20).
 * Offline. The canonical writer (createBusinessEvent) runs for real, but against an
 * in-memory fake client, so these tests can count real insert/update attempts and
 * prove that a blocked request never reaches the writer.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { createBusinessEvent, findBusinessEventsByTrace, BUSINESS_EVENT_STATES } from "../engines/canonical/event-write";
import * as tc from "../services/ai/traceContract";
import * as tcDeno from "../supabase/functions/_shared/ai/traceContract";

const ROOT = process.cwd();
let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) { passed += 1; console.log(`  ok   ${name}`); }
  else { failures.push(name); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");

const OWNER = "owner@example.com";

/** In-memory client. Counts every write attempt (insert/update). */
function fakeDb(opts: { insertError?: string; readbackError?: boolean; readbackRow?: Record<string, unknown> | null }) {
  let writes = 0;
  const db = {
    from: () => ({
      insert: () => {
        writes += 1;
        return {
          select: () => ({
            single: async () => (opts.insertError
              ? { data: null, error: { message: opts.insertError } }
              : { data: { id: "rec-1", event_code: "EV1", status: "quotation_pending" }, error: null }),
          }),
        };
      },
      update: () => {
        writes += 1;
        return { eq: async () => ({ error: null }) };
      },
      select: () => ({
        eq: () => ({
          single: async () => (opts.readbackError
            ? { data: null, error: { message: "readback unavailable" } }
            : { data: opts.readbackRow === undefined ? null : opts.readbackRow, error: null }),
        }),
      }),
    }),
  };
  return { db: db as never, writes: () => writes };
}

const baseGate = (over: Partial<tc.PreWriteInput> = {}): tc.PreWriteInput => ({
  traceId: "trace-1",
  authenticatedOwner: OWNER,
  requestOwner: OWNER,
  schemaValid: true,
  sourceRefs: ["msg-1"],
  alreadyLinkedRefs: [],
  status: "quotation_pending",
  allowedStatuses: BUSINESS_EVENT_STATES,
  ...over,
});

const eventInput = {
  eventCode: "EV1", eventType: "ขอราคา", eventDate: "2026-10-20", title: "ดินถม 10 คิว",
  source: { provider: "line", externalSubjectId: "U1", messageIds: ["msg-1"] },
  status: "quotation_pending", actor: OWNER,
};

async function main(): Promise<void> {
  console.log("Pre-write safety gate and canonical readback");

  // --- 1. Invalid input never reaches the canonical writer -----------------
  {
    const fake = fakeDb({});
    const r = await tc.guardedWrite(baseGate({ schemaValid: false }), () => createBusinessEvent(fake.db, eventInput));
    check("IN1 invalid schema: blocked with PREWRITE_INVALID_INPUT", !r.written && r.code === "PREWRITE_INVALID_INPUT", JSON.stringify(r));
    check("IN1b invalid schema: zero writes reached the database", fake.writes() === 0, `writes=${fake.writes()}`);
  }
  {
    const fake = fakeDb({});
    const r = await tc.guardedWrite(baseGate({ status: "paid-by-ai" }), () => createBusinessEvent(fake.db, { ...eventInput, status: "paid-by-ai" }));
    check("IN2 status outside the canonical vocabulary: blocked before write", !r.written && fake.writes() === 0);
  }
  {
    const fake = fakeDb({});
    const r = await tc.guardedWrite(baseGate({ traceId: "  " }), () => createBusinessEvent(fake.db, eventInput));
    check("IN3 missing trace id: blocked, zero writes", !r.written && r.code === "PREWRITE_TRACE_MISSING" && fake.writes() === 0);
  }

  // --- 2. Authorization and tenant -----------------------------------------
  {
    const fake = fakeDb({});
    const r = await tc.guardedWrite(baseGate({ authenticatedOwner: null }), () => createBusinessEvent(fake.db, eventInput));
    check("AU1 no authenticated owner: blocked, zero writes", !r.written && r.code === "PREWRITE_UNAUTHENTICATED" && fake.writes() === 0);
    check("AU1b unauthenticated maps to HTTP 401", tc.httpStatusForCode("PREWRITE_UNAUTHENTICATED") === 401);
  }
  {
    const fake = fakeDb({});
    const r = await tc.guardedWrite(baseGate({ requestOwner: "other@example.com" }), () => createBusinessEvent(fake.db, eventInput));
    check("TN1 cross-tenant request owner: blocked, zero writes", !r.written && r.code === "PREWRITE_TENANT_MISMATCH" && fake.writes() === 0);
    check("TN1b tenant mismatch maps to HTTP 403", tc.httpStatusForCode("PREWRITE_TENANT_MISMATCH") === 403);
  }

  // --- 3. Evidence and duplicates ------------------------------------------
  {
    const fake = fakeDb({});
    const r = await tc.guardedWrite(baseGate({ sourceRefs: [] }), () => createBusinessEvent(fake.db, eventInput));
    check("EV1 missing source evidence: blocked, zero writes", !r.written && r.code === "PREWRITE_EVIDENCE_MISSING" && fake.writes() === 0);
  }
  {
    const fake = fakeDb({});
    const r = await tc.guardedWrite(baseGate({ alreadyLinkedRefs: ["msg-1"] }), () => createBusinessEvent(fake.db, eventInput));
    check("DU1 duplicate request (source already linked): blocked, zero writes", !r.written && r.code === "PREWRITE_DUPLICATE" && fake.writes() === 0);
    check("DU1b duplicate is conflict (HTTP 409)", tc.httpStatusForCode("PREWRITE_DUPLICATE") === 409);
  }

  // --- 4. Valid request reaches the writer exactly once --------------------
  {
    const fake = fakeDb({ readbackRow: { id: "rec-1", context: { trace_id: "trace-1", provenance: { ownerId: OWNER } } } });
    const r = await tc.guardedWrite(baseGate(), () => createBusinessEvent(fake.db, eventInput));
    check("OK1 valid request is written once", r.written && fake.writes() === 1, `writes=${fake.writes()}`);
  }

  // --- 5. Canonical write failure ------------------------------------------
  {
    const fake = fakeDb({ insertError: "db rejected row" });
    const r = await tc.guardedWrite(baseGate(), () => createBusinessEvent(fake.db, eventInput));
    check("WF1 writer error surfaces as a failed write", r.written && r.value.ok === false);
    const c = tc.classifyWriteOutcome({
      attempt: { writerOk: r.written ? r.value.ok : false, recordId: null, writerError: r.written ? r.value.error : undefined },
      readback: null, expected: { traceId: "trace-1", ownerId: OWNER },
    });
    check("WF2 writer failure classifies as FAILED, nothing claimed", c.status === "FAILED" && c.recordId === null);
    check("WF3 never reported as ROLLED_BACK", !JSON.stringify(c).includes("ROLLED_BACK"));
  }

  // --- 6. Readback failure after an ok write --------------------------------
  {
    const fake = fakeDb({ readbackError: true });
    const w = await createBusinessEvent(fake.db, eventInput);
    const writesAfterWrite = fake.writes();
    const c = tc.classifyWriteOutcome({
      attempt: { writerOk: w.ok, recordId: w.data?.id ?? null, writerError: w.error },
      readback: null, readbackError: "readback unavailable", expected: { traceId: "trace-1", ownerId: OWNER },
    });
    check("RB1 readback failure: UNCONFIRMED, record id kept", c.status === "UNCONFIRMED" && c.recordId === "rec-1");
    check("RB2 readback failure: no automatic rewrite (write count unchanged)", fake.writes() === writesAfterWrite && writesAfterWrite === 1);
    check("RB3 UNCONFIRMED is never reported as ROLLED_BACK or CONFIRMED", c.status !== "CONFIRMED");
  }

  // --- 7. Readback trace / owner / id mismatch -----------------------------
  {
    const base = { attempt: { writerOk: true, recordId: "rec-1", writerError: undefined }, expected: { traceId: "trace-1", ownerId: OWNER } };
    check("TM1 readback with another trace: UNCONFIRMED", tc.classifyWriteOutcome({ ...base, readback: { id: "rec-1", traceId: "trace-OTHER", ownerId: OWNER } }).status === "UNCONFIRMED");
    check("TM2 readback with another owner: UNCONFIRMED", tc.classifyWriteOutcome({ ...base, readback: { id: "rec-1", traceId: "trace-1", ownerId: "other@example.com" } }).status === "UNCONFIRMED");
    check("TM3 readback of a different row id: UNCONFIRMED", tc.classifyWriteOutcome({ ...base, readback: { id: "rec-9", traceId: "trace-1", ownerId: OWNER } }).status === "UNCONFIRMED");
    check("TM4 matching readback: CONFIRMED", tc.classifyWriteOutcome({ ...base, readback: { id: "rec-1", traceId: "trace-1", ownerId: OWNER } }).status === "CONFIRMED");
    check("TM5 trace mismatch in the response gate is blocked with 409", (() => {
      const d = tc.gateResponse({ traceId: "trace-1", ownerId: OWNER, schemaValid: true, evidenceRecorded: true, claimsOutcome: true, canonical: { ok: true, recordId: "rec-1", ownerId: OWNER, traceId: "trace-OTHER" } });
      return !d.allowed && tc.httpStatusForCode(d.allowed ? "" : d.code) === 409;
    })());
  }

  // --- 8. False success ----------------------------------------------------
  {
    const d = tc.gateResponse({ traceId: "trace-1", ownerId: OWNER, schemaValid: true, evidenceRecorded: true, claimsOutcome: true, canonical: null });
    check("FS1 false success: claim with no canonical evidence releases nothing", tc.releaseResponse("บันทึกสำเร็จ", d) === null);
  }

  // --- 9. Evidence missing / cross-tenant at the response gate -------------
  {
    const d = tc.gateResponse({ traceId: "trace-1", ownerId: OWNER, schemaValid: true, evidenceRecorded: false, claimsOutcome: false });
    check("EV2 no AI evidence blocks the response", !d.allowed && d.code === "AI_EVIDENCE_MISSING");
    const x = tc.gateResponse({ traceId: "trace-1", ownerId: OWNER, schemaValid: true, evidenceRecorded: true, claimsOutcome: true, canonical: { ok: true, recordId: "rec-1", ownerId: "other@example.com", traceId: "trace-1" } });
    check("CT1 cross-tenant canonical record blocks the response (403 mapping)", !x.allowed && x.code === "CANONICAL_CROSS_TENANT" && tc.httpStatusForCode(x.code) === 403);
  }

  // --- 10. HTTP status mapping ---------------------------------------------
  check("HS1 401 for unauthenticated", tc.httpStatusForCode("PREWRITE_UNAUTHENTICATED") === 401);
  check("HS2 403 for tenant mismatch", tc.httpStatusForCode("PREWRITE_TENANT_MISMATCH") === 403);
  check("HS3 409 for duplicate", tc.httpStatusForCode("PREWRITE_DUPLICATE") === 409);
  check("HS4 409 for UNCONFIRMED", tc.httpStatusForCode("UNCONFIRMED") === 409);

  // --- 11. Node / Deno parity ----------------------------------------------
  check("PA1 Deno trace contract is byte-identical to Node", read("services/ai/traceContract.ts") === read("supabase/functions/_shared/ai/traceContract.ts"));
  const gateCases = [
    baseGate(),
    baseGate({ schemaValid: false }),
    baseGate({ authenticatedOwner: null }),
    baseGate({ requestOwner: "x@y.z" }),
    baseGate({ sourceRefs: [] }),
    baseGate({ alreadyLinkedRefs: ["msg-1"] }),
    baseGate({ status: "nope" }),
  ];
  const parity = gateCases.every((c) => JSON.stringify(tc.preWriteCheck(c)) === JSON.stringify(tcDeno.preWriteCheck(c)));
  check("PA2 Node and Deno return identical pre-write decisions", parity);
  const writeCases = [
    { attempt: { writerOk: false, recordId: null, writerError: "x" }, readback: null },
    { attempt: { writerOk: true, recordId: "r", writerError: undefined }, readback: null },
    { attempt: { writerOk: true, recordId: "r", writerError: undefined }, readback: { id: "r", traceId: "t", ownerId: OWNER } },
    { attempt: { writerOk: true, recordId: "r", writerError: undefined }, readback: { id: "r", traceId: "t", ownerId: "z" } },
  ];
  const expected = { traceId: "t", ownerId: OWNER };
  const parity2 = writeCases.every((c) => JSON.stringify(tc.classifyWriteOutcome({ ...c, expected })) === JSON.stringify(tcDeno.classifyWriteOutcome({ ...c, expected })));
  check("PA3 Node and Deno return identical post-write classifications", parity2);

  // --- 12. Trace lookup back to the record (read only) ----------------------
  {
    const rows = [{ id: "rec-1", event_code: "EV1", status: "quotation_pending" }];
    let filter: [string, string] | null = null;
    const db = {
      from: () => ({
        select: () => ({
          eq: async (col: string, val: string) => { filter = [col, val]; return { data: rows, error: null }; },
        }),
      }),
    };
    const r = await findBusinessEventsByTrace(db as never, "trace-1");
    check("TL1 trace finds the record it produced", r.ok && r.data?.[0]?.id === "rec-1");
    check("TL1b lookup filters on the context trace id only", filter !== null && (filter as [string, string])[0] === "context->>trace_id" && (filter as [string, string])[1] === "trace-1");
    const none = await findBusinessEventsByTrace({ from: () => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }) }) } as never, "trace-unknown");
    check("TL2 unknown trace returns no records (not a success)", none.ok && none.data?.length === 0);
    const err = await findBusinessEventsByTrace({ from: () => ({ select: () => ({ eq: async () => ({ data: null, error: { message: "db down" } }) }) }) } as never, "trace-1");
    check("TL3 lookup error is reported, not swallowed", !err.ok && err.error === "db down");
    const empty = await findBusinessEventsByTrace({} as never, "  ");
    check("TL4 blank trace id is refused before any query", !empty.ok && empty.error === "TRACE_ID_REQUIRED");
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.log("FAILED:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

void main();
