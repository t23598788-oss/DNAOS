// Admin payout approvals page: lists customer_orders stuck in PAYOUT_PENDING_APPROVAL so a human can approve the payout. Amount is not stored on the order (customer_orders has no amount column), so the column shows n/a.
import { supabaseAdmin } from "@/services/supabase/queries";
import { PayoutApprovalList } from "./PayoutApprovalList";

export const dynamic = "force-dynamic";

export default async function AdminPayoutsPage() {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("customer_orders")
    .select("id, order_no, status, updated_at")
    .eq("status", "PAYOUT_PENDING_APPROVAL")
    .order("updated_at", { ascending: true });

  const orders = (data ?? []).map((row) => ({
    id: String(row.id),
    orderNo: String(row.order_no ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  }));

  return (
    <main style={{ padding: "24px", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: "20px", marginBottom: "8px" }}>Payout approvals</h1>
      <p style={{ color: "#555", marginBottom: "16px" }}>
        Orders waiting for a human payout decision
        (PAYOUT_PENDING_APPROVAL). Amount is not stored on the order — the
        payout payload still uses a placeholder until invoices.total_amount is
        wired in.
      </p>

      {error ? (
        <p style={{ color: "#b00020" }}>Failed to load orders: {error.message}</p>
      ) : null}

      <table style={{ borderCollapse: "collapse", fontSize: "14px" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "6px 12px" }}>
              order_no
            </th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "6px 12px" }}>
              updated_at
            </th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "6px 12px" }}>
              amount
            </th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "6px 12px" }}>
              actions
            </th>
          </tr>
        </thead>
        <tbody>
          <PayoutApprovalList orders={orders} />
        </tbody>
      </table>

      {orders.length === 0 && !error ? (
        <p style={{ marginTop: "12px", color: "#555" }}>
          No orders are waiting for approval.
        </p>
      ) : null}
    </main>
  );
}
