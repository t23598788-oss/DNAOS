// M015 runner — ONE canonical engine call per process invocation.
// Same imports as m014-runner (unmodified canonical writers, Phase-D lineage).
// Usage: npx tsx scripts/m015-runner.ts <op> <args...>
// Output line: M015_RESULT {...json} — raw error text on refusal.
const [op, ...args] = process.argv.slice(2);

function out(payload: Record<string, unknown>) {
  console.log("M015_RESULT " + JSON.stringify(payload));
}

async function main() {
  try {
    if (op === "confirm" || op === "confirm2") {
      // confirm:   <receiptId> <invoiceId> <amount>
      // confirm2:  <receiptId> <inv1> <amt1> <inv2> <amt2>  — mid-flow failure probe (2 allocations, 2nd invalid)
      const receiptId = args[0];
      const allocations = [];
      for (let i = 1; i + 1 < args.length; i += 2) {
        allocations.push({ target: { kind: "invoice" as const, id: args[i] }, allocation_kind: "principal" as const, amount: Number(args[i + 1]) });
      }
      const { confirmPayment } = await import("@/engines/canonical/payment-write");
      const r = await confirmPayment({
        receipt_document_id: receiptId,
        allocations,
        actor: "m015-recovery-worker",
      });
      out({ op, ok: true, allocations_written: r.allocations_written, allocation_ids: r.allocation_ids, debt_event_id: r.debt_event_id });
      return;
    }
    if (op === "mix") {
      // <receiptId> <invId> <amt1> <bogusStandaloneId> <amt2> — แถว 2 ชน FK
      // payment_allocations_standalone_document_id_fkey กลางลูป insert ของ RPC
      const [receiptId, invId, amt1, bogusId, amt2] = args;
      const { confirmPayment } = await import("@/engines/canonical/payment-write");
      const r = await confirmPayment({
        receipt_document_id: receiptId,
        allocations: [
          { target: { kind: "invoice" as const, id: invId }, allocation_kind: "principal" as const, amount: Number(amt1) },
          { target: { kind: "standalone_document" as const, id: bogusId }, allocation_kind: "principal" as const, amount: Number(amt2) },
        ],
        actor: "m015-recovery-worker",
      });
      out({ op, ok: true, allocations_written: r.allocations_written, allocation_ids: r.allocation_ids, debt_event_id: r.debt_event_id });
      return;
    }
    if (op === "issue") {
      const [documentId] = args;
      const { issueDocument } = await import("@/engines/canonical/document-write");
      const r = await issueDocument({ document_kind: "invoice", document_id: documentId, actor: "m015-recovery-worker" });
      out({ op, ok: true, status: r.status, version_no: r.version.version_no, version_id: r.version.id, previous: r.version.previous_version_id });
      return;
    }
    if (op === "advance") {
      const [orderId, status] = args;
      const { changeTransactionStatus } = await import("@/engines/canonical/transaction-write");
      await changeTransactionStatus({ order_id: orderId, status, actor: "m015-recovery-worker", evidence: { test: "m015-recovery" } });
      out({ op, ok: true, order_id: orderId, status });
      return;
    }
    out({ op: op ?? null, ok: false, error: "unknown op" });
    process.exit(2);
  } catch (e) {
    out({ op: op ?? null, ok: false, error: e instanceof Error ? e.message : String(e) });
    process.exit(3);
  }
}

void main();
