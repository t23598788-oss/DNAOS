// M014 concurrency runner — ONE canonical engine call per process invocation.
// Ops are the unmodified canonical writers (same imports Phase-D used).
// Usage: npx tsx scripts/m014-runner.ts <op> <args...>
// Output lines: M014_RESULT {...json} — plus raw error text on refusal.
process.env.TS_NODE_DEV = process.env.TS_NODE_DEV ?? ""; // no-op, keeps imports identical

const [op, ...args] = process.argv.slice(2);

function out(payload: Record<string, unknown>) {
  console.log("M014_RESULT " + JSON.stringify(payload));
}

async function main() {
  try {
    if (op === "confirm") {
      const [receiptId, invoiceId, amount] = args;
      const { confirmPayment } = await import("@/engines/canonical/payment-write");
      const r = await confirmPayment({
        receipt_document_id: receiptId,
        allocations: [{ target: { kind: "invoice", id: invoiceId }, allocation_kind: "principal", amount: Number(amount) }],
        actor: "m014-concurrency-worker",
      });
      out({ op, ok: true, allocations_written: r.allocations_written, allocation_ids: r.allocation_ids, debt_event_id: r.debt_event_id });
      return;
    }
    if (op === "issue") {
      const [documentId] = args;
      const { issueDocument } = await import("@/engines/canonical/document-write");
      const r = await issueDocument({ document_kind: "invoice", document_id: documentId, actor: "m014-concurrency-worker" });
      out({ op, ok: true, status: r.status, version_no: r.version.version_no, version_id: r.version.id, previous: r.version.previous_version_id });
      return;
    }
    if (op === "advance") {
      const [orderId, status] = args;
      const { changeTransactionStatus } = await import("@/engines/canonical/transaction-write");
      await changeTransactionStatus({ order_id: orderId, status, actor: "m014-concurrency-worker", evidence: { test: "m014-concurrency" } });
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
