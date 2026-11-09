"use client";

// Client list for /admin/payouts: keeps the admin secret in memory only, POSTs /api/admin/payouts/[orderId]/approve with the X-Admin-Secret header, and shows the returned HTTP status and JSON.
import { useState } from "react";

type Order = { id: string; orderNo: string; updatedAt: string };

export function PayoutApprovalList({ orders }: { orders: Order[] }) {
  // The secret is typed once per session and only ever held in memory; it is
  // never rendered into the HTML or persisted.
  const [secret, setSecret] = useState("");
  const [actorId, setActorId] = useState("admin-ui");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function approve(orderId: string) {
    if (!secret) {
      setMessage({ ok: false, text: "Enter the admin secret first." });
      return;
    }
    setBusyId(orderId);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/payouts/${orderId}/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Secret": secret,
        },
        body: JSON.stringify({ actorId: actorId || "admin-ui" }),
      });
      const json = await res.json().catch(() => ({}));
      setMessage({
        ok: res.ok,
        text: `${res.status} ${JSON.stringify(json)}`,
      });
    } catch (err) {
      setMessage({ ok: false, text: `request failed: ${String(err)}` });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <tr>
        <td colSpan={4} style={{ padding: "6px 12px", background: "#f6f6f6" }}>
          <label style={{ marginRight: "12px" }}>
            Admin secret:{" "}
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              autoComplete="off"
              style={{ width: "320px" }}
            />
          </label>
          <label>
            Actor id:{" "}
            <input
              type="text"
              value={actorId}
              onChange={(e) => setActorId(e.target.value)}
              style={{ width: "160px" }}
            />
          </label>
        </td>
      </tr>

      {message ? (
        <tr>
          <td colSpan={4} style={{ padding: "6px 12px", color: message.ok ? "#0a6b2d" : "#b00020" }}>
            {message.text}
          </td>
        </tr>
      ) : null}

      {orders.map((order) => (
        <tr key={order.id}>
          <td style={{ padding: "6px 12px", borderBottom: "1px solid #eee" }}>
            {order.orderNo}
            <div style={{ color: "#888", fontSize: "12px" }}>{order.id}</div>
          </td>
          <td style={{ padding: "6px 12px", borderBottom: "1px solid #eee" }}>
            {order.updatedAt}
          </td>
          <td style={{ padding: "6px 12px", borderBottom: "1px solid #eee", color: "#888" }}>
            n/a
          </td>
          <td style={{ padding: "6px 12px", borderBottom: "1px solid #eee" }}>
            <button
              type="button"
              onClick={() => approve(order.id)}
              disabled={busyId !== null}
            >
              {busyId === order.id ? "Approving..." : "Approve payout"}
            </button>
          </td>
        </tr>
      ))}
    </>
  );
}
